//! Opening a room, seating players, and handing it to a rollup. All base layer.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::error::HerdError;
use crate::state::{Answers, Phase, Room, Rule, Seat, Vault, MAX_ANSWER, MAX_PLAYERS};
use crate::{ANSWERS_SEED, EPHEMERAL_RENT_BUFFER, ROOM_SEED, VAULT_SEED};

/// Fewest players a room can start with.
///
/// Two people cannot form a herd - every round would be two groups of one, which
/// culls everybody or nobody. Three is the smallest number where the mechanic
/// exists at all.
pub const MIN_PLAYERS: u8 = 3;

#[derive(Accounts)]
#[instruction(room_id: u64)]
pub struct CreateRoom<'info> {
    #[account(mut)]
    pub host: Signer<'info>,

    #[account(
        init,
        payer = host,
        space = 8 + Room::INIT_SPACE,
        seeds = [ROOM_SEED, host.key().as_ref(), &room_id.to_le_bytes()],
        bump
    )]
    pub room: Box<Account<'info, Room>>,

    /// Holds the stakes, and is never delegated to a rollup.
    #[account(
        init,
        payer = host,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, room.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// The sealed half. Delegated with the room, then made unreadable.
    #[account(
        init,
        payer = host,
        space = 8 + Answers::INIT_SPACE,
        seeds = [ANSWERS_SEED, room.key().as_ref()],
        bump
    )]
    pub answers: Box<Account<'info, Answers>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create(
    ctx: Context<CreateRoom>,
    room_id: u64,
    stake: u64,
    round_seconds: u16,
    host_session: Pubkey,
) -> Result<()> {
    let room = &mut ctx.accounts.room;
    room.host = ctx.accounts.host.key();
    room.host_session = host_session;
    room.room_id = room_id;
    room.stake = stake;
    room.round_seconds = round_seconds.max(5);
    room.phase = Phase::Open;
    room.round = 0;
    room.round_ends_at = 0;
    room.rule = Rule::Undrawn;
    room.awaiting_rule = false;
    room.seats = [Seat::empty(); MAX_PLAYERS];
    room.seat_count = 0;
    room.last_round = 0;
    room.last_words = [[0u8; MAX_ANSWER]; MAX_PLAYERS];
    room.last_lengths = [0u8; MAX_PLAYERS];
    room.bump = ctx.bumps.room;
    room.vault_bump = ctx.bumps.vault;
    room.answers_bump = ctx.bumps.answers;

    let vault = &mut ctx.accounts.vault;
    vault.room = ctx.accounts.room.key();
    vault.bump = ctx.bumps.vault;

    let answers = &mut ctx.accounts.answers;
    answers.room = ctx.accounts.room.key();
    answers.round = 0;
    answers.words = [[0u8; MAX_ANSWER]; MAX_PLAYERS];
    answers.lengths = [0u8; MAX_PLAYERS];
    answers.bump = ctx.bumps.answers;

    // Headroom so the answers account can buy its own privacy once delegated.
    // It is the account that gets sealed, so it is the account that pays.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.host.to_account_info(),
                to: ctx.accounts.answers.to_account_info(),
            },
        ),
        EPHEMERAL_RENT_BUFFER,
    )?;

    msg!("herd: room {} open, stake {}", room_id, stake);
    Ok(())
}

#[derive(Accounts)]
pub struct JoinRoom<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump
    )]
    pub room: Box<Account<'info, Room>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, room.key().as_ref()],
        bump = room.vault_bump,
        has_one = room
    )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

pub fn handle_join(ctx: Context<JoinRoom>, session: Pubkey) -> Result<()> {
    let stake = ctx.accounts.room.stake;

    {
        let room = &ctx.accounts.room;
        require!(room.phase == Phase::Open, HerdError::RoomNotOpen);
        require!((room.seat_count as usize) < MAX_PLAYERS, HerdError::RoomFull);
        require!(
            !room
                .seats()
                .iter()
                .any(|s| s.wallet == ctx.accounts.player.key()),
            HerdError::AlreadySeated
        );
    }

    // Stake first, seat second. If the transfer fails there is no seat.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        stake,
    )?;

    let room = &mut ctx.accounts.room;
    let index = room.seat_count as usize;
    room.seats[index] = Seat {
        wallet: ctx.accounts.player.key(),
        session,
        alive: true,
        answered_round: 0,
        has_answered: false,
    };
    room.seat_count += 1;

    msg!("herd: seat {} taken by {}", index, ctx.accounts.player.key());
    Ok(())
}

#[derive(Accounts)]
pub struct LockRoom<'info> {
    /// The host, or the host's session key. Checked in the handler because
    /// either is acceptable and `has_one` can only express one of them.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump
    )]
    pub room: Box<Account<'info, Room>>,
}

pub fn handle_lock(ctx: Context<LockRoom>) -> Result<()> {
    let room = &mut ctx.accounts.room;
    let who = ctx.accounts.authority.key();
    require!(
        who == room.host || who == room.host_session,
        HerdError::NotTheHost
    );
    require!(room.phase == Phase::Open, HerdError::RoomNotOpen);
    require!(room.seat_count >= MIN_PLAYERS, HerdError::TooFewPlayers);

    room.phase = Phase::Playing;
    room.round = 1;
    room.rule = Rule::Undrawn;
    room.awaiting_rule = false;
    // The clock starts when the room reaches the rollup, not here - see
    // `seal_room`. Base-layer time would be spent on the delegation round trip.
    room.round_ends_at = 0;

    msg!("herd: room locked with {} players", room.seat_count);
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRoom<'info> {
    /// The host, or the host's session key. Pays the delegation rent, which is
    /// why it must be writable.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: the delegation CPI reassigns the owner; seeds are re-derived and
    /// verified inside `delegate_account`.
    #[account(mut, del)]
    pub room: UncheckedAccount<'info>,

    /// CHECK: same, for the sealed half. Both go together - a room in a rollup
    /// whose answers are still on Solana would be readable by anyone.
    #[account(mut, del)]
    pub answers: UncheckedAccount<'info>,
}

pub fn handle_delegate(ctx: Context<DelegateRoom>, validator: Option<Pubkey>) -> Result<()> {
    // The room is an UncheckedAccount here - the delegation CPI is about to
    // reassign its owner, so Anchor cannot hold it as an Account. That means
    // reading the three fields we need out of the raw bytes ourselves.
    //
    // Byte offsets are laid out once, in order, so that a field added to Room
    // moves them together instead of leaving one of them behind. An earlier
    // version hand-counted them, and when `host_session` was inserted the
    // `room_id` offset stayed where it was and started reading the first eight
    // bytes of the session key. The seeds that produced were still perfectly
    // well-formed, just for an account that does not exist, so the failure
    // arrived as "signer privilege escalated" from inside the delegation
    // program with nothing pointing back here. The assertion below turns that
    // whole class of mistake into a named error at the top of this function.
    const HOST: usize = 8;
    const HOST_SESSION: usize = HOST + 32;
    const ROOM_ID: usize = HOST_SESSION + 32;

    let (host, host_session, room_id) = {
        let data = ctx.accounts.room.try_borrow_data()?;
        (
            Pubkey::try_from(&data[HOST..HOST + 32]).map_err(|_| error!(HerdError::NotAPlayer))?,
            Pubkey::try_from(&data[HOST_SESSION..HOST_SESSION + 32])
                .map_err(|_| error!(HerdError::NotTheHost))?,
            u64::from_le_bytes(
                data[ROOM_ID..ROOM_ID + 8]
                    .try_into()
                    .map_err(|_| error!(HerdError::NotAPlayer))?,
            ),
        )
    };

    let room_key = ctx.accounts.room.key();

    // If any offset above is wrong, these seeds address some other account and
    // this fails here rather than four frames deep in a CPI.
    let (expected, _) = Pubkey::find_program_address(
        &[ROOM_SEED, host.as_ref(), &room_id.to_le_bytes()],
        &crate::ID,
    );
    require_keys_eq!(expected, room_key, HerdError::RoomLayoutDrift);

    let who = ctx.accounts.authority.key();
    require!(who == host || who == host_session, HerdError::NotTheHost);
    ctx.accounts.delegate_room(
        &ctx.accounts.authority,
        &[ROOM_SEED, host.as_ref(), &room_id.to_le_bytes()],
        DelegateConfig {
            validator,
            ..DelegateConfig::default()
        },
    )?;
    ctx.accounts.delegate_answers(
        &ctx.accounts.authority,
        &[ANSWERS_SEED, room_key.as_ref()],
        DelegateConfig {
            validator,
            ..DelegateConfig::default()
        },
    )?;

    msg!("herd: room and answers delegated, validator {:?}", validator);
    Ok(())
}

#[cfg(test)]
mod delegate_layout_tests {
    use super::*;
    use anchor_lang::AnchorSerialize;

    /// `handle_delegate` reads host, host_session and room_id out of the room's
    /// raw bytes, because the account is unchecked at that point. Those offsets
    /// have drifted once already - `room_id` was left at 40 when `host_session`
    /// was inserted ahead of it, and the only symptom was a signer-privilege
    /// error thrown by the delegation program. This serialises a real Room and
    /// reads it back the way the handler does, so the next insertion fails here
    /// instead of on devnet.
    #[test]
    fn the_delegate_offsets_match_the_struct() {
        let host = Pubkey::new_unique();
        let host_session = Pubkey::new_unique();
        let room_id: u64 = 0x0123_4567_89ab_cdef;

        let room = Room {
            host,
            host_session,
            room_id,
            stake: 50_000_000,
            round_seconds: 30,
            phase: Phase::Open,
            round: 0,
            round_ends_at: 0,
            rule: Rule::Undrawn,
            awaiting_rule: false,
            seats: [Seat {
                wallet: Pubkey::default(),
                session: Pubkey::default(),
                alive: false,
                answered_round: 0,
                has_answered: false,
            }; MAX_PLAYERS],
            seat_count: 0,
            last_round: 0,
            last_words: [[0u8; MAX_ANSWER]; MAX_PLAYERS],
            last_lengths: [0u8; MAX_PLAYERS],
            bump: 255,
            vault_bump: 255,
            answers_bump: 255,
        };

        // 8 bytes of discriminator, then the struct, exactly as on chain.
        let mut data = vec![0u8; 8];
        room.serialize(&mut data).unwrap();

        const HOST: usize = 8;
        const HOST_SESSION: usize = HOST + 32;
        const ROOM_ID: usize = HOST_SESSION + 32;

        assert_eq!(Pubkey::try_from(&data[HOST..HOST + 32]).unwrap(), host);
        assert_eq!(
            Pubkey::try_from(&data[HOST_SESSION..HOST_SESSION + 32]).unwrap(),
            host_session,
        );
        assert_eq!(
            u64::from_le_bytes(data[ROOM_ID..ROOM_ID + 8].try_into().unwrap()),
            room_id,
        );
    }
}

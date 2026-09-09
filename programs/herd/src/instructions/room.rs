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
) -> Result<()> {
    let room = &mut ctx.accounts.room;
    room.host = ctx.accounts.host.key();
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
    pub host: Signer<'info>,

    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump,
        has_one = host
    )]
    pub room: Box<Account<'info, Room>>,
}

pub fn handle_lock(ctx: Context<LockRoom>) -> Result<()> {
    let room = &mut ctx.accounts.room;
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
    #[account(mut)]
    pub host: Signer<'info>,

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
    // Seeds are re-derived from the account's own data by the CPI; we pass the
    // same ones the room was created with.
    let data = ctx.accounts.room.try_borrow_data()?;
    let host = Pubkey::try_from(&data[8..40]).map_err(|_| error!(HerdError::NotAPlayer))?;
    let room_id = u64::from_le_bytes(
        data[40..48]
            .try_into()
            .map_err(|_| error!(HerdError::NotAPlayer))?,
    );
    drop(data);

    let room_key = ctx.accounts.room.key();
    ctx.accounts.delegate_room(
        &ctx.accounts.host,
        &[ROOM_SEED, host.as_ref(), &room_id.to_le_bytes()],
        DelegateConfig {
            validator,
            ..DelegateConfig::default()
        },
    )?;
    ctx.accounts.delegate_answers(
        &ctx.accounts.host,
        &[ANSWERS_SEED, room_key.as_ref()],
        DelegateConfig {
            validator,
            ..DelegateConfig::default()
        },
    )?;

    msg!("herd: room and answers delegated, validator {:?}", validator);
    Ok(())
}

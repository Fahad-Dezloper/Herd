//! The public queue: paying to be put somewhere you did not choose.
//!
//! A private room is a code you send to people you know, and colluding in one is
//! not an attack - it is the party game working. A public room has strangers'
//! money in it, and the fixed rule ("the fewest people on a word go") would hand
//! it to any three friends who agreed on a word in advance.
//!
//! Rather than complicating the rule to punish them, this takes away the thing
//! that makes it work: sitting together. You buy a place in a line, and the
//! oracle decides which room you land in. There is nothing to coordinate,
//! because nobody - not the players, not whoever triggered the deal, not us -
//! chooses who ends up where.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_scoped_randomness_ix, RequestRandomnessParams,
};

use crate::error::HerdError;
use crate::instructions::room::tally_ending;
use crate::state::{
    Answers, Ending, Outcome, Phase, Queue, Room, Seat, Vault, Waiting, MAX_ANSWER, MAX_PLAYERS,
    PUBLIC_ROOM_SIZE, QUEUE_CAP,
};
use crate::{ANSWERS_SEED, EPHEMERAL_RENT_BUFFER, QUEUE_SEED, QUEUE_VAULT_SEED, ROOM_SEED, VAULT_SEED};

/* ------------------------------------------------------------ open a queue */

#[derive(Accounts)]
#[instruction(stake: u64)]
pub struct OpenQueue<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Queue::INIT_SPACE,
        seeds = [QUEUE_SEED, &stake.to_le_bytes()],
        bump
    )]
    pub queue: Box<Account<'info, Queue>>,

    /// Holds everybody's stake until they are dealt somewhere.
    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [QUEUE_VAULT_SEED, queue.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_open_queue(
    ctx: Context<OpenQueue>,
    stake: u64,
    round_seconds: u16,
) -> Result<()> {
    let queue = &mut ctx.accounts.queue;
    queue.stake = stake;
    queue.round_seconds = round_seconds.max(5);
    queue.waiting = [Waiting::empty(); QUEUE_CAP];
    queue.count = 0;
    queue.awaiting_deal = false;
    queue.dealing_into = 0;
    queue.bump = ctx.bumps.queue;
    queue.vault_bump = ctx.bumps.vault;

    let vault = &mut ctx.accounts.vault;
    vault.room = ctx.accounts.queue.key();
    vault.bump = ctx.bumps.vault;

    msg!("herd: queue open at {} a seat", stake);
    Ok(())
}

/* ------------------------------------------------------- open a public room */

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct OpenPublicRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [QUEUE_SEED, &queue.stake.to_le_bytes()],
        bump = queue.bump
    )]
    pub queue: Box<Account<'info, Queue>>,

    #[account(
        init,
        payer = payer,
        space = 8 + Room::INIT_SPACE,
        seeds = [ROOM_SEED, queue.key().as_ref(), &index.to_le_bytes()],
        bump
    )]
    pub room: Box<Account<'info, Room>>,

    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, room.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = payer,
        space = 8 + Answers::INIT_SPACE,
        seeds = [ANSWERS_SEED, room.key().as_ref()],
        bump
    )]
    pub answers: Box<Account<'info, Answers>>,

    pub system_program: Program<'info, System>,
}

/// Build a public table. Once, ever.
///
/// Public rooms are furniture: the same account is dealt a fresh game every
/// time the one before it finishes. Somebody has to pay to create it, and if
/// that were per game it would be a tax on whoever happened to trigger the deal.
/// Paid once, it is nothing.
pub fn handle_open_public_room(ctx: Context<OpenPublicRoom>, index: u64) -> Result<()> {
    let queue_key = ctx.accounts.queue.key();
    let stake = ctx.accounts.queue.stake;
    let round_seconds = ctx.accounts.queue.round_seconds;

    let room = &mut ctx.accounts.room;
    room.host = queue_key;
    // No person runs a dealt room, so there is no session key that speaks for
    // one. The seated players do it between them - see `is_operator`.
    room.host_session = Pubkey::default();
    room.room_id = index;
    room.stake = stake;
    room.round_seconds = round_seconds;
    room.phase = Phase::Open;
    room.round = 0;
    room.round_ends_at = 0;
    room.outcome = Outcome::Pending;
    room.ending = Ending::Split;
    room.dealt = true;
    room.coin_decided = false;
    room.awaiting_coin = false;
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
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.answers.to_account_info(),
            },
        ),
        EPHEMERAL_RENT_BUFFER,
    )?;

    msg!("herd: public room {} built", index);
    Ok(())
}

/* ---------------------------------------------------------- stand in line */

#[derive(Accounts)]
pub struct EnterQueue<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [QUEUE_SEED, &queue.stake.to_le_bytes()],
        bump = queue.bump
    )]
    pub queue: Box<Account<'info, Queue>>,

    #[account(
        mut,
        seeds = [QUEUE_VAULT_SEED, queue.key().as_ref()],
        bump = queue.vault_bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_enter_queue(
    ctx: Context<EnterQueue>,
    session: Pubkey,
    ending_vote: Ending,
) -> Result<()> {
    let stake = ctx.accounts.queue.stake;

    {
        let queue = &ctx.accounts.queue;
        require!((queue.count as usize) < QUEUE_CAP, HerdError::QueueFull);
        require!(
            !queue
                .waiting()
                .iter()
                .any(|w| w.wallet == ctx.accounts.player.key()),
            HerdError::AlreadyWaiting
        );
    }

    // Stake first, place in line second. If the transfer fails nobody is queued.
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

    let queue = &mut ctx.accounts.queue;
    let at = queue.count as usize;
    queue.waiting[at] = Waiting {
        wallet: ctx.accounts.player.key(),
        session,
        ending_vote,
    };
    queue.count += 1;

    msg!("herd: {} waiting", queue.count);
    Ok(())
}

/* --------------------------------------------------------- leave the line */

#[derive(Accounts)]
pub struct LeaveQueue<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [QUEUE_SEED, &queue.stake.to_le_bytes()],
        bump = queue.bump
    )]
    pub queue: Box<Account<'info, Queue>>,

    #[account(
        mut,
        seeds = [QUEUE_VAULT_SEED, queue.key().as_ref()],
        bump = queue.vault_bump
    )]
    pub vault: Box<Account<'info, Vault>>,
}

/// Stop waiting, and take the stake back.
///
/// A queue nobody joins is a queue you can never get out of. Waiting for five
/// more people who may not come tonight has to be reversible or the stake is
/// hostage to strangers turning up.
pub fn handle_leave_queue(ctx: Context<LeaveQueue>) -> Result<()> {
    require!(
        !ctx.accounts.queue.awaiting_deal,
        HerdError::DealInFlight
    );

    let who = ctx.accounts.player.key();
    let queue = &mut ctx.accounts.queue;
    let at = queue
        .waiting()
        .iter()
        .position(|w| w.wallet == who)
        .ok_or(error!(HerdError::NotWaiting))?;

    let count = queue.count as usize;
    for i in at..count - 1 {
        queue.waiting[i] = queue.waiting[i + 1];
    }
    queue.waiting[count - 1] = Waiting::empty();
    queue.count -= 1;

    let stake = queue.stake;
    let vault = ctx.accounts.vault.to_account_info();
    **vault.try_borrow_mut_lamports()? = vault
        .lamports()
        .checked_sub(stake)
        .ok_or(HerdError::Overflow)?;
    let player = ctx.accounts.player.to_account_info();
    **player.try_borrow_mut_lamports()? = player
        .lamports()
        .checked_add(stake)
        .ok_or(HerdError::Overflow)?;

    msg!("herd: left the queue, {} refunded", stake);
    Ok(())
}

/* -------------------------------------------------------------- the deal */

#[vrf]
#[derive(Accounts)]
pub struct Deal<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [QUEUE_SEED, &queue.stake.to_le_bytes()],
        bump = queue.bump
    )]
    pub queue: Box<Account<'info, Queue>>,

    #[account(
        mut,
        seeds = [ROOM_SEED, queue.key().as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump
    )]
    pub room: Box<Account<'info, Room>>,

    #[account(
        mut,
        seeds = [QUEUE_VAULT_SEED, queue.key().as_ref()],
        bump = queue.vault_bump
    )]
    pub queue_vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, room.key().as_ref()],
        bump = room.vault_bump
    )]
    pub room_vault: Box<Account<'info, Vault>>,

    /// CHECK: the oracle queue, validated against the SDK's known addresses.
    #[account(
        mut,
        constraint =
            oracle_queue.key() == ephemeral_rollups_sdk::vrf::consts::DEFAULT_QUEUE ||
            oracle_queue.key() == ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE ||
            oracle_queue.key() == ephemeral_rollups_sdk::vrf::consts::DEFAULT_TEST_QUEUE ||
            oracle_queue.key() == ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Ask the oracle to fill a room.
///
/// Anyone may call this - it takes the people at the front of a public line and
/// puts them somewhere none of them picked, which is not a decision anybody can
/// abuse by being the one to make it.
pub fn handle_deal(ctx: Context<Deal>, client_seed: u8) -> Result<()> {
    {
        let queue = &ctx.accounts.queue;
        let room = &ctx.accounts.room;
        require!(!queue.awaiting_deal, HerdError::DealInFlight);
        require!(
            (queue.count as usize) >= PUBLIC_ROOM_SIZE,
            HerdError::NotEnoughWaiting
        );
        require!(room.dealt, HerdError::NotAPublicRoom);
        // A room mid-game cannot take a new table. Settled and Open are both
        // free - one has paid out, the other has never been used.
        require!(
            room.phase == Phase::Open || room.phase == Phase::Settled,
            HerdError::RoomNotOpen
        );
    }

    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackDeal::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![
            ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                pubkey: ctx.accounts.queue.key(),
                is_signer: false,
                is_writable: true,
            },
            ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                pubkey: ctx.accounts.room.key(),
                is_signer: false,
                is_writable: true,
            },
            ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                pubkey: ctx.accounts.queue_vault.key(),
                is_signer: false,
                is_writable: true,
            },
            ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                pubkey: ctx.accounts.room_vault.key(),
                is_signer: false,
                is_writable: true,
            },
        ]),
        ..Default::default()
    });

    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

    let room_id = ctx.accounts.room.room_id;
    let queue = &mut ctx.accounts.queue;
    queue.awaiting_deal = true;
    queue.dealing_into = room_id;

    msg!("herd: deal requested for room {}", room_id);
    Ok(())
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackDeal<'info> {
    #[account(mut)]
    pub queue: Box<Account<'info, Queue>>,

    #[account(mut)]
    pub room: Box<Account<'info, Room>>,

    #[account(
        mut,
        seeds = [QUEUE_VAULT_SEED, queue.key().as_ref()],
        bump = queue.vault_bump
    )]
    pub queue_vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, room.key().as_ref()],
        bump = room.vault_bump
    )]
    pub room_vault: Box<Account<'info, Vault>>,
}

/// Shuffle the line and seat the first six.
///
/// Fisher-Yates over everybody waiting, which is the only shuffle where every
/// ordering is equally likely - taking the first six of a half-mixed line would
/// quietly favour whoever joined at the right moment, and that is exactly the
/// kind of thing a group of friends would find and use.
/// Fisher-Yates, seeded by the draw.
///
/// The only shuffle where every ordering is equally likely. Taking the first six
/// of a half-mixed line would quietly favour whoever joined at the right moment,
/// and a group of friends trying to sit together is exactly who would find that
/// and use it. One 32-byte draw has to drive up to 23 swaps, so it seeds a
/// generator rather than being spent a byte at a time.
pub fn shuffle(line: &mut [Waiting], randomness: &[u8; 32]) {
    let mut seed = u64::from_le_bytes(randomness[0..8].try_into().unwrap()) | 1;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };

    for i in (1..line.len()).rev() {
        let j = (next() % (i as u64 + 1)) as usize;
        line.swap(i, j);
    }
}

pub fn handle_callback_deal(
    ctx: Context<CallbackDeal>,
    randomness: [u8; 32],
) -> Result<()> {
    let queue = &mut ctx.accounts.queue;

    // A duplicate delivery must not deal twice.
    if !queue.awaiting_deal {
        msg!("herd: deal callback ignored, nothing outstanding");
        return Ok(());
    }
    if queue.dealing_into != ctx.accounts.room.room_id {
        msg!("herd: deal callback ignored, wrong room");
        return Ok(());
    }
    queue.awaiting_deal = false;

    let count = queue.count as usize;
    if count < PUBLIC_ROOM_SIZE {
        // Somebody left between the request and the answer.
        msg!("herd: the line emptied before the deal landed");
        return Ok(());
    }

    shuffle(&mut queue.waiting[..count], &randomness);

    let room = &mut ctx.accounts.room;
    let stake = queue.stake;

    room.phase = Phase::Playing;
    room.round = 1;
    room.round_ends_at = 0; // set when the room is sealed, as always
    room.outcome = Outcome::Pending;
    room.coin_decided = false;
    room.awaiting_coin = false;
    room.last_round = 0;
    room.last_words = [[0u8; MAX_ANSWER]; MAX_PLAYERS];
    room.last_lengths = [0u8; MAX_PLAYERS];
    room.seats = [Seat::empty(); MAX_PLAYERS];
    room.seat_count = PUBLIC_ROOM_SIZE as u8;

    let mut coins = 0usize;
    for (i, w) in queue.waiting[..PUBLIC_ROOM_SIZE].iter().enumerate() {
        room.seats[i] = Seat {
            wallet: w.wallet,
            session: w.session,
            alive: true,
            answered_round: 0,
            has_answered: false,
            ending_vote: w.ending_vote,
        };
        if w.ending_vote == Ending::Coin {
            coins += 1;
        }
    }
    room.ending = tally_ending(coins, PUBLIC_ROOM_SIZE - coins);

    // The line closes up behind the people who were dealt.
    for i in 0..count - PUBLIC_ROOM_SIZE {
        queue.waiting[i] = queue.waiting[i + PUBLIC_ROOM_SIZE];
    }
    for i in (count - PUBLIC_ROOM_SIZE)..count {
        queue.waiting[i] = Waiting::empty();
    }
    queue.count -= PUBLIC_ROOM_SIZE as u8;

    // Their stakes follow them out of the line and into the room's own vault,
    // which is the only account that ever pays a winner.
    let moving = stake
        .checked_mul(PUBLIC_ROOM_SIZE as u64)
        .ok_or(HerdError::Overflow)?;
    let queue_vault = ctx.accounts.queue_vault.to_account_info();
    **queue_vault.try_borrow_mut_lamports()? = queue_vault
        .lamports()
        .checked_sub(moving)
        .ok_or(HerdError::Overflow)?;
    let room_vault = ctx.accounts.room_vault.to_account_info();
    **room_vault.try_borrow_mut_lamports()? = room_vault
        .lamports()
        .checked_add(moving)
        .ok_or(HerdError::Overflow)?;

    msg!(
        "herd: room {} dealt six players, {} still waiting",
        room.room_id,
        queue.count
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: usize) -> Vec<Waiting> {
        (0..n)
            .map(|i| Waiting {
                wallet: Pubkey::new_from_array([i as u8; 32]),
                session: Pubkey::default(),
                ending_vote: Ending::Split,
            })
            .collect()
    }

    fn seed(n: u8) -> [u8; 32] {
        let mut r = [0u8; 32];
        for (i, b) in r.iter_mut().enumerate() {
            *b = n.wrapping_mul(31).wrapping_add(i as u8);
        }
        r
    }

    /// Everybody who was waiting is still waiting, once.
    ///
    /// A shuffle that dropped or duplicated somebody would take a stake and give
    /// nothing back for it, and the loss would look like a bug in the deal
    /// rather than in the shuffle.
    #[test]
    fn the_shuffle_loses_nobody() {
        for n in [6usize, 7, 12, 24] {
            for s in 0u8..40 {
                let mut l = line(n);
                shuffle(&mut l, &seed(s));

                let mut seen: Vec<u8> = l.iter().map(|w| w.wallet.to_bytes()[0]).collect();
                seen.sort_unstable();
                assert_eq!(
                    seen,
                    (0..n as u8).collect::<Vec<_>>(),
                    "n={n} seed={s} lost or duplicated somebody"
                );
            }
        }
    }

    /// No seat in the line is a better seat.
    ///
    /// This is the property the whole public queue rests on. If joining at a
    /// particular moment made you more likely to be dealt, friends would simply
    /// join at that moment together, and the shuffle would be decoration.
    #[test]
    fn where_you_joined_does_not_change_your_odds() {
        const N: usize = 12;
        const DRAWS: usize = 4000;

        let mut dealt = [0usize; N];
        for s in 0..DRAWS {
            let mut l = line(N);
            let mut r = [0u8; 32];
            for (i, b) in r.iter_mut().enumerate() {
                b.clone_from(&(((s * 2_654_435_761) >> (i % 4 * 8)) as u8));
            }
            shuffle(&mut l, &r);
            for w in &l[..PUBLIC_ROOM_SIZE] {
                dealt[w.wallet.to_bytes()[0] as usize] += 1;
            }
        }

        // Six of twelve are dealt, so everyone should come out near half.
        let expected = DRAWS * PUBLIC_ROOM_SIZE / N;
        for (who, &times) in dealt.iter().enumerate() {
            let off = (times as f64 - expected as f64).abs() / expected as f64;
            assert!(
                off < 0.12,
                "position {who} was dealt {times} times against {expected} expected",
            );
        }
    }

    /// Two people cannot arrange to be dealt together by arriving together.
    ///
    /// The attack the queue exists to stop, stated as a number: if standing next
    /// to your friend in the line helped, this would be well above the chance
    /// any two of twelve share a six-seat room.
    #[test]
    fn joining_next_to_your_friend_does_not_help() {
        const N: usize = 12;
        const DRAWS: usize = 4000;

        let mut together = 0;
        for s in 0..DRAWS {
            let mut l = line(N);
            let mut r = [0u8; 32];
            for (i, b) in r.iter_mut().enumerate() {
                b.clone_from(&(((s * 40_503 + i * 7) % 251) as u8));
            }
            shuffle(&mut l, &r);

            let dealt: Vec<u8> = l[..PUBLIC_ROOM_SIZE]
                .iter()
                .map(|w| w.wallet.to_bytes()[0])
                .collect();
            // Seats 0 and 1 in the line: two friends who joined back to back.
            if dealt.contains(&0) && dealt.contains(&1) {
                together += 1;
            }
        }

        // Both dealt into a six-seat room out of twelve: 6/12 * 5/11 = 22.7%.
        let rate = together as f64 / DRAWS as f64;
        assert!(
            (rate - 0.227).abs() < 0.05,
            "friends who queued together landed in the same room {:.1}% of the time",
            rate * 100.0,
        );
    }
}

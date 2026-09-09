//! Paying out. Base layer, and only ever the base layer.

use anchor_lang::prelude::*;

use crate::error::HerdError;
use crate::state::{Phase, Room, Vault};
use crate::{ROOM_SEED, VAULT_SEED};

#[derive(Accounts)]
pub struct Settle<'info> {
    /// Anyone may trigger the payout. It pays the survivors and nobody else,
    /// whoever asks, so there is no reason to gate it - and gating it would let
    /// a sore loser refuse to pay by doing nothing.
    pub caller: Signer<'info>,

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
    // Survivors are passed as remaining_accounts, in seat order.
}

/// Split the pot between whoever is still standing.
///
/// The winners arrive as remaining accounts and are checked against the room's
/// own seats rather than trusted: the caller says who to pay, and the program
/// refuses unless that list is exactly the survivors, in seat order.
///
/// A room that reaches the round cap with several players still alive splits
/// between them. A room where the last survivors were culled together - which
/// the round rules prevent, but which is worth not depending on - refunds
/// everybody rather than keeping the money.
pub fn handle_settle(ctx: Context<Settle>) -> Result<()> {
    let room = &ctx.accounts.room;
    // Order matters for the message: a settled room is finished too, so
    // checking Finished first would report "the game is not over" about a game
    // that is over and paid.
    require!(room.phase != Phase::Settled, HerdError::AlreadySettled);
    require!(room.phase == Phase::Finished, HerdError::NotFinished);

    let survivors: Vec<Pubkey> = room
        .seats()
        .iter()
        .filter(|s| s.alive)
        .map(|s| s.wallet)
        .collect();

    // Nobody left standing: give everyone their stake back.
    let payees: Vec<Pubkey> = if survivors.is_empty() {
        room.seats().iter().map(|s| s.wallet).collect()
    } else {
        survivors
    };

    require!(
        ctx.remaining_accounts.len() == payees.len(),
        HerdError::WrongWinners
    );
    for (account, expected) in ctx.remaining_accounts.iter().zip(payees.iter()) {
        require_keys_eq!(*account.key, *expected, HerdError::WrongWinners);
    }

    let vault_info = ctx.accounts.vault.to_account_info();
    let rent_exempt = Rent::get()?.minimum_balance(vault_info.data_len());
    let payable = vault_info.lamports().saturating_sub(rent_exempt);

    let each = payable
        .checked_div(payees.len() as u64)
        .ok_or(HerdError::Overflow)?;
    require!(each > 0, HerdError::Overflow);

    for account in ctx.remaining_accounts.iter() {
        **vault_info.try_borrow_mut_lamports()? = vault_info
            .lamports()
            .checked_sub(each)
            .ok_or(HerdError::Overflow)?;
        **account.try_borrow_mut_lamports()? = account
            .lamports()
            .checked_add(each)
            .ok_or(HerdError::Overflow)?;
    }

    let room = &mut ctx.accounts.room;
    room.phase = Phase::Settled;

    msg!("herd: paid {} lamports to each of {}", each, payees.len());
    Ok(())
}

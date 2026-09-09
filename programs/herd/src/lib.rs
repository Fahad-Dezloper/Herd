//! Herd - you win by saying what everyone else says.
//!
//! A question goes out, everyone answers at the same time in secret, and then a
//! group is culled. Last one standing takes the pot.
//!
//! Three things make this a MagicBlock game rather than a website:
//!
//! **The answers are sealed.** They live in a room account delegated to a
//! Private ER with a permission that has no members at all, so the program
//! inside the rollup can read them and nobody else can - not other players, not
//! the host, not the node operator. If answers were visible as they landed you
//! would simply copy the crowd and the game would be pointless. On a public
//! chain the only alternative is commit-reveal: two transactions per player per
//! round, and anyone who declines to reveal wrecks the round for everyone.
//!
//! **The oracle deals the rooms.** The rule itself is fixed and simple - the
//! fewest people on a word strayed, and they go - which leaves one serious
//! attack: three friends agreeing on a word beforehand are never the smallest
//! group, so they would win every time, forever. The answer is not to complicate
//! the rule but to take away the room. A public seat is bought by standing in a
//! queue, and VRF decides who is dealt into which room, so friends cannot
//! arrange to sit together. Private rooms still open by code, where playing with
//! people you know is the point rather than the problem.
//!
//! **The money never leaves Solana.** Stakes sit in a vault PDA that is never
//! delegated. The rollup decides who won; it cannot pay anybody.

use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

pub use instructions::*;
pub use state::*;

declare_id!("BvKkFUEdiin8KcF6m9CBqYoN9FncGFFy4cxhe5QZSvWN");

pub const ROOM_SEED: &[u8] = b"room";
pub const VAULT_SEED: &[u8] = b"vault";
pub const ANSWERS_SEED: &[u8] = b"answers";
pub const QUEUE_SEED: &[u8] = b"queue";
pub const QUEUE_VAULT_SEED: &[u8] = b"qvault";

/// The only validator a public room may be handed to.
///
/// A private room's host picks, and the people who joined their code decided to
/// trust them. A dealt room has no host, so anybody may hand it to a rollup -
/// which would be an invitation to hand it to a rollup you run and read six
/// strangers' sealed answers. Pinning it means the person who triggers the
/// delegation is choosing nothing at all.
pub const PUBLIC_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

/// Lamports the room carries above its own rent exemption.
///
/// Inside a rollup the room sponsors its own ephemeral permission, and the
/// validator charges ER-local rent for it. That cannot come from the transaction
/// fee payer: a fee payer whose balance moves inside a rollup must itself be
/// delegated, and `delegate_ephemeral_balance` delegates an escrow PDA, never a
/// wallet - so no wallet can ever satisfy it. The room is delegated, so the room
/// pays. Anchor's `init` funds exactly the rent-exempt minimum, which would
/// leave it nothing to pay with.
pub const EPHEMERAL_RENT_BUFFER: u64 = 200_000;

#[ephemeral_rollups_sdk::anchor::ephemeral]
#[program]
pub mod herd {
    use super::*;

    /* ------------------------------------------------------------ Solana */

    /// Open a room. Base layer.
    pub fn create_room(
        ctx: Context<CreateRoom>,
        room_id: u64,
        stake: u64,
        round_seconds: u16,
        host_session: Pubkey,
    ) -> Result<()> {
        room::handle_create(ctx, room_id, stake, round_seconds, host_session)
    }

    /// Take a seat and pay the stake. Base layer.
    ///
    /// `session` is a throwaway key the app holds. It signs answers inside the
    /// rollup so a fifteen-second round does not need a fingerprint, and it can
    /// do nothing else.
    /// `ending_vote` is this player's say in what happens if the room comes
    /// down to two: share the pot, or let the oracle pick one. Majority at the
    /// door decides it for the whole table, ties go to a split.
    pub fn join_room(ctx: Context<JoinRoom>, session: Pubkey, ending_vote: Ending) -> Result<()> {
        room::handle_join(ctx, session, ending_vote)
    }

    /* ------------------------------------------------------- public rooms */

    /// Open the line for a given stake. Once per price.
    pub fn open_queue(ctx: Context<OpenQueue>, stake: u64, round_seconds: u16) -> Result<()> {
        queue::handle_open_queue(ctx, stake, round_seconds)
    }

    /// Build a public table. Once, ever - dealt rooms are reused.
    pub fn open_public_room(ctx: Context<OpenPublicRoom>, index: u64) -> Result<()> {
        queue::handle_open_public_room(ctx, index)
    }

    /// Pay a stake and wait to be put somewhere you did not choose.
    pub fn enter_queue(
        ctx: Context<EnterQueue>,
        session: Pubkey,
        ending_vote: Ending,
    ) -> Result<()> {
        queue::handle_enter_queue(ctx, session, ending_vote)
    }

    /// Stop waiting, and take the stake back.
    pub fn leave_queue(ctx: Context<LeaveQueue>) -> Result<()> {
        queue::handle_leave_queue(ctx)
    }

    /// Ask the oracle to fill a room from the line.
    pub fn deal(ctx: Context<Deal>, client_seed: u8) -> Result<()> {
        queue::handle_deal(ctx, client_seed)
    }

    /// The oracle's answer: shuffle the line and seat the first six.
    pub fn callback_deal(ctx: Context<CallbackDeal>, randomness: [u8; 32]) -> Result<()> {
        queue::handle_callback_deal(ctx, randomness)
    }

    /* ------------------------------------------------------ private rooms */

    /// Take your seat back and your stake with it. Base layer, open rooms only.
    pub fn leave_room(ctx: Context<LeaveRoom>) -> Result<()> {
        room::handle_leave(ctx)
    }

    /// Close the door and start round one. Base layer, host only.
    pub fn lock_room(ctx: Context<LockRoom>) -> Result<()> {
        room::handle_lock(ctx)
    }

    /// Hand the room and its answers to a rollup. Base layer.
    ///
    /// `validator` pins which one. Passing the TEE identity is what makes the
    /// answers secret; on a plain rollup the room is fast but readable, which
    /// defeats the entire point of moving it.
    pub fn delegate_room(ctx: Context<DelegateRoom>, validator: Option<Pubkey>) -> Result<()> {
        room::handle_delegate(ctx, validator)
    }

    /* ------------------------------------------------------------ rollup */

    /// Seal the room so nobody can read the answers. Runs inside the rollup.
    pub fn seal_room(ctx: Context<SealRoom>) -> Result<()> {
        play::handle_seal(ctx)
    }

    /// Lock in an answer. Runs inside the rollup, signed by the session key.
    pub fn submit_answer(ctx: Context<SubmitAnswer>, answer: Vec<u8>) -> Result<()> {
        play::handle_submit(ctx, answer)
    }

    /// Close the round and ask the oracle which way it is scored.
    ///
    /// Permissionless once the clock runs out, so a room cannot be held open by
    /// a player who benefits from waiting.
    pub fn close_round(ctx: Context<CloseRound>, client_seed: u8) -> Result<()> {
        play::handle_close(ctx, client_seed)
    }

    /// The oracle's answer: draw the rule, group the answers, cull.
    pub fn callback_round(ctx: Context<CallbackRound>, randomness: [u8; 32]) -> Result<()> {
        play::handle_callback(ctx, randomness)
    }

    /// Push the finished room back to Solana so the pot can be paid.
    pub fn finish_room(ctx: Context<FinishRoom>) -> Result<()> {
        play::handle_finish(ctx)
    }

    /* ------------------------------------------------------------ payout */

    /// Pay the survivors. Base layer.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        settle::handle_settle(ctx)
    }
}

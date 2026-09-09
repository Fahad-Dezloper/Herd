use anchor_lang::prelude::*;

/// Seats in a room.
///
/// Twelve is a deliberate ceiling rather than an arbitrary one. Collusion is the
/// real threat to this game - a bloc that can be the largest group survives
/// forever - and the defence is that the rule is drawn after answers are sealed,
/// which works at any size. Twelve keeps the room account near a kilobyte so a
/// round costs one small write.
pub const MAX_PLAYERS: usize = 12;

/// Longest answer we store. Fixed width on purpose: answers live inside the
/// room account, so a round creates no new accounts, charges no ER-local rent,
/// and never moves the fee payer's balance.
pub const MAX_ANSWER: usize = 24;

/// Hard stop, so a room that keeps deadlocking still ends and pays out.
pub const MAX_ROUNDS: u16 = 12;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub struct Seat {
    /// Pays the stake and receives the payout.
    pub wallet: Pubkey,
    /// Signs answers inside the rollup so a 15-second round does not need a
    /// fingerprint. It can do nothing else - see `submit_answer`.
    pub session: Pubkey,
    pub alive: bool,
    /// The round this seat last answered in.
    ///
    /// Public on purpose. Seeing that someone has answered is most of the
    /// tension in a fifteen-second round; seeing *what* they answered would end
    /// the game. The text lives in `Answers`, which nobody can read.
    pub answered_round: u16,
    /// Whether `answered_round` refers to a real answer rather than seat zero
    /// never having played.
    pub has_answered: bool,
}

impl Seat {
    pub fn empty() -> Self {
        Self {
            wallet: Pubkey::default(),
            session: Pubkey::default(),
            alive: false,
            answered_round: 0,
            has_answered: false,
        }
    }

    /// Whether this seat answered the round in question.
    pub fn answered(&self, round: u16) -> bool {
        self.has_answered && self.answered_round == round
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Phase {
    /// Taking players and stakes. Base layer.
    Open,
    /// Delegated to a rollup, rounds running.
    Playing,
    /// A winner is known and the room has come back to Solana.
    Finished,
    /// The pot has been paid out.
    Settled,
}

/// Which way this round is scored.
///
/// Drawn by VRF *after* every answer is sealed, which is the entire defence
/// against collusion: a bloc that agrees on one answer is the largest group,
/// and half the time being the largest group is what kills you.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Rule {
    /// Not drawn yet. Nobody, including the players, can know which way it goes.
    Undrawn,
    /// The smallest groups are culled. Stay with the crowd.
    MajoritySurvives,
    /// The largest groups are culled. Stay away from the crowd.
    MinoritySurvives,
}

#[account]
#[derive(InitSpace)]
pub struct Room {
    pub host: Pubkey,

    /// The host's session key, allowed to run the room but never to spend it.
    ///
    /// Locking the door and handing the room to a rollup are not money
    /// decisions - they cannot move a lamport, and the host has already
    /// committed by paying to open the room. Making them need the wallet meant
    /// two more fingerprints in the middle of setting up a game, for no security
    /// anyone was getting. The session key does them instead. It still cannot
    /// take a seat, settle, or touch the vault.
    pub host_session: Pubkey,

    pub room_id: u64,
    /// Per player, paid once at the door. The pot never grows after that.
    pub stake: u64,
    pub round_seconds: u16,

    pub phase: Phase,
    pub round: u16,
    /// Unix time after which the round can be closed by anyone.
    pub round_ends_at: i64,
    pub rule: Rule,
    /// A VRF request is outstanding. Blocks a second request for the same round.
    pub awaiting_rule: bool,

    pub seats: [Seat; MAX_PLAYERS],
    pub seat_count: u8,

    /// What everyone said in the round that just finished, and which round that
    /// was.
    ///
    /// Published deliberately. Answers are secret while the window is open,
    /// because seeing them would let you copy the crowd and there would be no
    /// game - but the moment a round is scored that reason is gone, and seeing
    /// who said what is the best part of it. So the resolved round's words are
    /// copied out of the sealed account into this one, where anybody can read
    /// them.
    pub last_round: u16,
    pub last_words: [[u8; MAX_ANSWER]; MAX_PLAYERS],
    pub last_lengths: [u8; MAX_PLAYERS],

    pub bump: u8,
    pub vault_bump: u8,
    pub answers_bump: u8,
}

impl Room {
    pub fn seats(&self) -> &[Seat] {
        &self.seats[..self.seat_count as usize]
    }

    pub fn alive_count(&self) -> usize {
        self.seats().iter().filter(|s| s.alive).count()
    }

    pub fn seat_of(&self, session: &Pubkey) -> Option<usize> {
        self.seats().iter().position(|s| s.session == *session)
    }

    pub fn pot(&self) -> u64 {
        self.stake.saturating_mul(self.seat_count as u64)
    }

    pub fn said_last(&self, seat: usize) -> &[u8] {
        &self.last_words[seat][..self.last_lengths[seat] as usize]
    }
}

/// Holds the stakes. Never delegated to a rollup.
///
/// That is not a detail, it is the security argument. The room goes to a rollup
/// so answers can be sealed and rounds can be fast; the money stays on Solana.
/// A rollup that misbehaves can decide the game wrongly, and still cannot move a
/// lamport - payouts happen here, from state the rollup has committed back and
/// this program has checked.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub room: Pubkey,
    pub bump: u8,
}

/// What everyone said this round. Sealed, and delegated alongside the room.
///
/// Split from `Room` for one reason: a sealed account is invisible over RPC to
/// everybody, which is exactly right for answers and useless for everything
/// else. Players still need to see the round number, the clock and who is left,
/// so the public half of the game stays in `Room` and only the words move here.
///
/// The program running inside the rollup reads this normally - sealing gates
/// RPC, not execution, which was worth confirming before relying on it.
#[account]
#[derive(InitSpace)]
pub struct Answers {
    pub room: Pubkey,
    /// The round these words belong to. Cleared between rounds so a stale
    /// answer cannot be counted twice.
    pub round: u16,
    pub words: [[u8; MAX_ANSWER]; MAX_PLAYERS],
    pub lengths: [u8; MAX_PLAYERS],
    pub bump: u8,
}

impl Answers {
    pub fn said(&self, seat: usize) -> &[u8] {
        &self.words[seat][..self.lengths[seat] as usize]
    }

    pub fn clear(&mut self) {
        self.lengths = [0u8; MAX_PLAYERS];
    }
}

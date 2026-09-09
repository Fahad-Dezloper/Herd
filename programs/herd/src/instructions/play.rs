//! The round loop. Everything here runs inside the rollup.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, Member};
use ephemeral_rollups_sdk::anchor::{commit, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_scoped_randomness_ix, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::{self as vrf_api};

use crate::error::HerdError;
use crate::state::{Answers, Ending, Phase, Room, Rule, MAX_ANSWER, MAX_PLAYERS, MAX_ROUNDS};
use crate::{ANSWERS_SEED, ROOM_SEED};

/* ------------------------------------------------------------------- seal */

#[derive(Accounts)]
pub struct SealRoom<'info> {
    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump
    )]
    pub room: Box<Account<'info, Room>>,

    #[account(
        mut,
        seeds = [ANSWERS_SEED, room.key().as_ref()],
        bump = room.answers_bump,
        has_one = room
    )]
    pub answers: Box<Account<'info, Answers>>,

    /// CHECK: derived and validated by the permission program.
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: collects ER-local rent; address-constrained.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,

    /// CHECK: runtime builtin; address-constrained.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,

    /// CHECK: access-control program; address-constrained.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

/// Make the room unreadable, and start the clock.
///
/// The member list is empty on purpose. Listing the players would be worse than
/// useless: they must not read each other's answers. The program running inside
/// the rollup can still see everything it needs; every reader outside it, owner
/// included, gets nothing.
///
/// Needs no signature. Whoever submits this can only make a room private to
/// nobody - there is no version of it that leaks anything - and requiring the
/// host to be online would leave rooms readable while they wait.
pub fn handle_seal(ctx: Context<SealRoom>) -> Result<()> {
    {
        let room = &ctx.accounts.room;
        require!(room.phase == Phase::Playing, HerdError::NotPlaying);
    }

    let room_key = ctx.accounts.room.key();
    let bump = ctx.accounts.answers.bump;
    let seeds: &[&[u8]] = &[ANSWERS_SEED, room_key.as_ref(), &[bump]];

    CreateEphemeralPermissionCpi {
        permissioned_account: ctx.accounts.answers.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        // The sealed account pays its own rent; a wallet fee payer cannot.
        payer: ctx.accounts.answers.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        args: EphemeralMembersArgs {
            is_private: true,
            members: Vec::<Member>::new(),
        },
    }
    .invoke_signed(&[seeds])?;

    let now = Clock::get()?.unix_timestamp;
    let room = &mut ctx.accounts.room;
    room.round_ends_at = now + room.round_seconds as i64;

    msg!("herd: answers sealed, round 1 closes at {}", room.round_ends_at);
    Ok(())
}

/* ----------------------------------------------------------------- answer */

#[derive(Accounts)]
pub struct SubmitAnswer<'info> {
    /// The throwaway key registered at join. It signs answers and nothing else -
    /// it cannot join, cannot settle, cannot touch the vault.
    pub session: Signer<'info>,

    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump
    )]
    pub room: Box<Account<'info, Room>>,

    #[account(
        mut,
        seeds = [ANSWERS_SEED, room.key().as_ref()],
        bump = room.answers_bump,
        has_one = room
    )]
    pub answers: Box<Account<'info, Answers>>,
}

pub fn handle_submit(ctx: Context<SubmitAnswer>, answer: Vec<u8>) -> Result<()> {
    require!(!answer.is_empty(), HerdError::EmptyAnswer);
    require!(answer.len() <= MAX_ANSWER, HerdError::AnswerTooLong);

    let now = Clock::get()?.unix_timestamp;
    let room = &mut ctx.accounts.room;

    require!(room.phase == Phase::Playing, HerdError::NotPlaying);
    require!(now <= room.round_ends_at, HerdError::RoundClosed);
    require!(!room.awaiting_rule, HerdError::RoundClosed);

    let index = room
        .seat_of(&ctx.accounts.session.key())
        .ok_or(HerdError::NotAPlayer)?;
    let round = room.round;

    require!(room.seats[index].alive, HerdError::Eliminated);
    require!(
        !room.seats[index].answered(round),
        HerdError::AlreadyAnswered
    );

    // Normalise here rather than trusting the client. Two players who both meant
    // "Apple" must land in the same group whatever their keyboard did.
    let mut buffer = [0u8; MAX_ANSWER];
    let mut len = 0usize;
    for byte in answer.iter() {
        let c = byte.to_ascii_lowercase();
        if c == b' ' && (len == 0 || buffer[len - 1] == b' ') {
            continue; // collapse runs of spaces and drop leading ones
        }
        buffer[len] = c;
        len += 1;
    }
    while len > 0 && buffer[len - 1] == b' ' {
        len -= 1;
    }
    require!(len > 0, HerdError::EmptyAnswer);

    // What was said goes into the sealed account; that it was said goes into the
    // public one. Seeing "answer sealed" appear next to a name is the whole
    // tension of the round, and it costs nothing away.
    let answers = &mut ctx.accounts.answers;
    if answers.round != round {
        answers.round = round;
        answers.clear();
    }
    answers.words[index] = buffer;
    answers.lengths[index] = len as u8;

    let seat = &mut room.seats[index];
    seat.answered_round = round;
    seat.has_answered = true;

    Ok(())
}

/* ------------------------------------------------------------ close round */

#[vrf]
#[derive(Accounts)]
pub struct CloseRound<'info> {
    /// Anyone may close a round once the clock has run out. Leaving it to the
    /// players would let whoever benefits from waiting simply not act.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump
    )]
    pub room: Box<Account<'info, Room>>,

    #[account(
        mut,
        seeds = [ANSWERS_SEED, room.key().as_ref()],
        bump = room.answers_bump,
        has_one = room
    )]
    pub answers: Box<Account<'info, Answers>>,

    /// CHECK: one of the known oracle queues.
    #[account(
        mut,
        constraint =
            oracle_queue.key() == vrf_api::consts::DEFAULT_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_TEST_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

pub fn handle_close(ctx: Context<CloseRound>, client_seed: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    {
        let room = &ctx.accounts.room;
        require!(room.phase == Phase::Playing, HerdError::NotPlaying);
        require!(now > room.round_ends_at, HerdError::RoundStillOpen);
        require!(!room.awaiting_rule, HerdError::RuleAlreadyRequested);
    }

    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackRound::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![
            ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                pubkey: ctx.accounts.room.key(),
                is_signer: false,
                is_writable: true,
            },
            ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                pubkey: ctx.accounts.answers.key(),
                is_signer: false,
                is_writable: true,
            },
        ]),
        ..Default::default()
    });

    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

    // Mark the request before it can be fulfilled. Two live requests for one
    // round would let whoever asked second pick which answer they liked.
    let room = &mut ctx.accounts.room;
    room.awaiting_rule = true;

    msg!("herd: round {} closed, rule requested", room.round);
    Ok(())
}

/* --------------------------------------------------------------- callback */

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackRound<'info> {
    #[account(mut)]
    pub room: Box<Account<'info, Room>>,

    #[account(mut, has_one = room)]
    pub answers: Box<Account<'info, Answers>>,
}

pub fn handle_callback(ctx: Context<CallbackRound>, randomness: [u8; 32]) -> Result<()> {
    let room = &mut ctx.accounts.room;

    // A duplicate delivery must not run the round twice. `awaiting_rule` is set
    // when the request goes out and cleared here, so a second callback for the
    // same round finds nothing to do.
    if !room.awaiting_rule || room.phase != Phase::Playing {
        msg!("herd: callback ignored, no request outstanding");
        return Ok(());
    }

    let rule = if randomness[0] % 2 == 0 {
        Rule::MajoritySurvives
    } else {
        Rule::MinoritySurvives
    };
    room.rule = rule;
    room.awaiting_rule = false;

    let answers = &mut ctx.accounts.answers;

    // Publish the round's words before scoring it. The reason to hide them
    // expires the instant the window closes, and the reveal is the part of the
    // game people actually play for.
    room.last_round = room.round;
    room.last_words = answers.words;
    room.last_lengths = answers.lengths;

    let culled = resolve_round(room, answers, rule);
    msg!(
        "herd: round {} scored {:?}, {} culled, {} left",
        room.round,
        rule,
        culled,
        room.alive_count()
    );

    // Down to two, and the room has to be ended deliberately - no heads-up
    // round can ever cull anybody (same word is one group of two, different
    // words are two groups of one, and both rules would empty the room, so the
    // guard stops them). Left alone, the last two would trade words until the
    // round cap with nothing at stake. The table voted on this at the door.
    if room.alive_count() == 2 {
        match room.ending {
            Ending::Split => {
                msg!("herd: two left and the table voted to split");
            }
            Ending::Coin => {
                // The same draw that decided the rule decides this. Byte 0 is
                // already spoken for; byte 1 is independent of it and just as
                // unpredictable, so the flip costs no second oracle round trip
                // and no extra round of waiting.
                flip_heads_up(room, randomness[1]);
                room.coin_decided = true;
                msg!("herd: two left, the coin fell - one takes it all");
            }
        }
        room.phase = Phase::Finished;
        return Ok(());
    }

    if room.alive_count() <= 1 || room.round >= MAX_ROUNDS {
        room.phase = Phase::Finished;
        return Ok(());
    }

    // Next round. Answers are cleared so a stale one cannot count twice.
    //
    // `rule` deliberately keeps the value that was just drawn rather than being
    // reset. It is the most important thing that happened in the round, and a
    // client polling a second later would otherwise find it already erased and
    // have nothing to show. It says nothing about the next draw - each one is an
    // independent request to the oracle - and `awaiting_rule` is what marks a
    // round whose rule is not yet decided.
    room.round += 1;
    for seat in room.seats.iter_mut() {
        seat.has_answered = false;
    }
    answers.clear();
    room.round_ends_at = Clock::get()?.unix_timestamp + room.round_seconds as i64;

    Ok(())
}

/// Group the answers and cull, returning how many went out.
///
/// Anyone still alive who did not answer is treated as their own group of one -
/// silence is straying. The one thing that never happens is emptying the room:
/// if the rule would cull every survivor, which is what an evenly split field
/// produces, nobody goes and the next round starts with the same players. That
/// is not a special case bolted on, it is the difference between a deadlock and
/// a game with no winner.
/// Cull one of the last two at random, leaving a single winner.
///
/// The byte comes from the same VRF draw that decided the round's rule. Byte 0
/// is already spoken for; byte 1 is independent of it and just as unpredictable,
/// so the flip costs no second trip to the oracle and no extra round of waiting.
pub fn flip_heads_up(room: &mut Room, byte: u8) {
    let keep_second = byte % 2 == 1;
    let mut seen = 0;
    for seat in room.seats.iter_mut().filter(|s| s.alive) {
        if (seen == 1) != keep_second {
            seat.alive = false;
        }
        seen += 1;
    }
}

pub fn resolve_round(room: &mut Room, answers: &Answers, rule: Rule) -> usize {
    let count = room.seat_count as usize;
    let round = room.round;

    // Group sizes, computed pairwise. Twelve seats makes this trivial.
    let mut group_of = [usize::MAX; MAX_PLAYERS];
    let mut sizes = [0usize; MAX_PLAYERS];
    let mut groups = 0usize;

    for i in 0..count {
        if !room.seats[i].alive {
            continue;
        }
        if !room.seats[i].answered(round) {
            // A group of its own that nobody else can join.
            group_of[i] = groups;
            sizes[groups] = 1;
            groups += 1;
            continue;
        }
        let mut found = None;
        for j in 0..i {
            if room.seats[j].alive
                && room.seats[j].answered(round)
                && answers.said(j) == answers.said(i)
            {
                found = Some(group_of[j]);
                break;
            }
        }
        match found {
            Some(g) => {
                group_of[i] = g;
                sizes[g] += 1;
            }
            None => {
                group_of[i] = groups;
                sizes[groups] = 1;
                groups += 1;
            }
        }
    }

    if groups == 0 {
        return 0;
    }

    let live_sizes = &sizes[..groups];
    let target = match rule {
        Rule::MajoritySurvives => *live_sizes.iter().min().unwrap(),
        Rule::MinoritySurvives => *live_sizes.iter().max().unwrap(),
        Rule::Undrawn => return 0,
    };

    let doomed: usize = live_sizes.iter().filter(|&&s| s == target).sum();
    let alive = room.alive_count();
    if doomed >= alive {
        msg!("herd: every group is the same size - nobody strays, nobody goes");
        return 0;
    }

    let mut culled = 0;
    for i in 0..count {
        if room.seats[i].alive && group_of[i] != usize::MAX && sizes[group_of[i]] == target {
            room.seats[i].alive = false;
            culled += 1;
        }
    }
    culled
}

/* ----------------------------------------------------------------- finish */

#[commit]
#[derive(Accounts)]
pub struct FinishRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), &room.room_id.to_le_bytes()],
        bump = room.bump
    )]
    pub room: Box<Account<'info, Room>>,

    #[account(
        mut,
        seeds = [ANSWERS_SEED, room.key().as_ref()],
        bump = room.answers_bump,
        has_one = room
    )]
    pub answers: Box<Account<'info, Answers>>,
}

/// Commit the finished room and hand it back to Solana so the pot can be paid.
///
/// Committing and undelegating together matters: `settle` needs the room owned
/// by this program again, and a committed-but-still-delegated room is owned by
/// the delegation program on the base layer.
pub fn handle_finish(ctx: Context<FinishRoom>) -> Result<()> {
    require!(
        ctx.accounts.room.phase == Phase::Finished,
        HerdError::NotFinished
    );

    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        ctx.accounts.room.to_account_info(),
        ctx.accounts.answers.to_account_info(),
    ])
    .build_and_invoke()?;

    msg!("herd: room committed and handed back to Solana");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Seat;

    /// A room and its sealed answers. `None` means the player said nothing.
    fn room_with(said: &[Option<&str>]) -> (Room, Answers) {
        let mut seats = [Seat::empty(); MAX_PLAYERS];
        let mut answers = Answers {
            room: Pubkey::new_unique(),
            round: 1,
            words: [[0u8; MAX_ANSWER]; MAX_PLAYERS],
            lengths: [0u8; MAX_PLAYERS],
            bump: 255,
        };

        for (i, text) in said.iter().enumerate() {
            seats[i] = Seat {
                wallet: Pubkey::new_unique(),
                session: Pubkey::new_unique(),
                alive: true,
                answered_round: 1,
                has_answered: text.is_some(),
                ending_vote: Ending::Split,
            };
            if let Some(text) = text {
                answers.words[i][..text.len()].copy_from_slice(text.as_bytes());
                answers.lengths[i] = text.len() as u8;
            }
        }

        let room = Room {
            host: Pubkey::new_unique(),
            host_session: Pubkey::new_unique(),
            room_id: 1,
            stake: 50_000_000,
            round_seconds: 15,
            phase: Phase::Playing,
            round: 1,
            round_ends_at: 0,
            rule: Rule::Undrawn,
            ending: Ending::Split,
            coin_decided: false,
            awaiting_rule: false,
            seats,
            seat_count: said.len() as u8,
            last_round: 0,
            last_words: [[0u8; MAX_ANSWER]; MAX_PLAYERS],
            last_lengths: [0u8; MAX_PLAYERS],
            bump: 255,
            vault_bump: 255,
            answers_bump: 255,
        };

        (room, answers)
    }

    fn alive_answers(room: &Room, answers: &Answers) -> Vec<String> {
        room.seats()
            .iter()
            .enumerate()
            .filter(|(_, s)| s.alive)
            .map(|(i, _)| String::from_utf8_lossy(answers.said(i)).to_string())
            .collect()
    }

    /* ------------------------------------------------------- majority rule */

    #[test]
    fn the_smallest_group_is_culled() {
        let (mut room, answers) = room_with(&[
            Some("apple"),
            Some("apple"),
            Some("apple"),
            Some("banana"),
            Some("banana"),
            Some("mango"),
        ]);

        assert_eq!(resolve_round(&mut room, &answers, Rule::MajoritySurvives), 1);
        assert_eq!(room.alive_count(), 5);
        assert!(!alive_answers(&room, &answers).contains(&"mango".to_string()));
    }

    #[test]
    fn every_group_tied_for_smallest_goes_together() {
        let (mut room, answers) = room_with(&[
            Some("apple"),
            Some("apple"),
            Some("banana"),
            Some("mango"),
            Some("grape"),
        ]);

        // Three singletons all tie for smallest, so all three go.
        assert_eq!(resolve_round(&mut room, &answers, Rule::MajoritySurvives), 3);
        assert_eq!(alive_answers(&room, &answers), vec!["apple", "apple"]);
    }

    #[test]
    fn silence_is_straying() {
        // Not answering is its own group of one that nobody can join, so a
        // player who sits out is culled rather than carried.
        let (mut room, answers) = room_with(&[Some("apple"), Some("apple"), None]);

        assert_eq!(resolve_round(&mut room, &answers, Rule::MajoritySurvives), 1);
        assert_eq!(room.alive_count(), 2);
    }

    /* ------------------------------------------------------- minority rule */

    #[test]
    fn the_largest_group_is_culled_under_the_other_rule() {
        let (mut room, answers) = room_with(&[
            Some("apple"),
            Some("apple"),
            Some("apple"),
            Some("banana"),
            Some("mango"),
        ]);

        assert_eq!(resolve_round(&mut room, &answers, Rule::MinoritySurvives), 3);
        assert_eq!(room.alive_count(), 2);
        assert!(!alive_answers(&room, &answers).contains(&"apple".to_string()));
    }

    /* ------------------------------------------------------------ deadlock */

    #[test]
    fn an_evenly_split_room_loses_nobody() {
        // Six answers, six groups of one. Culling every group would empty the
        // room, so nobody strays and the same players go again.
        let (mut room, answers) = room_with(&[
            Some("a"),
            Some("b"),
            Some("c"),
            Some("d"),
            Some("e"),
            Some("f"),
        ]);

        assert_eq!(resolve_round(&mut room, &answers, Rule::MajoritySurvives), 0);
        assert_eq!(room.alive_count(), 6);
    }

    #[test]
    fn a_room_that_all_said_the_same_thing_loses_nobody() {
        let (mut room, answers) = room_with(&[Some("apple"), Some("apple"), Some("apple")]);

        // One group. It is both the largest and the smallest, so under either
        // rule culling it would empty the room.
        assert_eq!(resolve_round(&mut room, &answers, Rule::MajoritySurvives), 0);
        assert_eq!(resolve_round(&mut room, &answers, Rule::MinoritySurvives), 0);
        assert_eq!(room.alive_count(), 3);
    }

    #[test]
    fn two_even_groups_lose_nobody() {
        let (mut room, answers) = room_with(&[Some("a"), Some("a"), Some("b"), Some("b")]);

        assert_eq!(resolve_round(&mut room, &answers, Rule::MajoritySurvives), 0);
        assert_eq!(room.alive_count(), 4);
    }

    /// Two players cannot resolve, under either rule, either way they answer.
    ///
    /// Same word: one group of two, and culling it would empty the room. Two
    /// different words: two groups of one, tied, and culling both would empty
    /// the room. The no-empty guard is total at two, so a heads-up round is
    /// always a no-op and the room grinds to the round cap.
    /// The coin keeps exactly one of the two, and neither is favoured.
    ///
    /// A flip that quietly preferred the lower seat would hand every coin-vote
    /// room to whoever joined first, and nobody would notice until somebody
    /// counted. So this counts.
    #[test]
    fn the_coin_keeps_one_of_the_two_and_favours_neither() {
        let mut first = 0;
        let mut second = 0;

        for byte in 0u8..=255 {
            let (mut room, _) = room_with(&[Some("fire"), Some("water")]);
            flip_heads_up(&mut room, byte);

            assert_eq!(room.alive_count(), 1, "byte {byte} left {} alive", room.alive_count());
            if room.seats[0].alive {
                first += 1;
            } else {
                second += 1;
            }
        }

        assert_eq!(first, 128);
        assert_eq!(second, 128);
    }

    /// A table gets the ending it voted for, and a split table gets Split.
    #[test]
    fn the_table_votes_on_its_own_ending() {
        use crate::instructions::room::tally_ending;

        assert_eq!(tally_ending(3, 2), Ending::Coin);
        assert_eq!(tally_ending(2, 3), Ending::Split);
        // Nobody agreed, so nobody loses anything they were still playing for.
        assert_eq!(tally_ending(3, 3), Ending::Split);
        assert_eq!(tally_ending(0, 0), Ending::Split);
    }

    #[test]
    fn two_players_can_never_resolve() {
        for rule in [Rule::MajoritySurvives, Rule::MinoritySurvives] {
            for said in [["fire", "fire"], ["fire", "water"]] {
                let with: Vec<Option<&str>> = said.iter().map(|w| Some(*w)).collect();
                let (mut room, answers) = room_with(&with);
                let culled = resolve_round(&mut room, &answers, rule);
                assert_eq!(
                    culled, 0,
                    "{rule:?} culled somebody from {said:?} - the guard should have stopped it"
                );
                assert_eq!(room.alive_count(), 2);
            }
        }
    }

    #[test]
    fn the_room_can_never_be_emptied() {
        // The property the deadlock rule exists to guarantee, over every shape
        // of round a six-player room can produce.
        let shapes: &[&[Option<&str>]] = &[
            &[Some("a"), Some("a"), Some("a"), Some("a"), Some("a"), Some("a")],
            &[Some("a"), Some("b"), Some("c"), Some("d"), Some("e"), Some("f")],
            &[Some("a"), Some("a"), Some("b"), Some("b"), Some("c"), Some("c")],
            &[Some("a"), Some("a"), Some("a"), Some("b"), Some("b"), Some("b")],
            &[None, None, None, None, None, None],
            &[Some("a"), Some("a"), Some("a"), Some("a"), Some("a"), None],
        ];

        for shape in shapes {
            for rule in [Rule::MajoritySurvives, Rule::MinoritySurvives] {
                let (mut room, answers) = room_with(shape);
                resolve_round(&mut room, &answers, rule);
                assert!(
                    room.alive_count() > 0,
                    "a round emptied the room: {:?} under {:?}",
                    shape,
                    rule
                );
            }
        }
    }

    /* -------------------------------------------------------- the collusion */

    #[test]
    fn a_cartel_survives_exactly_half_the_time() {
        // The attack this game has to answer: three friends in one room agree on
        // a word beforehand. They are always the largest group.
        //
        // If the largest group always survived, they would win every game
        // forever - which is why the rule is drawn by VRF *after* their answers
        // are sealed. Being a bloc is now as likely to kill them as save them.
        let shape: &[Option<&str>] = &[
            Some("cartel"),
            Some("cartel"),
            Some("cartel"),
            Some("apple"),
            Some("banana"),
            Some("mango"),
        ];

        let mut survived = 0;
        let mut died = 0;

        for byte in 0u8..=255 {
            // Exactly how the callback draws it.
            let rule = if byte % 2 == 0 {
                Rule::MajoritySurvives
            } else {
                Rule::MinoritySurvives
            };

            let (mut room, answers) = room_with(shape);
            resolve_round(&mut room, &answers, rule);

            let cartel_alive = room.seats()[..3].iter().filter(|s| s.alive).count();
            if cartel_alive == 3 {
                survived += 1;
            } else if cartel_alive == 0 {
                died += 1;
            } else {
                panic!("the cartel was split, which should be impossible");
            }
        }

        assert_eq!(survived, 128, "a cartel must not survive more than half");
        assert_eq!(died, 128, "a cartel must not die more than half either");
    }

    #[test]
    fn colluding_is_worse_than_playing_honestly_when_it_goes_wrong() {
        // The cartel dies as a unit, so a bad draw costs all three seats at
        // once. An honest player only ever loses their own.
        let (mut room, answers) = room_with(&[
            Some("cartel"),
            Some("cartel"),
            Some("cartel"),
            Some("apple"),
            Some("apple"),
            Some("mango"),
        ]);

        resolve_round(&mut room, &answers, Rule::MinoritySurvives);
        assert_eq!(room.seats()[..3].iter().filter(|s| s.alive).count(), 0);
        assert_eq!(room.alive_count(), 3);
    }
}

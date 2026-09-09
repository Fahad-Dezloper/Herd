//! PHASE 8 - paying out.
//!
//! Settlement happens on Solana, from a room the rollup has committed back. The
//! rollup decides who won; it never touches the money. These tests take the
//! rollup's word for the result and then check that the payout itself is beyond
//! its reach: the caller says who to pay and the program refuses unless that
//! list is exactly the survivors it can see in the room's own seats.
//!
//! The finished room is written directly, which is what a commit from a rollup
//! amounts to from the base layer's point of view.
//!
//! Run with:  cargo test -p herd --test phase8_settle

mod common;

use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::system_program;
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

use common::*;
use herd::error::HerdError;
use herd::state::{Phase, Room, Rule, Seat, MAX_ANSWER, MAX_PLAYERS};

const ROOM_ID: u64 = 11;
const STAKE: u64 = 50_000_000;

fn ix_create(host: &Pubkey) -> Instruction {
    Instruction {
        program_id: herd::ID,
        accounts: herd::accounts::CreateRoom {
            host: *host,
            room: room_pda(host, ROOM_ID),
            vault: vault_pda(&room_pda(host, ROOM_ID)),
            answers: answers_pda(&room_pda(host, ROOM_ID)),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: herd::instruction::CreateRoom {
            room_id: ROOM_ID,
            stake: STAKE,
            round_seconds: 15,
            host_session: Keypair::new().pubkey(),
        }
        .data(),
    }
}

fn ix_join(host: &Pubkey, player: &Pubkey) -> Instruction {
    let room = room_pda(host, ROOM_ID);
    Instruction {
        program_id: herd::ID,
        accounts: herd::accounts::JoinRoom {
            player: *player,
            room,
            vault: vault_pda(&room),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: herd::instruction::JoinRoom {
            session: Keypair::new().pubkey(),
        }
        .data(),
    }
}

fn ix_settle(caller: &Pubkey, host: &Pubkey, winners: &[Pubkey]) -> Instruction {
    let room = room_pda(host, ROOM_ID);
    let mut accounts = herd::accounts::Settle {
        caller: *caller,
        room,
        vault: vault_pda(&room),
    }
    .to_account_metas(None);
    accounts.extend(winners.iter().map(|w| AccountMeta::new(*w, false)));

    Instruction {
        program_id: herd::ID,
        accounts,
        data: herd::instruction::Settle {}.data(),
    }
}

/// A room with `n` players seated and staked.
fn staked(n: usize) -> (LiteSVM, Keypair, Vec<Keypair>) {
    let (mut svm, host) = setup();
    send(&mut svm, &host, &[], &[ix_create(&host.pubkey())]).expect("create");

    let players: Vec<Keypair> = (0..n)
        .map(|_| {
            let player = funded(&mut svm);
            send(
                &mut svm,
                &player,
                &[],
                &[ix_join(&host.pubkey(), &player.pubkey())],
            )
            .expect("join");
            player
        })
        .collect();

    (svm, host, players)
}

/// Write the room as the rollup would have committed it: finished, with
/// `alive` marking whoever is still standing.
fn finish_with(svm: &mut LiteSVM, host: &Pubkey, players: &[Keypair], alive: &[bool]) {
    let key = room_pda(host, ROOM_ID);
    let existing = svm.get_account(&key).expect("room exists");
    let mut room = Room::try_deserialize(&mut existing.data.as_slice()).expect("room");

    room.phase = Phase::Finished;
    room.rule = Rule::MajoritySurvives;
    room.round = 4;
    for (i, still) in alive.iter().enumerate() {
        room.seats[i].alive = *still;
    }
    let _ = (players, MAX_PLAYERS, MAX_ANSWER, Seat::empty());

    let mut data = Vec::new();
    room.try_serialize(&mut data).expect("serialise");

    let mut account = existing;
    account.data = data;
    svm.set_account(key, account).expect("write the room back");
}

fn vault_floor(svm: &LiteSVM, host: &Pubkey) -> u64 {
    let vault = vault_pda(&room_pda(host, ROOM_ID));
    svm.minimum_balance_for_rent_exemption(svm.get_account(&vault).unwrap().data.len())
}

/* --------------------------------------------------------------- payouts */

#[test]
fn one_survivor_takes_the_whole_pot() {
    let (mut svm, host, players) = staked(4);
    finish_with(&mut svm, &host.pubkey(), &players, &[false, false, true, false]);

    let winner = players[2].pubkey();
    let before = balance(&svm, &winner);
    let caller = funded(&mut svm);

    send(&mut svm, &caller, &[], &[ix_settle(&caller.pubkey(), &host.pubkey(), &[winner])])
        .expect("settle");

    assert_eq!(balance(&svm, &winner), before + STAKE * 4);
}

#[test]
fn several_survivors_split_it() {
    // A room that runs to the round cap can end with more than one standing.
    let (mut svm, host, players) = staked(4);
    finish_with(&mut svm, &host.pubkey(), &players, &[true, false, true, false]);

    let winners = [players[0].pubkey(), players[2].pubkey()];
    let before: Vec<u64> = winners.iter().map(|w| balance(&svm, w)).collect();
    let caller = funded(&mut svm);

    send(&mut svm, &caller, &[], &[ix_settle(&caller.pubkey(), &host.pubkey(), &winners)])
        .expect("settle");

    for (i, w) in winners.iter().enumerate() {
        assert_eq!(balance(&svm, w), before[i] + STAKE * 2);
    }
}

#[test]
fn the_vault_is_left_exactly_rent_exempt() {
    // Not a rounding detail: draining a program-owned account below its
    // rent-exempt minimum lets the runtime reap it.
    let (mut svm, host, players) = staked(3);
    finish_with(&mut svm, &host.pubkey(), &players, &[false, true, false]);

    let caller = funded(&mut svm);
    send(
        &mut svm,
        &caller,
        &[],
        &[ix_settle(&caller.pubkey(), &host.pubkey(), &[players[1].pubkey()])],
    )
    .expect("settle");

    let vault = vault_pda(&room_pda(&host.pubkey(), ROOM_ID));
    assert_eq!(balance(&svm, &vault), vault_floor(&svm, &host.pubkey()));
}

#[test]
fn nobody_standing_refunds_everyone() {
    // The round rules make this impossible, but the payout should not depend on
    // that being true - money with nowhere to go goes back.
    let (mut svm, host, players) = staked(3);
    finish_with(&mut svm, &host.pubkey(), &players, &[false, false, false]);

    let before: Vec<u64> = players.iter().map(|p| balance(&svm, &p.pubkey())).collect();
    let caller = funded(&mut svm);
    let all: Vec<Pubkey> = players.iter().map(|p| p.pubkey()).collect();

    send(&mut svm, &caller, &[], &[ix_settle(&caller.pubkey(), &host.pubkey(), &all)])
        .expect("settle");

    for (i, p) in players.iter().enumerate() {
        assert_eq!(balance(&svm, &p.pubkey()), before[i] + STAKE);
    }
}

/* ------------------------------------------------------------- the guards */

#[test]
fn the_caller_cannot_choose_who_gets_paid() {
    // The heart of it: settlement takes a list of winners from whoever asks, so
    // the program checks that list against the seats rather than trusting it.
    let (mut svm, host, players) = staked(4);
    finish_with(&mut svm, &host.pubkey(), &players, &[false, false, true, false]);

    let thief = funded(&mut svm);
    let res = send(
        &mut svm,
        &thief,
        &[],
        &[ix_settle(&thief.pubkey(), &host.pubkey(), &[thief.pubkey()])],
    );

    assert_program_error(&res, &code(HerdError::WrongWinners), "a stranger must not be paid");
}

#[test]
fn a_real_winner_cannot_be_swapped_for_another_player() {
    let (mut svm, host, players) = staked(4);
    finish_with(&mut svm, &host.pubkey(), &players, &[false, false, true, false]);

    let caller = funded(&mut svm);
    let res = send(
        &mut svm,
        &caller,
        &[],
        &[ix_settle(&caller.pubkey(), &host.pubkey(), &[players[3].pubkey()])],
    );

    assert_program_error(&res, &code(HerdError::WrongWinners), "a loser must not be paid");
}

#[test]
fn the_winner_list_must_be_complete() {
    let (mut svm, host, players) = staked(4);
    finish_with(&mut svm, &host.pubkey(), &players, &[true, false, true, false]);

    let caller = funded(&mut svm);
    let res = send(
        &mut svm,
        &caller,
        &[],
        &[ix_settle(&caller.pubkey(), &host.pubkey(), &[players[0].pubkey()])],
    );

    assert_program_error(&res, &code(HerdError::WrongWinners), "one winner cannot take two shares");
}

#[test]
fn a_room_still_playing_cannot_be_settled() {
    let (mut svm, host, players) = staked(3);

    let caller = funded(&mut svm);
    let res = send(
        &mut svm,
        &caller,
        &[],
        &[ix_settle(&caller.pubkey(), &host.pubkey(), &[players[0].pubkey()])],
    );

    assert_program_error(&res, &code(HerdError::NotFinished), "an unfinished room holds its pot");
}

#[test]
fn a_room_cannot_be_settled_twice() {
    let (mut svm, host, players) = staked(3);
    finish_with(&mut svm, &host.pubkey(), &players, &[false, true, false]);

    let caller = funded(&mut svm);
    let winner = [players[1].pubkey()];
    send(&mut svm, &caller, &[], &[ix_settle(&caller.pubkey(), &host.pubkey(), &winner)])
        .expect("first settle");

    // A different caller, so this is a genuinely new transaction rather than a
    // duplicate the runtime drops before the program ever runs.
    let opportunist = funded(&mut svm);
    let again = send(
        &mut svm,
        &opportunist,
        &[],
        &[ix_settle(&opportunist.pubkey(), &host.pubkey(), &winner)],
    );

    assert_program_error(&again, &code(HerdError::AlreadySettled), "the pot pays out once");
}

#[test]
fn anyone_can_trigger_the_payout() {
    // Deliberate. It pays the survivors and nobody else whoever asks, and
    // gating it would let a sore loser withhold the pot by doing nothing.
    let (mut svm, host, players) = staked(3);
    finish_with(&mut svm, &host.pubkey(), &players, &[false, false, true]);

    let passerby = funded(&mut svm);
    let before = balance(&svm, &players[2].pubkey());

    send(
        &mut svm,
        &passerby,
        &[],
        &[ix_settle(&passerby.pubkey(), &host.pubkey(), &[players[2].pubkey()])],
    )
    .expect("a stranger may settle");

    assert_eq!(balance(&svm, &players[2].pubkey()), before + STAKE * 3);
}

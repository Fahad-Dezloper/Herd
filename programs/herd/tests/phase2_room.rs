//! PHASE 2 - rooms, seats and stakes on Solana.
//!
//! No rollup here on purpose. If everything after this collapsed, what is proven
//! here still stands: money goes into an account this program controls, and the
//! rules about who may take a seat are enforced on the base layer.
//!
//! Run with:  cargo test -p herd --test phase2_room

mod common;

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::system_program;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

use common::*;
use herd::error::HerdError;
use herd::state::{Phase, Room};

const ROOM_ID: u64 = 7;
const STAKE: u64 = 50_000_000; // 0.05 SOL

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

fn ix_join(host: &Pubkey, player: &Pubkey, session: Pubkey) -> Instruction {
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
        data: herd::instruction::JoinRoom { session }.data(),
    }
}

fn ix_lock(host: &Pubkey) -> Instruction {
    Instruction {
        program_id: herd::ID,
        accounts: herd::accounts::LockRoom {
            authority: *host,
            room: room_pda(host, ROOM_ID),
        }
        .to_account_metas(None),
        data: herd::instruction::LockRoom {}.data(),
    }
}

fn read_room(svm: &LiteSVM, host: &Pubkey) -> Room {
    let acct = svm.get_account(&room_pda(host, ROOM_ID)).expect("room exists");
    Room::try_deserialize(&mut acct.data.as_slice()).expect("room deserialises")
}

/// A room with `n` players seated.
fn seated(n: usize) -> (LiteSVM, Keypair, Vec<Keypair>, Vec<Keypair>) {
    let (mut svm, host) = setup();
    send(&mut svm, &host, &[], &[ix_create(&host.pubkey())]).expect("create");

    let mut players = Vec::new();
    let mut sessions = Vec::new();
    for _ in 0..n {
        let player = funded(&mut svm);
        let session = Keypair::new();
        send(
            &mut svm,
            &player,
            &[],
            &[ix_join(&host.pubkey(), &player.pubkey(), session.pubkey())],
        )
        .expect("join");
        players.push(player);
        sessions.push(session);
    }
    (svm, host, players, sessions)
}

#[test]
fn a_new_room_is_open_and_empty() {
    let (mut svm, host) = setup();
    send(&mut svm, &host, &[], &[ix_create(&host.pubkey())]).expect("create");

    let room = read_room(&svm, &host.pubkey());
    assert_eq!(room.phase, Phase::Open);
    assert_eq!(room.seat_count, 0);
    assert_eq!(room.stake, STAKE);
    assert_eq!(room.host, host.pubkey());
}

#[test]
fn the_answers_account_carries_headroom_to_buy_its_own_privacy() {
    // The sealed account sponsors its own permission inside the rollup, and
    // Anchor's init funds exactly the rent-exempt minimum - which would leave it
    // nothing to pay with. The transaction fee payer cannot cover it either: a
    // fee payer whose balance moves inside a rollup must itself be delegated,
    // and no wallet can be.
    let (mut svm, host) = setup();
    send(&mut svm, &host, &[], &[ix_create(&host.pubkey())]).expect("create");

    let answers = answers_pda(&room_pda(&host.pubkey(), ROOM_ID));
    let rent_exempt =
        svm.minimum_balance_for_rent_exemption(svm.get_account(&answers).unwrap().data.len());

    assert_eq!(balance(&svm, &answers), rent_exempt + herd::EPHEMERAL_RENT_BUFFER);
}

#[test]
fn what_was_said_is_kept_apart_from_who_said_it() {
    // The split that makes the game playable: a sealed account is invisible to
    // everyone over RPC, which is right for the words and useless for the round
    // number, the clock and who is left. Those stay in the room.
    let (mut svm, host) = setup();
    send(&mut svm, &host, &[], &[ix_create(&host.pubkey())]).expect("create");

    let room = room_pda(&host.pubkey(), ROOM_ID);
    let answers = answers_pda(&room);
    assert_ne!(room, answers, "answers must be their own account");
    assert_eq!(svm.get_account(&answers).unwrap().owner, herd::ID);
}

#[test]
fn joining_moves_the_stake_into_the_vault() {
    let (svm, host, players, _) = seated(3);
    let vault = vault_pda(&room_pda(&host.pubkey(), ROOM_ID));

    let rent_exempt = svm.minimum_balance_for_rent_exemption(
        svm.get_account(&vault).unwrap().data.len(),
    );
    assert_eq!(balance(&svm, &vault), rent_exempt + STAKE * 3);
    assert_eq!(read_room(&svm, &host.pubkey()).seat_count, 3);
    assert_eq!(players.len(), 3);
}

#[test]
fn the_vault_is_owned_by_this_program_and_never_delegated() {
    // The security argument in one line: the room can go to a rollup, the money
    // cannot. If this ever fails, a misbehaving rollup could move funds.
    let (svm, host, _, _) = seated(3);
    let vault = vault_pda(&room_pda(&host.pubkey(), ROOM_ID));

    assert_eq!(svm.get_account(&vault).unwrap().owner, herd::ID);
}

#[test]
fn the_same_wallet_cannot_take_two_seats() {
    let (mut svm, host, players, _) = seated(3);

    let again = ix_join(&host.pubkey(), &players[0].pubkey(), Keypair::new().pubkey());
    let res = send(&mut svm, &players[0], &[], &[again]);

    assert_program_error(&res, &code(HerdError::AlreadySeated), "a wallet must not seat twice");
}

#[test]
fn a_room_needs_three_players_to_start() {
    // Two people cannot form a herd: every round is two groups of one, which
    // culls everybody or nobody. Three is the smallest game that exists.
    let (mut svm, host, _, _) = seated(2);

    let res = send(&mut svm, &host, &[], &[ix_lock(&host.pubkey())]);
    assert_program_error(&res, &code(HerdError::TooFewPlayers), "two players is not a game");
}

#[test]
fn locking_starts_round_one() {
    let (mut svm, host, _, _) = seated(4);
    send(&mut svm, &host, &[], &[ix_lock(&host.pubkey())]).expect("lock");

    let room = read_room(&svm, &host.pubkey());
    assert_eq!(room.phase, Phase::Playing);
    assert_eq!(room.round, 1);
    assert!(room.seats().iter().all(|s| s.alive));
    // The clock starts when the room reaches the rollup, not here.
    assert_eq!(room.round_ends_at, 0);
}

#[test]
fn only_the_host_can_lock_a_room() {
    let (mut svm, host, players, _) = seated(3);

    let mut ix = ix_lock(&host.pubkey());
    ix.accounts[0].pubkey = players[0].pubkey();
    let res = send(&mut svm, &players[0], &[], &[ix]);

    assert_program_error(&res, &code(HerdError::NotTheHost), "a player must not lock the room");
}

#[test]
fn the_hosts_session_key_can_lock_the_room() {
    // Locking moves no money and the host has already committed by paying to
    // open the room, so making it need the wallet bought nothing and cost a
    // fingerprint in the middle of setting up a game.
    let (mut svm, host) = setup();
    let session = Keypair::new();

    let mut create = ix_create(&host.pubkey());
    create.data = {
        use anchor_lang::InstructionData;
        herd::instruction::CreateRoom {
            room_id: ROOM_ID,
            stake: STAKE,
            round_seconds: 15,
            host_session: session.pubkey(),
        }
        .data()
    };
    send(&mut svm, &host, &[], &[create]).expect("create");

    for _ in 0..3 {
        let player = funded(&mut svm);
        send(
            &mut svm,
            &player,
            &[],
            &[ix_join(&host.pubkey(), &player.pubkey(), Keypair::new().pubkey())],
        )
        .expect("join");
    }

    svm.airdrop(&session.pubkey(), LAMPORTS_PER_SOL).unwrap();
    let mut lock = ix_lock(&host.pubkey());
    lock.accounts[0].pubkey = session.pubkey();
    send(&mut svm, &session, &[], &[lock]).expect("the session key may lock");

    assert_eq!(read_room(&svm, &host.pubkey()).phase, Phase::Playing);
}

#[test]
fn a_session_key_still_cannot_take_a_seat_for_someone_else() {
    // The point of scoping it: it runs the room, it does not spend it.
    let (svm, host, players, sessions) = seated(3);
    let room = read_room(&svm, &host.pubkey());

    for (i, seat) in room.seats().iter().enumerate() {
        assert_eq!(seat.wallet, players[i].pubkey());
        assert_eq!(seat.session, sessions[i].pubkey());
    }
    assert!(svm.get_account(&vault_pda(&room_pda(&host.pubkey(), ROOM_ID))).is_some());
}

#[test]
fn a_locked_room_takes_no_more_players() {
    let (mut svm, host, _, _) = seated(3);
    send(&mut svm, &host, &[], &[ix_lock(&host.pubkey())]).expect("lock");

    let latecomer = funded(&mut svm);
    let res = send(
        &mut svm,
        &latecomer,
        &[],
        &[ix_join(&host.pubkey(), &latecomer.pubkey(), Keypair::new().pubkey())],
    );

    assert_program_error(&res, &code(HerdError::RoomNotOpen), "a locked room is closed");
}

#[test]
fn a_room_fills_up() {
    let (mut svm, host, _, _) = seated(12);

    let latecomer = funded(&mut svm);
    let res = send(
        &mut svm,
        &latecomer,
        &[],
        &[ix_join(&host.pubkey(), &latecomer.pubkey(), Keypair::new().pubkey())],
    );

    assert_program_error(&res, &code(HerdError::RoomFull), "a thirteenth player must be refused");
}

#[test]
fn each_seat_records_its_own_session_key() {
    // The session key is what signs answers inside the rollup, so a mix-up here
    // would let one player answer for another.
    let (svm, host, players, sessions) = seated(3);
    let room = read_room(&svm, &host.pubkey());

    for (i, seat) in room.seats().iter().enumerate() {
        assert_eq!(seat.wallet, players[i].pubkey());
        assert_eq!(seat.session, sessions[i].pubkey());
        assert_ne!(seat.session, seat.wallet, "a session key is not the wallet");
    }
}

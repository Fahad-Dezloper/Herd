//! Shared LiteSVM scaffolding.

#![allow(dead_code)]

use anchor_lang::solana_program::instruction::Instruction;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// The custom error code Anchor will report for one of our errors.
///
/// Derived from the enum rather than written down. Hand-counted numbers drift
/// the moment a variant is inserted, and the test then asserts the wrong
/// failure while still passing for the wrong reason.
pub fn code(err: herd::error::HerdError) -> String {
    format!("Custom({})", 6000 + err as u32)
}

pub fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(herd::ID, "../../target/deploy/herd.so")
        .expect("the program artifact must be built - run `anchor build` first");

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100 * LAMPORTS_PER_SOL).unwrap();
    (svm, payer)
}

pub fn funded(svm: &mut LiteSVM) -> Keypair {
    let key = Keypair::new();
    svm.airdrop(&key.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
    key
}

pub fn room_pda(host: &Pubkey, room_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[herd::ROOM_SEED, host.as_ref(), &room_id.to_le_bytes()],
        &herd::ID,
    )
    .0
}

pub fn vault_pda(room: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[herd::VAULT_SEED, room.as_ref()], &herd::ID).0
}

pub fn answers_pda(room: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[herd::ANSWERS_SEED, room.as_ref()], &herd::ID).0
}

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<(), String> {
    let msg = Message::new(ixs, Some(&payer.pubkey()));
    let mut all = vec![payer];
    all.extend_from_slice(signers);
    let tx = Transaction::new(&all, msg, svm.latest_blockhash());
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

pub fn balance(svm: &LiteSVM, key: &Pubkey) -> u64 {
    svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

pub fn assert_program_error(res: &Result<(), String>, code: &str, what: &str) {
    match res {
        Ok(()) => panic!("{what}: expected {code}, but it succeeded"),
        Err(e) => assert!(
            e.contains(code),
            "{what}: expected {code} from our program, got: {e}"
        ),
    }
}

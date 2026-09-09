/**
 * PHASE 9 - the whole game, live on devnet.
 *
 * Four players, real stakes, a real TEE rollup and the real VRF oracle. Every
 * claim the pitch makes has to be visible in this transcript or it is not true:
 *
 *   - answers are unreadable while a round is open, to everyone;
 *   - who has answered is visible, which is the tension;
 *   - the rule is drawn after the answers are locked;
 *   - the pot pays out on Solana from a vault the rollup never touched.
 *
 * Run:  bun run game.ts
 */

import { Keypair, PublicKey, SystemProgram, Transaction, Connection } from "@solana/web3.js";

import {
  BASE_RPC,
  TEE_VALIDATOR,
  accountData,
  authenticate,
  confirm,
  delegationOf,
  lamportsOf,
  loadKeypair,
  rpc,
  send,
  sleep,
} from "./lib/chain";
import { Ending, Herd, Outcome, Phase } from "./lib/herd";

const idl = await Bun.file(new URL("../target/idl/herd.json", import.meta.url).pathname).json();
const herd = new Herd(idl);

const host = loadKeypair(`${process.env.HOME}/.config/solana/id.json`);
const ROOM_ID = BigInt(Date.now() % 1_000_000);

/// Which ending this table votes for. `ENDING=coin bun run game.ts` to see the
/// oracle pick a single winner; the default splits between the final two.
const ENDING = process.env.ENDING === "coin" ? Ending.Coin : Ending.Split;
const STAKE = 10_000_000n; // 0.01 SOL
const ROUND_SECONDS = 12;

const room = herd.room(host.publicKey, ROOM_ID);
const answers = herd.answers(room);
const vault = herd.vault(room);

const say = console.log;
const ok = (s: string) => say(`   PASS  ${s}`);
const bad = (s: string) => say(`   FAIL  ${s}`);

say(`room    ${room.toBase58()}`);
say(`answers ${answers.toBase58()}`);
say(`vault   ${vault.toBase58()}\n`);

/* ------------------------------------------------------------ seat them */

say("[1] open a room and seat four players");
const session = Keypair.generate();
await sendBase(
  [
    herd.createRoom(host.publicKey, ROOM_ID, STAKE, ROUND_SECONDS, session.publicKey),
    SystemProgram.transfer({
      fromPubkey: host.publicKey,
      toPubkey: session.publicKey,
      lamports: 60_000_000,
    }),
  ],
  "create",
);

const players = Array.from({ length: 4 }, () => ({
  wallet: Keypair.generate(),
  session: Keypair.generate(),
}));

// Fund the wallets so they can pay their own stake and fees.
const conn = new Connection(BASE_RPC, "confirmed");
const fund = new Transaction();
players.forEach((p) =>
  fund.add(
    SystemProgram.transfer({
      fromPubkey: host.publicKey,
      toPubkey: p.wallet.publicKey,
      lamports: Number(STAKE) + 10_000_000,
    }),
  ),
);
const { blockhash } = await conn.getLatestBlockhash();
fund.feePayer = host.publicKey;
fund.recentBlockhash = blockhash;
fund.sign(host);
await confirm(BASE_RPC, await conn.sendRawTransaction(fund.serialize()));

for (const p of players) {
  const ix = herd.joinRoom(
    host.publicKey,
    ROOM_ID,
    p.wallet.publicKey,
    p.session.publicKey,
    ENDING,
  );
  // Exactly what the app does: the stake and the session key's fuel go in one
  // transaction, because a winner who only joined still has to be able to hand
  // the room back and pay the pot out by themselves.
  const sig = await send(BASE_RPC, [p.wallet], [
    ix,
    SystemProgram.transfer({
      fromPubkey: p.wallet.publicKey,
      toPubkey: p.session.publicKey,
      lamports: 5_000_000,
    }),
  ]);
  await confirm(BASE_RPC, sig);
}
say(`    four seats taken, vault holds ${await lamportsOf(BASE_RPC, vault)} lamports`);

// The host's session key runs the room from here - no wallet involved.
await sendSession([session], [herd.lockRoom(host.publicKey, ROOM_ID, session.publicKey)], "lock");
await sleep(2500);

/* ------------------------------------------------- hand it to the rollup */

say("\n[2] delegate the room and its answers to the TEE");
await sendSession(
  [session],
  [herd.delegateRoom(host.publicKey, ROOM_ID, session.publicKey, TEE_VALIDATOR)],
  "delegate",
);
await sleep(3000);

const status = await delegationOf(room);
const answersStatus = await delegationOf(answers);
say(`    room    -> ${status.fqdn} (${status.isDelegated})`);
say(`    answers -> ${answersStatus.fqdn} (${answersStatus.isDelegated})`);
if (!status.fqdn) throw new Error("the room did not delegate");

const ER = status.fqdn.replace(/\/$/, "");
const token = await authenticate(ER, session);

say("\n[3] seal the answers");
await sendER([herd.sealRoom(host.publicKey, ROOM_ID)], [session], "seal");
await sleep(2000);

const sealedRead = await accountData(ER, answers, token);
if (sealedRead) bad("the answers are still readable");
else ok("the answers are refused to everyone, host included");

const roomRead = await accountData(ER, room, token);
if (roomRead) ok("the room itself is still readable - players can see the game");
else bad("the room is unreadable, which would leave players blind");

/* ----------------------------------------------------------- play it out */

// Round one is deliberately 2 + 1 + 1. Whichever rule the oracle draws, the
// doomed groups add up to two and exactly two players come out - which is the
// whole point of this run, because two is where the ending the table voted for
// finally has something to do.
const WORDS = [
  ["apple", "apple", "banana", "cherry"],
  ["traffic", "traffic", "overslept", "traffic"],
  ["blue", "red", "blue", "blue"],
  ["dog", "dog", "cat", "dog"],
];

for (let round = 1; round <= 8; round++) {
  const before = herd.decodeRoom((await accountData(ER, room, token))!);
  if (before.phase !== Phase.Playing) break;

  const alive = before.seats.filter((s) => s.alive);
  say(`\n[round ${before.round}]  ${alive.length} still in`);

  const words = WORDS[(before.round - 1) % WORDS.length];
  for (let i = 0; i < players.length; i++) {
    const seat = before.seats[i];
    if (!seat.alive) continue;
    const ix = herd.submitAnswer(
      host.publicKey,
      ROOM_ID,
      players[i].session.publicKey,
      words[i],
    );
    await sendER([ix], [players[i].session], `answer ${i}`);
  }

  // What the other players can see while the window is open.
  const mid = herd.decodeRoom((await accountData(ER, room, token))!);
  const sealedCount = mid.seats.filter(
    (s) => s.hasAnswered && s.answeredRound === mid.round,
  ).length;
  say(`    ${sealedCount} answers sealed; the words themselves: ${
    (await accountData(ER, answers, token)) ? "READABLE" : "refused"
  }`);

  // Wait out the clock, then close. Anyone may close a round.
  const now = Math.floor(Date.now() / 1000);
  const wait = Number(mid.roundEndsAt) - now + 2;
  if (wait > 0) await sleep(wait * 1000);

  await sendER([herd.closeRound(host.publicKey, ROOM_ID, session.publicKey, round)], [session], "close");

  // Scoring happens in that transaction now - there is no oracle to wait for
  // unless the room has reached two and voted to flip for it.
  let after = herd.decodeRoom((await accountData(ER, room, token))!);
  if (after.awaitingCoin) {
    say("    two left - waiting on the coin");
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      after = herd.decodeRoom((await accountData(ER, room, token))!);
      if (!after.awaitingCoin) break;
    }
    if (after.awaitingCoin) {
      bad("the oracle never answered");
      break;
    }
  }

  const stillIn = after.seats.filter((s) => s.alive).length;
  say(
    `    ${after.outcome === Outcome.Tied ? "every group the same size - nobody strayed" : "the smallest group strayed"} -> ${alive.length - stillIn} out, ${stillIn} left`,
  );

  if (after.phase === Phase.Finished) {
    say(`\n[4] the game is over`);
    break;
  }
}

/* --------------------------------------------------------------- payout */

const finished = herd.decodeRoom((await accountData(ER, room, token))!);
if (finished.phase !== Phase.Finished) {
  bad(`the game did not finish (phase ${finished.phase})`);
} else {
  say("\n[5] hand the room back to Solana and pay out");

  // Deliberately not the host's key. Whoever is left standing finishes the game
  // and collects, using the session key funded when they took their seat - the
  // host may have been out for six rounds and closed the app.
  const stillIn = herd
    .decodeRoom((await accountData(ER, room, token))!)
    .seats.filter((seat) => seat.alive)
    .map((seat) => seat.wallet.toBase58());
  const champion = players.find((p) => stillIn.includes(p.wallet.publicKey.toBase58()));
  if (!champion) throw new Error("no surviving player to settle with");
  say(`    settled by ${champion.wallet.publicKey.toBase58().slice(0, 8)}…, a player, not the host`);

  await sendER(
    [herd.finishRoom(host.publicKey, ROOM_ID, champion.session.publicKey)],
    [champion.session],
    "finish",
  );
  await sleep(14000);

  const onBase = herd.decodeRoom((await accountData(BASE_RPC, room))!);
  const winners = onBase.seats.filter((s) => s.alive).map((s) => s.wallet);
  const wanted = ENDING === Ending.Coin ? 1 : 2;
  say(
    `    the table voted ${Ending[onBase.ending]}; survivors on Solana: ${winners.length}`,
  );
  // The byte the finished screen reads to tell a coin loss from being
  // out-guessed by the room. If it decodes wrong, a losing finalist is shown
  // the wrong story about how they went out.
  const expectCoin = ENDING === Ending.Coin;
  if (onBase.coinDecided === expectCoin) {
    ok(`the room records how it ended (coinDecided ${onBase.coinDecided})`);
  } else {
    bad(`coinDecided is ${onBase.coinDecided}, expected ${expectCoin}`);
  }

  if (winners.length === wanted) {
    ok(
      ENDING === Ending.Coin
        ? "the coin left exactly one winner"
        : "the final two both survived to share the pot",
    );
  } else {
    bad(`expected ${wanted} survivor(s), got ${winners.length}`);
  }

  const before = await Promise.all(winners.map((w) => lamportsOf(BASE_RPC, w)));
  await sendSession(
    [champion.session],
    [herd.settle(host.publicKey, ROOM_ID, champion.session.publicKey, winners)],
    "settle",
  );

  const after = await Promise.all(winners.map((w) => lamportsOf(BASE_RPC, w)));
  const paid = after.map((a, i) => (a ?? 0) - (before[i] ?? 0));
  say(`    paid out: ${paid.join(", ")} lamports`);
  say(`    vault now holds ${await lamportsOf(BASE_RPC, vault)} (rent only)`);

  if (paid.every((p) => p > 0)) ok("the pot reached the winners on Solana");
  else bad("nobody was paid");
}

/* ---------------------------------------------------------------- utils */

/// Anything the host's session key signs on the base layer, waited on.
///
/// Firing one of these and reading the result straight away reports a payout of
/// zero on a payout that worked - the vault is already empty by the time the
/// next line runs, but the winner's balance has not caught up yet.
async function sendSession(signers: Keypair[], ixs: any[], label: string) {
  try {
    const sig = await send(BASE_RPC, signers, ixs);
    await confirm(BASE_RPC, sig);
    return sig;
  } catch (e: any) {
    say(`    ${label} failed: ${String(e.message).split("\n").slice(0, 3).join(" | ")}`);
    throw e;
  }
}

async function sendBase(ixs: any[], label: string) {
  try {
    const sig = await send(BASE_RPC, [host], ixs);
    await confirm(BASE_RPC, sig);
    return sig;
  } catch (e: any) {
    say(`    ${label} failed: ${String(e.message).split("\n").slice(0, 3).join(" | ")}`);
    throw e;
  }
}

async function sendER(ixs: any[], signers: Keypair[], label: string) {
  try {
    const sig = await send(ER, signers, ixs, token);
    await confirm(ER, sig, token);
    return sig;
  } catch (e: any) {
    say(`    ${label} failed: ${String(e.message).split("\n").slice(0, 3).join(" | ")}`);
    throw e;
  }
}

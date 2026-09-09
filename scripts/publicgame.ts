/**
 * A whole public game: queued, dealt, sealed, played, paid.
 *
 * The part worth watching is the delegation. A private room is handed to a
 * rollup by its host, and the people who joined their code chose to trust them.
 * A dealt room has no host, so anybody may hand it over - which would be an
 * invitation to hand it to a rollup you run and read six strangers' sealed
 * answers. The program pins the validator instead, so the person who triggers
 * it is choosing nothing.
 */
import { Keypair, PublicKey, SystemProgram, Transaction, Connection } from "@solana/web3.js";
import {
  BASE_RPC, TEE_VALIDATOR, accountData, authenticate, confirm, delegationOf,
  lamportsOf, loadKeypair, send, sleep,
} from "./lib/chain";
import { Ending, Herd, Phase } from "./lib/herd";
import idl from "./idl.json";

const herd = new Herd(idl);
const payer = loadKeypair(`${process.env.HOME}/.config/solana/id.json`);
const STAKE = 10_000_000n;
const ER = "https://devnet-tee.magicblock.app/";
const conn = new Connection(BASE_RPC, "confirmed");
const queue = herd.queue(STAKE);

const ok = (m: string) => console.log(`   PASS  ${m}`);
const bad = (m: string) => console.log(`   FAIL  ${m}`);
const fire = async (s: Keypair[], ix: any[], label: string) => {
  try {
    const sig = await send(BASE_RPC, s, ix);
    await confirm(BASE_RPC, sig);
    return sig;
  } catch (e: any) {
    console.log(`    ${label}: ${String(e.message).split("\n").slice(0, 3).join(" | ")}`);
    throw e;
  }
};

// A free table.
let index = 0n;
while (true) {
  const d = await accountData(BASE_RPC, herd.publicRoom(STAKE, index));
  if (!d) {
    await fire([payer], [herd.openPublicRoom(payer.publicKey, STAKE, index)], "build");
    break;
  }
  const st = herd.decodeRoom(d);
  if (st.phase === Phase.Open || st.phase === Phase.Settled) break;
  index += 1n;
}
const room = herd.publicRoom(STAKE, index);
console.log(`public room ${index}  ${room.toBase58()}`);

console.log("\n[1] six strangers queue up");
const people = Array.from({ length: 6 }, () => ({
  wallet: Keypair.generate(),
  session: Keypair.generate(),
}));
const fund = new Transaction();
people.forEach((p) => {
  fund.add(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: p.wallet.publicKey,
    lamports: Number(STAKE) + 15_000_000,
  }));
  fund.add(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: p.session.publicKey, lamports: 5_000_000,
  }));
});
fund.feePayer = payer.publicKey;
fund.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
fund.sign(payer);
await confirm(BASE_RPC, await conn.sendRawTransaction(fund.serialize()));

for (const p of people) {
  await fire([p.wallet],
    [herd.enterQueue(p.wallet.publicKey, STAKE, p.session.publicKey, Ending.Split)], "enter");
}
console.log(`    ${herd.decodeQueue((await accountData(BASE_RPC, queue))!).count} waiting`);

console.log("\n[2] the oracle deals them a room");
await fire([payer], [herd.deal(payer.publicKey, STAKE, index, 11)], "deal");
let state = null;
for (let i = 0; i < 25; i++) {
  await sleep(1500);
  if (!herd.decodeQueue((await accountData(BASE_RPC, queue))!).awaitingDeal) {
    state = herd.decodeRoom((await accountData(BASE_RPC, room))!);
    break;
  }
}
if (!state || state.seats.length !== 6) { bad("the deal never landed"); process.exit(1); }
console.log(`    ${state.seats.length} seated, pot ${await lamportsOf(BASE_RPC, herd.vault(room))}`);

console.log("\n[3] a stranger tries to hand the room to their own rollup");
try {
  const impostor = Keypair.generate();
  await confirm(BASE_RPC, await send(BASE_RPC, [payer], [
    herd.delegateRoom(queue, index, payer.publicKey, impostor.publicKey),
  ]));
  bad("a public room was delegated to an arbitrary validator");
} catch {
  ok("refused - a public room goes to the pinned rollup or nowhere");
}

console.log("\n[4] and to the one it is pinned to");
await fire([payer], [herd.delegateRoom(queue, index, payer.publicKey, TEE_VALIDATOR)], "delegate");
const status = await delegationOf(room);
console.log(`    room -> ${status.fqdn} (${status.isDelegated})`);

const token = await authenticate(ER, people[0].session);
await confirm(ER, await send(ER, [people[0].session], [herd.sealRoom(queue, index)], token), token);
const peek = await accountData(ER, herd.answers(room), token);
if (peek) bad("the answers are readable"); else ok("the answers are sealed to everybody");

console.log("\n[5] they play");
const WORDS = ["apple", "apple", "apple", "banana", "cherry", "date"];
for (let i = 0; i < people.length; i++) {
  await send(ER, [people[i].session],
    [herd.submitAnswer(queue, index, people[i].session.publicKey, WORDS[i])], token);
}
let live = herd.decodeRoom((await accountData(ER, room, token))!);
const waitFor = Number(live.roundEndsAt) - Math.floor(Date.now() / 1000) + 2;
if (waitFor > 0) await sleep(waitFor * 1000);
await confirm(ER, await send(ER, [people[0].session],
  [herd.closeRound(queue, index, people[0].session.publicKey, 5)], token), token);
live = herd.decodeRoom((await accountData(ER, room, token))!);
console.log(`    round scored: ${live.seats.filter((s) => s.alive).length} left of 6`);
if (live.seats.filter((s) => s.alive).length === 3) {
  ok("the three who strayed went, the three on apple stayed");
} else {
  bad(`expected 3 left, got ${live.seats.filter((s) => s.alive).length}`);
}

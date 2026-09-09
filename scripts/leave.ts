/** A room that never fills, and the money coming back out of it. */
import { Keypair, PublicKey, SystemProgram, Transaction, Connection } from "@solana/web3.js";
import { BASE_RPC, accountData, confirm, lamportsOf, loadKeypair, send } from "./lib/chain";
import { Herd, Phase } from "./lib/herd";
import idl from "./idl.json";

const herd = new Herd(idl);
const host = loadKeypair(`${process.env.HOME}/.config/solana/id.json`);
const ROOM_ID = BigInt(Date.now() % 1_000_000);
const STAKE = 10_000_000n;

const room = herd.room(host.publicKey, ROOM_ID);
const vault = herd.vault(room);
const conn = new Connection(BASE_RPC, "confirmed");

const friend = Keypair.generate();
const fund = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: host.publicKey,
    toPubkey: friend.publicKey,
    lamports: Number(STAKE) + 20_000_000,
  }),
);
fund.feePayer = host.publicKey;
fund.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
fund.sign(host);
await confirm(BASE_RPC, await conn.sendRawTransaction(fund.serialize()));

const s1 = Keypair.generate();
await confirm(BASE_RPC, await send(BASE_RPC, [host], [
  herd.createRoom(host.publicKey, ROOM_ID, STAKE, 30, s1.publicKey),
  herd.joinRoom(host.publicKey, ROOM_ID, host.publicKey, s1.publicKey),
]));

const s2 = Keypair.generate();
await confirm(BASE_RPC, await send(BASE_RPC, [friend], [
  herd.joinRoom(host.publicKey, ROOM_ID, friend.publicKey, s2.publicKey),
]));

console.log(`two seats taken, the third never arrives`);
console.log(`  vault holds ${await lamportsOf(BASE_RPC, vault)}`);
const before = (await lamportsOf(BASE_RPC, friend.publicKey))!;

await confirm(BASE_RPC, await send(BASE_RPC, [friend], [
  herd.leaveRoom(host.publicKey, ROOM_ID, friend.publicKey),
]));

const after = (await lamportsOf(BASE_RPC, friend.publicKey))!;
const state = herd.decodeRoom((await accountData(BASE_RPC, room))!);
console.log(`  friend leaves: ${before} -> ${after}  (+${after - before})`);
console.log(`  vault now holds ${await lamportsOf(BASE_RPC, vault)}`);
console.log(`  seats left: ${state.seats.length}, phase ${Phase[state.phase]}`);
console.log(after > before && state.seats.length === 1 ? "PASS  the stake came back" : "FAIL");

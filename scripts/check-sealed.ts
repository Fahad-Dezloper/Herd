/**
 * Can a program still write an account that has been sealed to nobody?
 *
 * The permission gates RPC reads. Whether it also gates a program running
 * inside the rollup decides the account layout: if the program can still see a
 * sealed account, public game state and secret answers can share one account.
 * If it cannot, they must be split.
 *
 * Driven against the spike program still deployed on devnet, so the instruction
 * is built by hand rather than from the current IDL.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";

import { accountData, authenticate, confirm, delegationOf, loadKeypair, send } from "./lib/chain";

const SPIKE = new PublicKey("BvKkFUEdiin8KcF6m9CBqYoN9FncGFFy4cxhe5QZSvWN");
const owner = loadKeypair(`${process.env.HOME}/.config/solana/id.json`);
const probe = PublicKey.findProgramAddressSync(
  [Buffer.from("probe"), owner.publicKey.toBuffer()],
  SPIKE,
)[0];

const disc = (name: string) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const status = await delegationOf(probe);
const ER = status.fqdn!.replace(/\/$/, "");
const token = await authenticate(ER, owner);

console.log("probe :", probe.toBase58());
console.log("rpc   :", (await accountData(ER, probe, token)) ? "readable" : "refused");

const ix = new TransactionInstruction({
  programId: SPIKE,
  keys: [{ pubkey: probe, isSigner: false, isWritable: true }],
  data: disc("bump_probe"),
});

try {
  const sig = await send(ER, [owner], [ix], token);
  await confirm(ER, sig, token);
  console.log(`PASS  a program can still write a sealed account (${sig.slice(0, 16)}…)`);
  console.log("      => public state and sealed answers can live in one account");
} catch (e: any) {
  console.log("FAIL ", String(e.message).split("\n").filter(Boolean).slice(0, 2).join(" | "));
  console.log("      => they must be split into two accounts");
}

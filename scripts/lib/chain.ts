/**
 * Talking to Solana and to a MagicBlock rollup.
 *
 * Three endpoints, and using the wrong one is the classic mistake:
 *   base   - Solana. Rooms, stakes, settlement.
 *   router - answers "is this account delegated, and to which rollup?"
 *   rollup - the fqdn the router hands back. Everything mid-game.
 *
 * Nothing is ever submitted through a wallet. A rollup transaction carries the
 * rollup's own blockhash, which no wallet can place on a Solana cluster, and a
 * private rollup wants an auth token on the URL besides. We sign and deliver.
 */

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

export const BASE_RPC = "https://rpc.magicblock.app/devnet";
export const ROUTER_RPC = "https://devnet-router.magicblock.app/";

/** MagicBlock's devnet TEE validator - the private one. */
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

export async function rpc(url: string, method: string, params: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

export interface Delegation {
  isDelegated: boolean;
  fqdn?: string;
  authority?: string;
  owner?: string;
}

export async function delegationOf(account: PublicKey): Promise<Delegation> {
  const r = await rpc(ROUTER_RPC, "getDelegationStatus", [account.toBase58()]);
  return {
    isDelegated: !!r?.isDelegated,
    fqdn: r?.fqdn,
    authority: r?.delegationRecord?.authority,
    owner: r?.delegationRecord?.owner,
  };
}

/** Raw account data, or null when the endpoint refuses to show it. */
export async function accountData(
  url: string,
  key: PublicKey,
  token?: string,
): Promise<Uint8Array | null> {
  const value = await rpc(authed(url, token), "getAccountInfo", [
    key.toBase58(),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  if (!value?.value) return null;
  return Uint8Array.from(Buffer.from(value.value.data[0], "base64"));
}

export async function lamportsOf(url: string, key: PublicKey): Promise<number | null> {
  // Commitment is pinned everywhere. Writing at `confirmed` and reading at the
  // default `finalized` makes a freshly created account look like it does not
  // exist, which reads as a much more interesting bug than it is.
  const value = await rpc(url, "getAccountInfo", [
    key.toBase58(),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  return value?.value?.lamports ?? null;
}

function authed(url: string, token?: string): string {
  const base = url.replace(/\/$/, "");
  return token ? `${base}/?token=${encodeURIComponent(token)}` : base;
}

/**
 * Prove to a private rollup which key is asking.
 *
 * Membership of the account's ephemeral permission then decides whether a read
 * is answered - authenticating as a key that is not a member gets exactly the
 * same `null` as not authenticating at all.
 */
export async function authenticate(fqdn: string, signer: Keypair): Promise<string> {
  const base = fqdn.replace(/\/$/, "");
  const pubkey = signer.publicKey.toBase58();

  const ch = await (await fetch(`${base}/auth/challenge?pubkey=${pubkey}`)).json();
  if (typeof ch.challenge !== "string") throw new Error("no challenge from the rollup");

  const signature = nacl.sign.detached(new TextEncoder().encode(ch.challenge), signer.secretKey);
  const login = await (
    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey, challenge: ch.challenge, signature: bs58.encode(signature) }),
    })
  ).json();

  const token = login.token ?? login.access_token;
  if (!token) throw new Error("the rollup returned no token");
  return token;
}

/** Sign and submit. `url` decides which chain; nothing else does. */
export async function send(
  url: string,
  signers: Keypair[],
  instructions: any[],
  token?: string,
): Promise<string> {
  const target = authed(url, token);
  const conn = new Connection(target, "confirmed");
  const { blockhash } = await conn.getLatestBlockhash();

  const tx = new Transaction({ feePayer: signers[0].publicKey, recentBlockhash: blockhash });
  instructions.forEach((i) => tx.add(i));
  tx.sign(...signers);

  return conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
}

export async function confirm(url: string, signature: string, token?: string): Promise<void> {
  const conn = new Connection(authed(url, token), "confirmed");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

/**
 * Session keys.
 *
 * A round lasts fifteen seconds. Asking for a fingerprint on every answer would
 * make the game unplayable, so at join time the wallet registers a throwaway key
 * and the phone signs answers with it locally - no wallet, no biometric, no
 * round trip through another app.
 *
 * What it can do is deliberately tiny. `submit_answer` is the only instruction
 * that accepts it; it cannot take a seat, close a round, finish a game or move a
 * lamport. Losing it costs you the rest of one game and nothing else.
 *
 * One key per room, so a key leaked from one game is worthless in the next.
 */

import { Keypair } from "@solana/web3.js";

import { secureStore } from "./secure";

const key = (room: string) => `herd.session.${room}`;

export async function sessionFor(room: string): Promise<Keypair> {
  const saved = await secureStore.get(key(room));
  if (saved) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
    } catch {
      // Corrupt or from an older build. A fresh key is fine - it only matters
      // for a room you have not joined yet.
    }
  }

  const fresh = Keypair.generate();
  await secureStore.set(key(room), JSON.stringify(Array.from(fresh.secretKey)));
  return fresh;
}

export async function forgetSession(room: string): Promise<void> {
  await secureStore.del(key(room));
}

/**
 * Bots, so the game can be played without five other people in the room.
 *
 * They are not a simulation layer. Each one is a real keypair that takes a real
 * seat, pays a real stake into the vault and signs its own answers inside the
 * rollup - the program cannot tell them apart from anyone else, which is the
 * only way a demo of this is honest. The one thing they get for free is funding:
 * the host tops them up once so they can cover their stake.
 *
 * They also cannot see anything you cannot. A bot picks from a table of likely
 * answers, exactly as a person would guess at the room, because the answers are
 * sealed to it as well.
 */

import { Keypair } from "@solana/web3.js";

import { secureStore } from "./lib/secure";

export interface Bot {
  name: string;
  keypair: Keypair;
}

const NAMES = ["mila", "0xTeo", "raj", "quietfox", "dega", "bram", "nix", "sol.eth"];

/**
 * What a bot is likely to say, weighted so a crowd actually forms.
 *
 * The long tail is what gets them killed, and it should - a room where everyone
 * always says the same thing never eliminates anybody. Keyed by the question
 * itself so a bot answers the question in front of it rather than a round
 * number.
 */
const POOLS: Record<string, [string, number][]> = {
  "Name a fruit.": [["apple", 6], ["banana", 4], ["orange", 2], ["mango", 1], ["grape", 1]],
  "An excuse for being late.": [["traffic", 6], ["train", 3], ["overslept", 3], ["alarm", 1]],
  "Something you'd never eat cold.": [["pizza", 5], ["soup", 4], ["rice", 2], ["eggs", 1]],
  "A reason to leave a party early.": [["tired", 6], ["work", 3], ["boring", 2], ["headache", 1]],
  "Name a colour.": [["blue", 6], ["red", 5], ["green", 2], ["black", 1]],
  "Something in every kitchen.": [["fridge", 5], ["kettle", 3], ["sink", 3], ["oven", 2]],
  "A thing people lie about.": [["age", 5], ["money", 4], ["weight", 3], ["work", 1]],
  "Name an animal.": [["dog", 6], ["cat", 5], ["lion", 2], ["horse", 1]],
  "Somewhere you'd never swim.": [["river", 4], ["sea", 3], ["pond", 3], ["lake", 2]],
  "A word you can't spell.": [["necessary", 4], ["definitely", 4], ["rhythm", 3], ["queue", 1]],
  "Something you own too many of.": [["socks", 4], ["cables", 4], ["mugs", 3], ["books", 2]],
  "A terrible name for a dog.": [["kevin", 4], ["steve", 3], ["cat", 3], ["brian", 2]],
};

const FALLBACK: [string, number][] = [["yes", 3], ["no", 2], ["maybe", 1]];

export function botAnswer(question: string): string {
  const pool = POOLS[question] ?? FALLBACK;
  const total = pool.reduce((n, [, w]) => n + w, 0);
  let r = Math.random() * total;
  for (const [word, weight] of pool) {
    r -= weight;
    if (r <= 0) return word;
  }
  return pool[0][0];
}

/** Roughly human timing, inside the window. */
export function botDelay(roundSeconds: number): number {
  const usable = Math.max(2, roundSeconds - 4) * 1000;
  return 800 + Math.random() * usable;
}

/**
 * Bots for a room, kept so the same ones come back after a reload.
 *
 * They hold real lamports - their stake, and whatever they win - so throwing the
 * keys away would strand money. Stored per room in the Keystore.
 */
export async function botsFor(room: string, count: number): Promise<Bot[]> {
  const key = `herd.bots.${room}`;
  const saved = await secureStore.get(key);

  if (saved) {
    try {
      const parsed = JSON.parse(saved) as { name: string; secret: number[] }[];
      return parsed.map((b) => ({
        name: b.name,
        keypair: Keypair.fromSecretKey(Uint8Array.from(b.secret)),
      }));
    } catch {
      // Written by an older build. Fresh bots are fine; the old ones only ever
      // held a stake for a game that is over.
    }
  }

  const bots: Bot[] = Array.from({ length: count }, (_, i) => ({
    name: NAMES[i % NAMES.length],
    keypair: Keypair.generate(),
  }));

  await secureStore.set(
    key,
    JSON.stringify(bots.map((b) => ({ name: b.name, secret: Array.from(b.keypair.secretKey) }))),
  );
  return bots;
}

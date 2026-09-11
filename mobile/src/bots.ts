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
import { OPTIONS } from "./questions";

/**
 * How one bot plays, as two numbers.
 *
 * Bots that all behave identically stop being players and become a mechanism -
 * six seats answering in the same half-second with the same instinct is
 * something a person notices in one round. These two dials are enough to make
 * them feel like different people at the table.
 *
 * `herdiness` is how badly they want to be with the crowd. High means they take
 * the obvious answer nearly every time, which is safe and dull. Low means they
 * will back a word almost nobody picks - which is how a person actually loses.
 *
 * `haste` is how soon they answer. The room can see who has locked in, so
 * somebody answering instantly every round and somebody who always cuts it fine
 * are visibly different players.
 */
export interface Persona {
  herdiness: number;
  haste: number;
}

export interface Bot {
  name: string;
  persona: Persona;
  keypair: Keypair;
}

/** Handles, not addresses. A pubkey at the table is the thing that gives a bot away. */
const NAMES = ["mila", "0xTeo", "raj", "quietfox", "dega", "bram", "nix", "sol.eth"];

const PERSONAS: Persona[] = [
  { herdiness: 0.9, haste: 0.25 }, // mila answers early and safe
  { herdiness: 0.5, haste: 0.8 },  // 0xTeo leaves it late and takes risks
  { herdiness: 0.75, haste: 0.5 },
  { herdiness: 0.35, haste: 0.9 }, // quietfox is the one who dies alone
  { herdiness: 0.8, haste: 0.35 },
  { herdiness: 0.6, haste: 0.65 },
  { herdiness: 0.7, haste: 0.15 }, // nix always answers first
  { herdiness: 0.45, haste: 0.7 },
];

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

/**
 * What a bot says.
 *
 * It plays the same six words the human is looking at, because that is the game
 * everybody else is playing - a bot answering "bureaucracy" while the screen
 * offers six fruit is not a player, it is a tell. The weights come from the
 * pool, so the obvious answers stay obvious, and how hard a bot leans on them
 * is its own personality.
 *
 * Sometimes it types its own word instead. A room where nobody ever goes
 * off-menu is a room where the smallest group is always somebody who tapped an
 * unpopular pill, and real tables are not that tidy.
 */
export function botAnswer(question: string, persona?: Persona): string {
  const herdiness = persona?.herdiness ?? 0.7;
  const options = OPTIONS[question] ?? [];
  const pool = POOLS[question] ?? FALLBACK;

  // A contrarian occasionally writes something nobody offered them.
  if (options.length > 0 && Math.random() > 0.92 - (1 - herdiness) * 0.1) {
    const stray = pool[pool.length - 1][0];
    if (!options.includes(stray)) return stray;
  }

  const words = options.length > 0 ? options : pool.map(([w]) => w);
  const weightOf = (word: string) => {
    const known = pool.find(([w]) => w === word);
    const base = known ? known[1] : 1;
    // Herdiness sharpens the popular answers; a low one flattens the table
    // until an unpopular word is a real possibility.
    return Math.pow(base, 0.4 + herdiness * 1.8);
  };

  const total = words.reduce((n, w) => n + weightOf(w), 0);
  let r = Math.random() * total;
  for (const word of words) {
    r -= weightOf(word);
    if (r <= 0) return word;
  }
  return words[0];
}

/**
 * When a bot answers.
 *
 * Spread across the window rather than bunched, and shaped by how hasty the bot
 * is, so the seat list fills the way a real room fills: one person instantly,
 * a couple in the middle, and somebody still thinking with four seconds left.
 */
export function botDelay(roundSeconds: number, persona?: Persona): number {
  const haste = persona?.haste ?? 0.5;
  const usable = Math.max(2, roundSeconds - 5) * 1000;
  const centre = usable * haste;
  const jitter = (Math.random() - 0.5) * usable * 0.35;
  return Math.max(700, Math.min(usable, centre + jitter));
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
      const parsed = JSON.parse(saved) as {
        name: string;
        persona?: Persona;
        secret: number[];
      }[];
      return parsed.map((b, i) => ({
        name: b.name,
        persona: b.persona ?? PERSONAS[i % PERSONAS.length],
        keypair: Keypair.fromSecretKey(Uint8Array.from(b.secret)),
      }));
    } catch {
      // Written by an older build. Fresh bots are fine; the old ones only ever
      // held a stake for a game that is over.
    }
  }

  // Shuffled so the same names do not always sit in the same seats with the
  // same temperaments.
  const picks = NAMES.map((name, i) => ({ name, persona: PERSONAS[i] }))
    .sort(() => Math.random() - 0.5)
    .slice(0, count);

  const bots: Bot[] = picks.map((p) => ({
    name: p.name,
    persona: p.persona,
    keypair: Keypair.generate(),
  }));

  await secureStore.set(
    key,
    JSON.stringify(
      bots.map((b) => ({
        name: b.name,
        persona: b.persona,
        secret: Array.from(b.keypair.secretKey),
      })),
    ),
  );
  return bots;
}

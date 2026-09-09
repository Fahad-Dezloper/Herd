/**
 * The Herd client: addresses, state decoding, and the room lifecycle.
 *
 * Instructions come from the generated IDL rather than hand-written account
 * lists - the delegation, commit and VRF macros inject accounts that appear
 * nowhere in the Rust source, so a list written by reading the program is wrong
 * before it runs.
 */

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { Program, concat, optionPubkey, u64, u8 } from "./program";

export const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
export const EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");

/**
 * The oracle queue on Solana itself.
 *
 * Rounds run inside the rollup and ask the delegated queue; dealing a room
 * happens on the base layer, where the line and the empty rooms live, so it has
 * to ask the base-layer one. Asking the wrong queue fails the constraint.
 */
export const BASE_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");

export const MAX_PLAYERS = 12;
export const MAX_ANSWER = 24;

export enum Phase {
  Open = 0,
  Playing = 1,
  Finished = 2,
  Settled = 3,
}

/**
 * What happens when a room comes down to two.
 *
 * Two players carry no signal - "match the herd" needs a herd, and with two
 * left, same-word and different-word are symmetric under both rules, so no
 * heads-up round can ever cull anybody. The table votes on the tiebreak at the
 * door, before anyone knows who they would be facing.
 */
export enum Ending {
  /** The last two share the pot. */
  Split = 0,
  /** The oracle picks one of the two, and they take all of it. */
  Coin = 1,
}

/**
 * How a round ended.
 *
 * The rule never changes - the smallest group strayed and goes - so this
 * records whether that happened, not which rule applied. It cannot always: a
 * room where every group is the same size has no odd one out, and a round like
 * that has to say so rather than looking like one that failed.
 */
export enum Outcome {
  Pending = 0,
  /** The smallest group went. */
  Smallest = 1,
  /** Every group was the same size. Nobody strayed, so nobody went. */
  Tied = 2,
}

export interface Seat {
  wallet: PublicKey;
  session: PublicKey;
  alive: boolean;
  answeredRound: number;
  hasAnswered: boolean;
  /** What this player wants to happen if they reach the final two. */
  endingVote: Ending;
}

export interface Said {
  wallet: PublicKey;
  word: string;
  alive: boolean;
}

/** How many can wait at once, and how many a dealt room seats. */
export const QUEUE_CAP = 24;
export const PUBLIC_ROOM_SIZE = 6;

export interface WaitingState {
  wallet: PublicKey;
  session: PublicKey;
  endingVote: Ending;
}

export interface QueueState {
  stake: bigint;
  roundSeconds: number;
  waiting: WaitingState[];
  count: number;
  /** A deal is out with the oracle. */
  awaitingDeal: boolean;
  dealingInto: bigint;
}

export interface RoomState {
  host: PublicKey;
  hostSession: PublicKey;
  roomId: bigint;
  stake: bigint;
  roundSeconds: number;
  phase: Phase;
  round: number;
  roundEndsAt: bigint;
  outcome: Outcome;
  /** The table's vote on the tiebreak, tallied when the door closed. */
  ending: Ending;
  /** Seated by the oracle from the public queue rather than opened by a person. */
  dealt: boolean;
  /** Whether the last two were separated by the coin rather than by the herd. */
  coinDecided: boolean;
  /** A coin flip is out with the oracle and has not come back. */
  awaitingCoin: boolean;
  seats: Seat[];
  /** What everyone said in the round that just finished. */
  lastRound: number;
  lastWords: string[];
  bump: number;
  vaultBump: number;
  answersBump: number;
}

export class Herd {
  readonly program: Program;

  constructor(idl: any) {
    this.program = new Program(idl);
  }

  get id() {
    return this.program.id;
  }

  room(host: PublicKey, roomId: bigint | number): PublicKey {
    return this.program.pda([Buffer.from("room"), host.toBuffer(), Buffer.from(u64(roomId))]);
  }

  vault(room: PublicKey): PublicKey {
    return this.program.pda([Buffer.from("vault"), room.toBuffer()]);
  }

  answers(room: PublicKey): PublicKey {
    return this.program.pda([Buffer.from("answers"), room.toBuffer()]);
  }

  /** The permission program's account for a sealed account. */
  permission(account: PublicKey): PublicKey {
    // The seed carries a trailing colon. Dropping it derives a different,
    // perfectly valid-looking address that the program then rejects.
    return PublicKey.findProgramAddressSync(
      [Buffer.from("permission:"), account.toBuffer()],
      PERMISSION_PROGRAM,
    )[0];
  }

  /** Every name the IDL might ask for, for one room. */
  named(host: PublicKey, roomId: bigint | number, extra: Record<string, PublicKey> = {}) {
    const room = this.room(host, roomId);
    const answers = this.answers(room);
    return {
      host,
      room,
      answers,
      vault: this.vault(room),
      permission: this.permission(answers),
      "room.host": host,
      system_program: SystemProgram.programId,
      ...extra,
    };
  }

  /* -------------------------------------------------------- instructions */

  createRoom(
    host: PublicKey,
    roomId: bigint | number,
    stake: bigint,
    roundSeconds: number,
    hostSession: PublicKey,
  ) {
    return this.program.build(
      "create_room",
      this.named(host, roomId),
      concat(u64(roomId), u64(stake), u16(roundSeconds), hostSession.toBytes()),
    );
  }

  /**
   * `endingVote` is this player's say in what happens if the room comes down to
   * two: `Ending.Split` to share the pot, `Ending.Coin` to let the oracle pick
   * one. Majority at the door decides it for the table; a tie goes to Split.
   */
  joinRoom(
    host: PublicKey,
    roomId: bigint | number,
    player: PublicKey,
    session: PublicKey,
    endingVote: Ending = Ending.Split,
  ) {
    return this.program.build(
      "join_room",
      this.named(host, roomId, { player }),
      concat(session.toBytes(), Uint8Array.from([endingVote])),
    );
  }

  /* ------------------------------------------------------- public rooms */

  queue(stake: bigint): PublicKey {
    return this.program.pda([Buffer.from("queue"), Buffer.from(u64(stake))]);
  }

  queueVault(queue: PublicKey): PublicKey {
    return this.program.pda([Buffer.from("qvault"), queue.toBuffer()]);
  }

  /** A public room is furniture: built once and dealt a new game each time. */
  publicRoom(stake: bigint, index: bigint | number): PublicKey {
    return this.program.pda([
      Buffer.from("room"),
      this.queue(stake).toBuffer(),
      Buffer.from(u64(index)),
    ]);
  }

  openQueue(payer: PublicKey, stake: bigint, roundSeconds: number) {
    return this.program.build(
      "open_queue",
      { payer, queue: this.queue(stake), vault: this.queueVault(this.queue(stake)) },
      concat(u64(stake), u16(roundSeconds)),
    );
  }

  openPublicRoom(payer: PublicKey, stake: bigint, index: bigint | number) {
    const queue = this.queue(stake);
    const room = this.publicRoom(stake, index);
    return this.program.build(
      "open_public_room",
      {
        payer,
        queue,
        room,
        vault: this.vault(room),
        answers: this.answers(room),
      },
      u64(index),
    );
  }

  enterQueue(player: PublicKey, stake: bigint, session: PublicKey, endingVote: Ending) {
    const queue = this.queue(stake);
    return this.program.build(
      "enter_queue",
      { player, queue, vault: this.queueVault(queue) },
      concat(session.toBytes(), Uint8Array.from([endingVote])),
    );
  }

  leaveQueue(player: PublicKey, stake: bigint) {
    const queue = this.queue(stake);
    return this.program.build("leave_queue", {
      player,
      queue,
      vault: this.queueVault(queue),
    });
  }

  deal(payer: PublicKey, stake: bigint, index: bigint | number, clientSeed: number) {
    const queue = this.queue(stake);
    const room = this.publicRoom(stake, index);
    return this.program.build(
      "deal",
      {
        payer,
        queue,
        room,
        queue_vault: this.queueVault(queue),
        room_vault: this.vault(room),
        oracle_queue: BASE_QUEUE,
      },
      Uint8Array.from([clientSeed]),
    );
  }

  /** Take a seat back, and the stake with it. Only while the room is open. */
  leaveRoom(host: PublicKey, roomId: bigint | number, player: PublicKey) {
    return this.program.build("leave_room", this.named(host, roomId, { player }));
  }

  /** `authority` is the host, or the host's session key. */
  lockRoom(host: PublicKey, roomId: bigint | number, authority: PublicKey) {
    return this.program.build("lock_room", this.named(host, roomId, { authority }));
  }

  delegateRoom(
    host: PublicKey,
    roomId: bigint | number,
    authority: PublicKey,
    validator: PublicKey | null,
  ) {
    return this.program.build(
      "delegate_room",
      this.named(host, roomId, { authority }),
      optionPubkey(validator),
    );
  }

  sealRoom(host: PublicKey, roomId: bigint | number) {
    return this.program.build("seal_room", this.named(host, roomId));
  }

  submitAnswer(host: PublicKey, roomId: bigint | number, session: PublicKey, answer: string) {
    const bytes = new TextEncoder().encode(answer.slice(0, MAX_ANSWER));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, true);
    return this.program.build(
      "submit_answer",
      this.named(host, roomId, { session }),
      concat(len, bytes),
    );
  }

  closeRound(host: PublicKey, roomId: bigint | number, payer: PublicKey, seed = 1) {
    return this.program.build(
      "close_round",
      this.named(host, roomId, { payer, oracle_queue: EPHEMERAL_QUEUE }),
      u8(seed),
    );
  }

  finishRoom(host: PublicKey, roomId: bigint | number, payer: PublicKey) {
    return this.program.build("finish_room", this.named(host, roomId, { payer }));
  }

  settle(host: PublicKey, roomId: bigint | number, caller: PublicKey, winners: PublicKey[]) {
    const ix = this.program.build("settle", this.named(host, roomId, { caller }));
    winners.forEach((w) => ix.keys.push({ pubkey: w, isSigner: false, isWritable: true }));
    return ix;
  }

  /* ------------------------------------------------------------- decoding */

  decodeQueue(data: Uint8Array): QueueState {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 8;

    const stake = view.getBigUint64(at, true);
    at += 8;
    const roundSeconds = view.getUint16(at, true);
    at += 2;

    const waiting: WaitingState[] = [];
    for (let i = 0; i < QUEUE_CAP; i++) {
      const wallet = new PublicKey(data.slice(at, at + 32));
      at += 32;
      const session = new PublicKey(data.slice(at, at + 32));
      at += 32;
      const endingVote = data[at] as Ending;
      at += 1;
      waiting.push({ wallet, session, endingVote });
    }

    const count = data[at];
    at += 1;
    const awaitingDeal = data[at] === 1;
    at += 1;
    const dealingInto = view.getBigUint64(at, true);
    at += 8;

    return {
      stake,
      roundSeconds,
      waiting: waiting.slice(0, count),
      count,
      awaitingDeal,
      dealingInto,
    };
  }

  decodeRoom(data: Uint8Array): RoomState {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 8;

    const key = () => {
      const k = new PublicKey(data.slice(at, at + 32));
      at += 32;
      return k;
    };

    const host = key();
    const hostSession = key();
    const roomId = view.getBigUint64(at, true);
    at += 8;
    const stake = view.getBigUint64(at, true);
    at += 8;
    const roundSeconds = view.getUint16(at, true);
    at += 2;
    const phase = data[at] as Phase;
    at += 1;
    const round = view.getUint16(at, true);
    at += 2;
    const roundEndsAt = view.getBigInt64(at, true);
    at += 8;
    const outcome = data[at] as Outcome;
    at += 1;
    const ending = data[at] as Ending;
    at += 1;
    const dealt = data[at] === 1;
    at += 1;
    const coinDecided = data[at] === 1;
    at += 1;
    const awaitingCoin = data[at] === 1;
    at += 1;

    const seats: Seat[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const wallet = key();
      const session = key();
      const alive = data[at] === 1;
      at += 1;
      const answeredRound = view.getUint16(at, true);
      at += 2;
      const hasAnswered = data[at] === 1;
      at += 1;
      const endingVote = data[at] as Ending;
      at += 1;
      seats.push({ wallet, session, alive, answeredRound, hasAnswered, endingVote });
    }

    const seatCount = data[at];
    at += 1;

    const lastRound = view.getUint16(at, true);
    at += 2;
    const lastWords: string[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      lastWords.push(new TextDecoder().decode(data.slice(at, at + MAX_ANSWER)));
      at += MAX_ANSWER;
    }
    for (let i = 0; i < MAX_PLAYERS; i++) {
      lastWords[i] = lastWords[i].slice(0, data[at + i]);
    }
    at += MAX_PLAYERS;

    const bump = data[at++];
    const vaultBump = data[at++];
    const answersBump = data[at++];

    return {
      host,
      hostSession,
      roomId,
      stake,
      roundSeconds,
      phase,
      round,
      roundEndsAt,
      outcome,
      ending,
      dealt,
      coinDecided,
      awaitingCoin,
      seats: seats.slice(0, seatCount),
      lastRound,
      lastWords: lastWords.slice(0, seatCount),
      bump,
      vaultBump,
      answersBump,
    };
  }
}

function u16(n: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, n, true);
  return out;
}

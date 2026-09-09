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

export const MAX_PLAYERS = 12;
export const MAX_ANSWER = 24;

export enum Phase {
  Open = 0,
  Playing = 1,
  Finished = 2,
  Settled = 3,
}

export enum Rule {
  Undrawn = 0,
  MajoritySurvives = 1,
  MinoritySurvives = 2,
}

export interface Seat {
  wallet: PublicKey;
  session: PublicKey;
  alive: boolean;
  answeredRound: number;
  hasAnswered: boolean;
}

export interface RoomState {
  host: PublicKey;
  roomId: bigint;
  stake: bigint;
  roundSeconds: number;
  phase: Phase;
  round: number;
  roundEndsAt: bigint;
  rule: Rule;
  awaitingRule: boolean;
  seats: Seat[];
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

  createRoom(host: PublicKey, roomId: bigint | number, stake: bigint, roundSeconds: number) {
    return this.program.build(
      "create_room",
      this.named(host, roomId),
      concat(u64(roomId), u64(stake), u16(roundSeconds)),
    );
  }

  joinRoom(host: PublicKey, roomId: bigint | number, player: PublicKey, session: PublicKey) {
    return this.program.build(
      "join_room",
      this.named(host, roomId, { player }),
      session.toBytes(),
    );
  }

  lockRoom(host: PublicKey, roomId: bigint | number) {
    return this.program.build("lock_room", this.named(host, roomId));
  }

  delegateRoom(host: PublicKey, roomId: bigint | number, validator: PublicKey | null) {
    return this.program.build(
      "delegate_room",
      this.named(host, roomId),
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

  decodeRoom(data: Uint8Array): RoomState {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 8;

    const key = () => {
      const k = new PublicKey(data.slice(at, at + 32));
      at += 32;
      return k;
    };

    const host = key();
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
    const rule = data[at] as Rule;
    at += 1;
    const awaitingRule = data[at] === 1;
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
      seats.push({ wallet, session, alive, answeredRound, hasAnswered });
    }

    const seatCount = data[at];
    at += 1;
    const bump = data[at++];
    const vaultBump = data[at++];
    const answersBump = data[at++];

    return {
      host,
      roomId,
      stake,
      roundSeconds,
      phase,
      round,
      roundEndsAt,
      rule,
      awaitingRule,
      seats: seats.slice(0, seatCount),
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

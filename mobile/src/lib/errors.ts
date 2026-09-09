/**
 * Turning chain errors into something a player can act on.
 *
 * "custom program error: 0x177b" is a correct and completely useless thing to
 * show someone mid-game. The numbers are Anchor's, counted from 6000 in the
 * order the error enum declares them, so they are derived here rather than
 * written down - a hand-copied table drifts the moment a variant is inserted.
 */

import idl from "../idl.json";

/**
 * The codes themselves come from the IDL, which is generated from the enum, so
 * inserting a variant cannot silently shift this table out from under the
 * messages below. (An offset counted by hand elsewhere in this project shifted
 * exactly that way and cost an afternoon.)
 */
const HERD_ERRORS: string[] = (idl.errors ?? []).map((e: { name: string }) => e.name);

/** The first code Anchor assigns. Everything above is this plus the index. */
const FIRST_CODE = (idl.errors ?? [])[0]?.code ?? 6000;

const PLAIN: Record<string, string> = {
  RoundClosed: "Too slow — that round closed before your answer landed.",
  AlreadyAnswered: "You've already answered this round.",
  Eliminated: "You're out of this game.",
  NotAPlayer: "You're not in this room.",
  RoundStillOpen: "The round hasn't finished yet.",
  RoomFull: "That room is full.",
  AlreadySeated: "You're already in this room.",
  TooFewPlayers: "A room needs at least three players.",
  RoomNotOpen: "That room has already started.",
  NotTheHost: "Only the host can do that.",
  AlreadySettled: "This pot has already been paid out.",
  EmptyAnswer: "Type something first.",
  AnswerTooLong: "That answer is too long.",
  RoomLayoutDrift: "This room looks wrong to the program. Open a fresh one.",
};

export function explainChainError(e: unknown): string | null {
  const raw = e instanceof Error ? e.message : String(e);

  // Anchor's custom errors arrive as hex in the simulation message.
  const custom = /custom program error: (0x[0-9a-f]+|\d+)/i.exec(raw);
  if (custom) {
    const value = custom[1].startsWith("0x") ? parseInt(custom[1], 16) : Number(custom[1]);
    const index = value - FIRST_CODE;
    if (index >= 0 && index < HERD_ERRORS.length) {
      const name = HERD_ERRORS[index];
      return PLAIN[name] ?? `The program refused that: ${name}.`;
    }
    // 0x1 from the System Program is the one everybody meets first.
    if (value === 1) {
      return "Not enough SOL to cover that. Devnet SOL is free — top the wallet up.";
    }
  }

  if (/insufficient (lamports|funds)/i.test(raw)) {
    return "Not enough SOL to cover that.";
  }

  return null;
}

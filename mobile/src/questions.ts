/**
 * The questions.
 *
 * They are not on chain, and they do not need to be: every player derives the
 * same question from the round number, so nobody can be shown a different one.
 * Putting them on chain would cost a write per round to say something every
 * client already knows.
 *
 * Writing them is the real craft of this game. A good question has an obvious
 * answer and a tempting wrong one - "name a fruit" clusters hard and somebody
 * always dies alone on "kiwi". A question with no obvious answer produces six
 * different words, nobody strays, and the round is flat.
 */
export const QUESTIONS = [
  "Name a fruit.",
  "An excuse for being late.",
  "Something you'd never eat cold.",
  "A reason to leave a party early.",
  "Name a colour.",
  "Something in every kitchen.",
  "A thing people lie about.",
  "Name an animal.",
  "Somewhere you'd never swim.",
  "A word you can't spell.",
  "Something you own too many of.",
  "A terrible name for a dog.",
];

export function questionFor(round: number): string {
  return QUESTIONS[(round - 1) % QUESTIONS.length];
}

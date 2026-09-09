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

/**
 * What the room is offered to tap.
 *
 * Typing a word on a phone inside thirty seconds is a race against the keyboard
 * rather than against the room, and the game is meant to be the second one. Six
 * options makes a round a decision instead of a typing test.
 *
 * Deliberately not the bots' table, even though the words overlap. That one is
 * weighted, and shipping it as a menu would put the bots' most likely answer at
 * the top of everybody's screen. These are in no meaningful order, so the only
 * thing to go on is what you think the room will do - which is the game.
 *
 * Straying still has to be possible, or the whole minority rule stops meaning
 * anything, so the box underneath takes any word you like.
 */
export const OPTIONS: Record<string, string[]> = {
  "Name a fruit.": ["banana", "apple", "mango", "orange", "grape", "peach"],
  "An excuse for being late.": ["train", "traffic", "alarm", "overslept", "weather", "parking"],
  "Something you'd never eat cold.": ["soup", "rice", "pizza", "eggs", "curry", "toast"],
  "A reason to leave a party early.": ["work", "tired", "headache", "boring", "babysitter", "early"],
  "Name a colour.": ["red", "blue", "green", "yellow", "black", "purple"],
  "Something in every kitchen.": ["kettle", "fridge", "sink", "oven", "spoon", "kitchen"],
  "A thing people lie about.": ["age", "weight", "money", "work", "height", "sleep"],
  "Name an animal.": ["cat", "dog", "lion", "horse", "elephant", "bear"],
  "Somewhere you'd never swim.": ["river", "pond", "sea", "lake", "canal", "pool"],
  "A word you can't spell.": ["rhythm", "necessary", "definitely", "queue", "bureaucracy", "weird"],
  "Something you own too many of.": ["cables", "socks", "mugs", "books", "bags", "pens"],
  "A terrible name for a dog.": ["kevin", "steve", "brian", "cat", "dave", "gary"],
};

/** Six words to tap for this round, or none if the question has no table. */
export function optionsFor(round: number): string[] {
  return OPTIONS[questionFor(round)] ?? [];
}

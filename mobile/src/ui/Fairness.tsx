/**
 * What "protected by MagicBlock" actually means, on one screen.
 *
 * A badge that says a game is fair is worth nothing - every game says that.
 * What is worth something is naming each way this one could be rigged and what
 * makes it impossible.
 *
 * It has to fit without scrolling, which is a constraint on the writing rather
 * than the layout: six promises that fit on a phone are six promises somebody
 * reads, and a paragraph each would have been six nobody does.
 */

import { Modal, Pressable, Text, View } from "react-native";

import { s } from "./styles";
import { Button } from "./Button";

type Tone = "Rollup" | "Random" | "Solana" | "Chain" | "Keys";

interface Guarantee {
  title: string;
  body: string;
  /** What keeps the promise, and the badge colour that groups it. */
  by: string;
  tone: Tone;
}

const GUARANTEES: Guarantee[] = [
  {
    title: "Nobody sees your answer",
    body: "Not the players, not the host, not us. Every answer unlocks at the same instant.",
    by: "Private rollup",
    tone: "Rollup",
  },
  {
    title: "Friends can't sit together",
    body: "Public rooms are dealt from a queue. You don't pick your table, so nobody can stack one.",
    by: "Verifiable randomness",
    tone: "Random",
  },
  {
    title: "The coin can't be rigged",
    body: "If the last two flip for the pot, nobody can predict the result or choose it.",
    by: "Verifiable randomness",
    tone: "Random",
  },
  {
    title: "Your stake never leaves Solana",
    body: "The rollup runs the game. It is never given control of the money.",
    by: "Solana",
    tone: "Solana",
  },
  {
    title: "You can always get it back",
    body: "Leave before a game starts and you're refunded. An abandoned game can be finished by anyone.",
    by: "On chain",
    tone: "Chain",
  },
  {
    title: "Playing costs no signature",
    body: "Approve once when you sit down. The key that answers can't touch your money.",
    by: "Session keys",
    tone: "Keys",
  },
];

export function Fairness({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={s.sheet}>
        <View>
          <Text style={s.sheetTitle}>Why this is fair</Text>
          <Text style={s.sheetLead}>
            Six ways a game like this is usually rigged — and what stops each one here.
          </Text>
        </View>

        <View style={s.guarantees}>
          {GUARANTEES.map((g) => (
            <View key={g.title} style={s.guarantee}>
              <View style={[s.badge, s[`badge${g.tone}`]]}>
                <Text style={[s.badgeText, s[`badge${g.tone}Text`]]}>
                  {g.by.toUpperCase()}
                </Text>
              </View>
              <View style={s.guaranteeHead}>
                <Text style={s.guaranteeTick}>✓</Text>
                <Text style={s.guaranteeTitle}>{g.title}</Text>
              </View>
              <Text style={s.guaranteeBody}>{g.body}</Text>
            </View>
          ))}
        </View>

        <Button label="Got it" onPress={onClose} />
      </View>
    </Modal>
  );
}

/** The line at the bottom of the lobby that opens the sheet. */
export function GuardBar({ onPress }: { onPress(): void }) {
  return (
    <Pressable
      style={({ pressed }) => [s.guardBar, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Protected by MagicBlock. See why this is fair."
    >
      <View style={s.guardDot} />
      <Text style={s.guardText}>Protected by MagicBlock</Text>
      <Text style={s.guardMore}>Why?</Text>
    </Pressable>
  );
}

/**
 * What "protected by MagicBlock" actually means, in a sheet.
 *
 * A badge that says a game is fair is worth nothing - every game says that.
 * What is worth something is naming each way this one could be rigged and what
 * makes it impossible, so a player can check the claim rather than take it.
 */

import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { s } from "./styles";
import { Button } from "./Button";

interface Guarantee {
  title: string;
  body: string;
  by: string;
}

const GUARANTEES: Guarantee[] = [
  {
    title: "Nobody can see your answer",
    body:
      "Not the other players, not whoever opened the room, not us. Answers are locked in an account that refuses everybody until the round ends - then all of them unlock at once.",
    by: "Private rollup",
  },
  {
    title: "Friends can't arrange to sit together",
    body:
      "In a public game you don't pick your room. You join a queue and the draw decides who sits where, so a group can't stack a table against strangers.",
    by: "Verifiable randomness",
  },
  {
    title: "The coin flip can't be rigged",
    body:
      "When the last two choose to flip rather than share, the result comes from the same draw - nobody can predict it, and nobody can pick it.",
    by: "Verifiable randomness",
  },
  {
    title: "Your stake never leaves Solana",
    body:
      "The pot sits in an account the rollup is never given control of. The game decides who won; it has no way to pay anybody.",
    by: "Solana",
  },
  {
    title: "You can always get your money back",
    body:
      "Leave before a game starts, or leave the queue, and your stake is returned. If everyone abandons a game, anyone can finish it so the pot pays out.",
    by: "On chain",
  },
  {
    title: "Playing doesn't cost a signature",
    body:
      "You approve once when you sit down. Answering is instant after that - no pop-up every round, and the key that answers can't touch your money.",
    by: "Session keys",
  },
];

export function Fairness({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={s.sheet}>
        <ScrollView contentContainerStyle={s.sheetScroll}>
          <Text style={s.sheetTitle}>Why this is fair</Text>
          <Text style={s.sheetLead}>
            Six ways a game like this is usually rigged, and what stops each one here.
          </Text>

          {GUARANTEES.map((g, i) => (
            <View
              key={g.title}
              style={[s.guarantee, i === GUARANTEES.length - 1 && s.guaranteeLast]}
            >
              <View style={s.guaranteeHead}>
                <Text style={s.guaranteeTick}>✓</Text>
                <Text style={s.guaranteeTitle}>{g.title}</Text>
              </View>
              <Text style={s.guaranteeBody}>{g.body}</Text>
              <Text style={s.guaranteeBy}>{g.by}</Text>
            </View>
          ))}

          <View style={{ marginTop: 18 }}>
            <Button label="Got it" onPress={onClose} />
          </View>
        </ScrollView>
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

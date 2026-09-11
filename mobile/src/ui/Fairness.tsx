/**
 * What "protected by MagicBlock" actually means, on one screen.
 *
 * A badge that says a game is fair is worth nothing - every game says that.
 * What is worth something is naming each way this one could be rigged and what
 * makes it impossible.
 *
 * It has to fit without scrolling, which is a constraint on the writing rather
 * than the layout: six promises that fit on a phone are six somebody reads,
 * where a paragraph each would have been six nobody does.
 */

import { Modal, Pressable, Text, View } from "react-native";

import { Button } from "./Button";

interface Guarantee {
  title: string;
  body: string;
  /** What keeps the promise, and the badge that groups it. */
  by: string;
  badge: string;
}

const GUARANTEES: Guarantee[] = [
  {
    title: "Nobody sees your answer",
    body: "Not the players, not the host, not us. Every answer unlocks at the same instant.",
    by: "Private rollup",
    badge: "bg-[#241d3d] text-[#b9a9ff]",
  },
  {
    title: "Friends can't sit together",
    body: "Public rooms are dealt from a queue. You don't pick your table, so nobody can stack one.",
    by: "Verifiable randomness",
    badge: "bg-[#2b2a12] text-lime",
  },
  {
    title: "The coin can't be rigged",
    body: "If the last two flip for the pot, nobody can predict the result or choose it.",
    by: "Verifiable randomness",
    badge: "bg-[#2b2a12] text-lime",
  },
  {
    title: "Your stake never leaves Solana",
    body: "The rollup runs the game. It is never given control of the money.",
    by: "Solana",
    badge: "bg-[#12291f] text-[#5fd39a]",
  },
  {
    title: "You can always get it back",
    body: "Leave before a game starts and you're refunded. An abandoned game can be finished by anyone.",
    by: "On chain",
    badge: "bg-[#13243a] text-[#7bb6f0]",
  },
  {
    title: "Playing costs no signature",
    body: "Approve once when you sit down. The key that answers can't touch your money.",
    by: "Session keys",
    badge: "bg-[#2f2113] text-[#e8a765]",
  },
];

export function Fairness({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-bg pt-14 px-5 pb-7 justify-between">
        <View>
          <Text className="text-ink text-[26px] font-extrabold -tracking-[0.8px] mb-1.5">
            Why this is fair
          </Text>
          <Text className="text-muted text-[13px] leading-[19px]">
            Six ways a game like this is usually rigged — and what stops each
            one here.
          </Text>
        </View>

        <View className="flex-1 justify-evenly py-1.5">
          {GUARANTEES.map((g) => (
            <View key={g.title} className="gap-1">
              <View
                className={`self-start px-2.5 py-1 rounded-md ${g.badge.split(" ")[0]}`}
              >
                <Text
                  className={`text-[9.5px] font-extrabold tracking-[0.8px] ${g.badge.split(" ")[1]}`}
                >
                  {g.by.toUpperCase()}
                </Text>
              </View>
              <View className="flex-row items-center gap-[7px]">
                <Text className="text-lime text-[13px] font-extrabold">✓</Text>
                <Text className="flex-1 text-ink text-[15px] font-bold -tracking-[0.2px]">
                  {g.title}
                </Text>
              </View>
              <Text className="text-muted text-[12.5px] leading-[17px]">
                {g.body}
              </Text>
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
      className="mt-6 flex-row items-center justify-center gap-2 py-3 rounded-field bg-surface border border-line active:opacity-70"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Protected by MagicBlock. See why this is fair."
    >
      <Text className="text-muted text-[12.5px] font-bold">
        Protected by MagicBlock
      </Text>
      <Text className="text-lime text-[12.5px] font-extrabold">Why?</Text>
    </Pressable>
  );
}

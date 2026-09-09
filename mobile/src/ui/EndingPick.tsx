/**
 * Choosing what happens if you make the final two.
 *
 * This has to be decided before the game rather than during it, and the reason
 * is the whole point: asked at the door, you are choosing whether you would
 * want to share a pot at all. Asked at the end, you would be choosing whether
 * to share one with a specific person you have just spent ten minutes with -
 * which is a different question, and a worse one.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ending, type RoomState } from "../lib/herd";
import { s } from "./styles";

export function EndingPick({
  value,
  onChange,
  disabled,
}: {
  value: Ending;
  onChange(next: Ending): void;
  disabled?: boolean;
}) {
  return (
    <View>
      <Text style={s.section}>IF IT COMES DOWN TO TWO</Text>
      <View style={s.pickRow}>
        <Option
          picked={value === Ending.Split}
          title="Split it"
          blurb="You both walk away with half."
          onPress={() => onChange(Ending.Split)}
          disabled={disabled}
        />
        <Option
          picked={value === Ending.Coin}
          title="Coin flip"
          blurb="One of you takes all of it."
          onPress={() => onChange(Ending.Coin)}
          disabled={disabled}
        />
      </View>
      <Text style={s.note}>
        Everyone at the table gets a vote and the majority wins. If it's a tie, you split.
      </Text>
    </View>
  );
}

function Option({
  picked,
  title,
  blurb,
  onPress,
  disabled,
}: {
  picked: boolean;
  title: string;
  blurb: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.pick,
        picked && s.pickOn,
        pressed && s.btnPressed,
        disabled && s.btnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: picked }}
    >
      <Text style={[s.pickTitle, picked && s.pickTitleOn]}>{title}</Text>
      <Text style={s.pickBlurb}>{blurb}</Text>
    </Pressable>
  );
}

/**
 * Where the table's vote stands.
 *
 * Shown while the door is still open, because a vote you cannot see the state
 * of is not really a vote - somebody about to take the last seat should be able
 * to tell whether they are the one who decides it.
 */
export function EndingTally({ room }: { room: RoomState }) {
  const coins = room.seats.filter((seat) => seat.endingVote === Ending.Coin).length;
  const splits = room.seats.length - coins;
  const winning = coins > splits ? "a coin flip" : "a split";

  return (
    <View style={[s.card, { marginTop: 14 }]}>
      <Text style={s.note}>THE VOTE SO FAR</Text>
      <Text style={s.body}>
        <Text style={s.leadStrong}>{winning}</Text>
        {coins === splits
          ? ` — the room is split ${coins}–${splits}, and a tie means you share.`
          : ` — ${Math.max(coins, splits)} of ${room.seats.length} want it that way.`}
      </Text>
    </View>
  );
}

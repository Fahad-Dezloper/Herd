/**
 * Choosing what happens if you make the final two.
 *
 * Decided before the game rather than during it, and the reason is the whole
 * point: asked at the door, you are choosing whether you would want to share a
 * pot at all. Asked at the end, you would be choosing whether to share one with
 * a specific person you have just spent ten minutes with - a different
 * question, and a worse one.
 */

import { Pressable, Text, View } from "react-native";

import { Ending, type RoomState } from "../lib/herd";

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
      <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase mb-2">
        If it comes down to two
      </Text>
      <View className="flex-row gap-2.5 mb-2">
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
      <Text className="text-faint text-note">
        Everyone at the table gets a vote and the majority wins. A tie means you split.
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
      className={`flex-1 p-3.5 gap-1 rounded-2xl border active:opacity-80 ${
        picked ? "border-lime bg-lime-dim" : "border-line bg-surface"
      } ${disabled ? "opacity-50" : ""}`}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: picked }}
    >
      <Text className={`text-[15px] font-extrabold ${picked ? "text-lime" : "text-muted"}`}>
        {title}
      </Text>
      <Text className="text-faint text-note">{blurb}</Text>
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
    <View className="bg-surface border border-line rounded-card p-4 gap-1.5">
      <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase">
        The vote so far
      </Text>
      <Text className="text-muted text-body">
        <Text className="text-ink font-bold">{winning}</Text>
        {coins === splits
          ? ` — the room is split ${coins}–${splits}, and a tie means you share.`
          : ` — ${Math.max(coins, splits)} of ${room.seats.length} want it that way.`}
      </Text>
    </View>
  );
}

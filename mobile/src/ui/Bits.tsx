/**
 * The small pieces every screen shares: the wordmark, a player, the pips that
 * count out a game, and the table drawn as a table.
 *
 * They live together because they are the things that have to look identical
 * everywhere. A player drawn one way in the waiting room and another in the
 * reveal reads as two different people.
 */

import { Text, View } from "react-native";

import { colors, tint } from "./styles";

export function Wordmark({ small }: { small?: boolean }) {
  return (
    <Text
      className={
        small
          ? "text-lime text-[26px] font-black italic -tracking-[1px]"
          : "text-lime text-[62px] leading-[68px] font-black italic -tracking-[2.5px]"
      }
    >
      HERD
    </Text>
  );
}

/**
 * A player.
 *
 * The ring is their colour and does the identifying - at thirty pixels a name
 * does not fit but a colour does, so the same person is the same ring in the
 * waiting room, the answer groups and the final table. Dimmed when they are
 * out, which is the one state worth seeing across a whole screen at once.
 */
export function Avatar({
  who,
  name,
  size = 36,
  out,
  you,
  showName,
}: {
  who: string;
  name?: string;
  size?: number;
  out?: boolean;
  you?: boolean;
  showName?: boolean;
}) {
  const ring = tint(who);
  const face = (
    <View
      className={`items-center justify-center bg-surface2 ${out ? "opacity-40" : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: you ? 2.5 : 2,
        borderColor: you ? colors.lime : ring,
      }}
    >
      <Text
        className="font-extrabold"
        style={{ fontSize: size * 0.4, color: out ? colors.faint : ring }}
      >
        {initial(name ?? who)}
      </Text>
    </View>
  );

  if (!showName) return face;
  return (
    <View className="items-center gap-1">
      {face}
      <Text
        className={`text-[10.5px] font-semibold ${out ? "text-faint" : "text-muted"}`}
        numberOfLines={1}
      >
        {name ?? ""}
      </Text>
    </View>
  );
}

/** First letter that is actually a letter - "0xTeo" should not show a zero. */
export function initial(name: string): string {
  const letter = name.split("").find((c) => /[a-z]/i.test(c));
  return (letter ?? name[0] ?? "?").toUpperCase();
}

/**
 * How far through a game you are.
 *
 * A room can run twelve rounds but almost never does, so the pips show the
 * rounds played plus a couple ahead - a fixed row of twelve would spend the
 * whole game looking nearly empty.
 */
export function Pips({ round, total }: { round: number; total: number }) {
  const count = Math.max(round, Math.min(total, round + 2));
  return (
    <View className="flex-row items-center gap-[5px]">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          className={`h-2 rounded-full ${
            i === round - 1 ? "w-[18px] bg-lime" : i < round - 1 ? "w-2 bg-lime" : "w-2 bg-line"
          }`}
        />
      ))}
    </View>
  );
}

/**
 * The table, drawn as a table.
 *
 * Players sit around a circle with the count in the middle, because that is
 * what a room of people is - a list of six rows is a spreadsheet. Positions
 * come from seat order, so nobody moves seats between polls.
 */
export function Ring({
  seats,
  you,
  nameOf,
  size = 250,
  children,
}: {
  seats: { key: string; alive: boolean }[];
  you?: string;
  nameOf?: (key: string) => string;
  size?: number;
  children: React.ReactNode;
}) {
  const face = 46;
  const radius = size / 2 - face / 2 - 6;

  return (
    <View className="items-center justify-center self-center" style={{ width: size, height: size }}>
      <View className="absolute items-center gap-0.5">{children}</View>
      {seats.map((seat, i) => {
        // Start at the top and go round, so the first seat is always noon.
        const angle = (i / Math.max(1, seats.length)) * Math.PI * 2 - Math.PI / 2;
        const name = seat.key === you ? "you" : nameOf?.(seat.key);
        return (
          <View
            key={seat.key}
            className="absolute items-center"
            style={{
              left: size / 2 + Math.cos(angle) * radius - face / 2,
              top: size / 2 + Math.sin(angle) * radius - face / 2,
              width: face,
            }}
          >
            <Avatar
              who={seat.key}
              name={name}
              size={face}
              out={!seat.alive}
              you={seat.key === you}
            />
            <Text className="text-muted text-[10.5px] font-semibold mt-1" numberOfLines={1}>
              {name ?? ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

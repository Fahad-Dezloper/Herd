/**
 * The small pieces every screen shares: the wordmark, a player, the pips that
 * count out a game.
 *
 * They live together because they are the things that have to look identical
 * everywhere. A player drawn one way in the waiting room and another in the
 * reveal reads as two different people.
 */

import { Text, View } from "react-native";

import { colors, s, tint } from "./styles";

export function Wordmark({ small }: { small?: boolean }) {
  return <Text style={small ? s.wordmarkSm : s.wordmark}>HERD</Text>;
}

/**
 * A player.
 *
 * The ring is their colour and does the identifying - at 30px a name does not
 * fit but a colour does, so the same person is the same ring in the waiting
 * room, the answer groups and the final table. Dimmed when they are out, which
 * is the one state worth seeing across a whole screen at once.
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
      style={[
        s.av,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.surface2,
          borderColor: you ? colors.lime : ring,
          borderWidth: you ? 2.5 : 2,
        },
        out && { opacity: 0.4 },
      ]}
    >
      <Text style={[s.avText, { fontSize: size * 0.4, color: out ? colors.faint : ring }]}>
        {initial(name ?? who)}
      </Text>
    </View>
  );

  if (!showName) return face;
  return (
    <View style={s.avStack}>
      {face}
      <Text style={[s.avName, out && { color: colors.faint }]} numberOfLines={1}>
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
 * rounds played plus the one being played - a fixed row of twelve would spend
 * the whole game looking nearly empty.
 */
export function Pips({ round, total }: { round: number; total: number }) {
  const count = Math.max(round, Math.min(total, round + 2));
  return (
    <View style={s.pips}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[s.pip, i < round - 1 && s.pipOn, i === round - 1 && s.pipNow]}
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
 * come from the seat order, so somebody does not move seats between polls.
 */
export function Ring({
  seats,
  you,
  nameOf,
  size = 250,
  children,
}: {
  seats: { key: string; alive: boolean; done?: boolean }[];
  you?: string;
  nameOf?: (key: string) => string;
  size?: number;
  children: React.ReactNode;
}) {
  const face = 46;
  const radius = size / 2 - face / 2 - 6;

  return (
    <View style={[s.ring, { width: size, height: size }]}>
      <View style={s.ringCore}>{children}</View>
      {seats.map((seat, i) => {
        // Start at the top and go round, so the first seat is always noon.
        const angle = (i / Math.max(1, seats.length)) * Math.PI * 2 - Math.PI / 2;
        return (
          <View
            key={seat.key}
            style={{
              position: "absolute",
              left: size / 2 + Math.cos(angle) * radius - face / 2,
              top: size / 2 + Math.sin(angle) * radius - face / 2,
              alignItems: "center",
              width: face,
            }}
          >
            <Avatar
              who={seat.key}
              name={seat.key === you ? "you" : nameOf?.(seat.key)}
              size={face}
              out={!seat.alive}
              you={seat.key === you}
            />
            <Text style={[s.avName, { marginTop: 4 }]} numberOfLines={1}>
              {seat.key === you ? "you" : (nameOf?.(seat.key) ?? "")}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

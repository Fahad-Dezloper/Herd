/**
 * What everyone said, and what the coin flip did with it.
 *
 * The words are only secret while the window is open. Once a round is scored
 * the reason to hide them is gone, and this is the part people actually play
 * for - so the program publishes them and this screen groups them up.
 *
 * The rule never changes - the fewest people on a word strayed, and they go -
 * so what this screen has to say is whether that happened. It cannot always:
 * when every group is the same size nobody is the odd one, and a round like
 * that has to say so rather than looking like one that failed.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Outcome, type RoomState } from "../lib/herd";
import { colors, s, shortKey, tint } from "./styles";
import { Button } from "./Button";
import { initial } from "./Seats";

interface Group {
  word: string;
  members: { key: string; alive: boolean; isYou: boolean; name: string }[];
}

export function Reveal({
  room,
  question,
  you,
  nameOf,
  onNext,
}: {
  room: RoomState;
  question: string;
  you?: string;
  nameOf?: (key: string) => string;
  onNext(): void;
}) {
  const [left, setLeft] = useState(7);

  // The next round is already running behind this screen, so it cannot block.
  useEffect(() => {
    const id = setInterval(() => setLeft((n) => (n <= 1 ? (onNext(), 0) : n - 1)), 1000);
    return () => clearInterval(id);
  }, [onNext]);

  // Only seats that answered the resolved round took part. Anyone already out
  // has no word, so an empty one means they were not in this round at all.
  const groups: Group[] = [];
  room.seats.forEach((seat, i) => {
    const word = room.lastWords[i];
    if (!word) return;
    const key = seat.wallet.toBase58();
    const member = {
      key,
      alive: seat.alive,
      isYou: key === you,
      name: key === you ? "you" : (nameOf?.(key) ?? shortKey(key)),
    };
    const existing = groups.find((g) => g.word === word);
    if (existing) existing.members.push(member);
    else groups.push({ word, members: [member] });
  });
  groups.sort((a, b) => b.members.length - a.members.length);

  const tied = room.outcome === Outcome.Tied;
  const youSurvived = room.seats.some((x) => x.wallet.toBase58() === you && x.alive);

  return (
    <>
      <Text style={[s.body, { marginBottom: 12 }]}>{question}</Text>

      <View style={[s.card, s.cardGold, { marginBottom: 14 }]}>
        <Text style={s.ruleLine}>
          {tied ? "Nobody was the odd one" : "The smallest group strayed"}
        </Text>
        <Text style={s.note}>
          {tied
            ? "Every group was the same size, so there was no odd one out. Everybody plays the next question."
            : "The fewest people on a word are the ones who strayed from the herd, and they go together."}
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        {groups.map((group) => {
          const culled = group.members.every((m) => !m.alive);
          return (
            <View
              key={group.word}
              style={[s.card, culled ? s.cardBad : s.cardGood, { gap: 9 }]}
            >
              <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                <Text
                  style={[
                    s.groupWord,
                    culled && { color: colors.bad, textDecorationLine: "line-through" },
                  ]}
                >
                  {group.word}
                </Text>
                <Text style={[s.note, { marginLeft: "auto" }]}>
                  {culled
                    ? "strayed"
                    : `${group.members.length} together`}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {group.members.map((m) => (
                  <View
                    key={m.key}
                    style={[
                      s.av,
                      { backgroundColor: tint(m.key) },
                      !m.alive && { opacity: 0.45 },
                      m.isYou && { borderWidth: 2, borderColor: colors.goldInk },
                    ]}
                  >
                    <Text style={s.avText}>{initial(m.name)}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>

      <View style={[s.card, youSurvived ? s.cardGood : s.cardBad, { marginTop: 14 }]}>
        <Text style={s.big}>{youSurvived ? "Still with the herd" : "You strayed"}</Text>
        <Text style={s.body}>
          {room.seats.filter((x) => x.alive).length} left
          {youSurvived ? "" : ", playing for the pot without you"}.
        </Text>
      </View>

      <View style={{ marginTop: 16 }}>
        <Button label={`Carry on (${left})`} onPress={onNext} />
      </View>
    </>
  );
}

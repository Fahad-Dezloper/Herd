/**
 * What everyone said, and what the coin flip did with it.
 *
 * The words are only secret while the window is open. Once a round is scored
 * the reason to hide them is gone, and this is the part people actually play
 * for - so the program publishes them and this screen groups them up.
 *
 * The rule matters as much as the words. It was not knowable when anyone
 * answered: it comes from VRF after every word was locked, which is what makes
 * a cartel a gamble rather than a strategy.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Outcome, type RoomState } from "../lib/herd";
import { s, shortKey, tint } from "./styles";
import { Button } from "./Button";

interface Group {
  word: string;
  members: { key: string; alive: boolean; isYou: boolean }[];
}

export function Reveal({
  room,
  question,
  you,
  onNext,
}: {
  room: RoomState;
  question: string;
  you?: string;
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
    const member = { key, alive: seat.alive, isYou: key === you };
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
                    culled && { color: "#f87171", textDecorationLine: "line-through" },
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
                      m.isYou && { borderWidth: 2, borderColor: "#ffcf3d" },
                    ]}
                  >
                    <Text style={s.avText}>{m.isYou ? "Y" : m.key[0].toUpperCase()}</Text>
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

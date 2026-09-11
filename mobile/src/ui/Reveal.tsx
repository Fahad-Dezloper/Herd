/**
 * What everyone said, and what it cost them.
 *
 * The words are only secret while the window is open. Once a round is scored
 * the reason to hide them is gone, and this is the part people actually play
 * for - so the program publishes them and this screen groups them up.
 *
 * The rule never changes - the fewest people on a word strayed, and they go -
 * so what this has to say is whether that happened. It cannot always: when
 * every group is the same size nobody is the odd one, and a round like that has
 * to say so rather than looking like one that failed.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Outcome, type RoomState } from "../lib/herd";
import { Avatar } from "./Bits";
import { shortKey } from "./styles";
import { Button } from "./Button";

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
  const gone = groups.filter((g) => g.members.every((m) => !m.alive));

  return (
    <>
      <Text className="text-ink text-[25px] font-extrabold -tracking-[0.6px] text-center">
        Here are the answers!
      </Text>
      <Text className="text-faint text-note text-center mt-1 mb-4">{question}</Text>

      <View className="gap-2.5">
        {groups.map((group) => {
          const culled = group.members.every((m) => !m.alive);
          return (
            <View
              key={group.word}
              className={`rounded-card p-4 gap-2.5 border ${
                culled ? "bg-bad-dim border-bad-line" : "bg-[#1b2411] border-lime-dim"
              }`}
            >
              <Text
                className={`self-start rounded-lg px-2.5 py-1 text-micro font-extrabold tracking-widest overflow-hidden ${
                  culled ? "bg-bad text-[#1c0d08]" : "bg-lime text-lime-ink"
                }`}
              >
                {culled ? "ODD ONE OUT" : "THE HERD"}
              </Text>
              <View className="flex-row items-baseline">
                <Text
                  className={`text-[19px] font-extrabold -tracking-[0.3px] ${
                    culled ? "text-bad line-through" : "text-ink"
                  }`}
                >
                  {group.word}
                </Text>
                <Text className="text-faint text-note ml-auto">
                  {culled ? "strayed" : `${group.members.length} together`}
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2.5">
                {group.members.map((m) => (
                  <Avatar
                    key={m.key}
                    who={m.key}
                    name={m.name}
                    size={34}
                    out={!m.alive}
                    you={m.isYou}
                    showName
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>

      {gone.length > 0 && (
        <View className="bg-surface border border-line rounded-card p-4 mt-3.5">
          <Text className="text-muted text-body">
            <Text className="text-ink font-bold">
              {gone.flatMap((g) => g.members.map((m) => m.name)).join(", ")}
            </Text>
            {gone.flatMap((g) => g.members).length === 1 ? " has been" : " have been"} eliminated.
          </Text>
        </View>
      )}

      {tied && (
        <View className="bg-surface border border-line rounded-card p-4 mt-3.5 gap-1.5">
          <Text className="text-lime text-base font-extrabold">Nobody was the odd one</Text>
          <Text className="text-faint text-note">
            Every group was the same size, so nobody strayed. Everybody plays the next question.
          </Text>
        </View>
      )}

      <View
        className={`rounded-card p-4 mt-3.5 border ${
          youSurvived ? "bg-[#1b2411] border-lime-dim" : "bg-bad-dim border-bad-line"
        }`}
      >
        <Text className="text-ink text-2xl font-extrabold -tracking-[0.5px]">
          {youSurvived ? "Still with the herd" : "You strayed"}
        </Text>
        <Text className="text-muted text-body mt-1">
          {room.seats.filter((x) => x.alive).length} left
          {youSurvived ? "" : ", playing for the pot without you"}.
        </Text>
      </View>

      <View className="mt-4">
        <Button label={`Next round  →  (${left})`} onPress={onNext} />
      </View>
    </>
  );
}

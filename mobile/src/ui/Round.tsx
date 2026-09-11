/** A live round: the question, the clock, and one answer. */

import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { Avatar, Pips } from "./Bits";
import { Seats } from "./Seats";
import { colors } from "./styles";
import { Button } from "./Button";

export function Round({
  room,
  question,
  options,
  pot,
  answer,
  sealed,
  alive,
  busy,
  onChange,
  onSubmit,
  onLeave,
  nameOf,
  you,
}: {
  room: RoomState;
  question: string;
  /** Words to tap for this round. Tapping one fills the box, it does not send. */
  options: string[];
  pot: number;
  answer: string;
  sealed: string | null;
  alive: boolean;
  busy: boolean;
  onChange(v: string): void;
  onSubmit(): void;
  /** Stop watching and go start another game. */
  onLeave(): void;
  nameOf?: (key: string) => string;
  you?: string;
}) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const tick = () =>
      setLeft(Math.max(0, Number(room.roundEndsAt) - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [room.roundEndsAt]);

  const low = left <= 5;
  const clock = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

  return (
    <>
      <View className="flex-row items-center gap-2.5 mb-3.5">
        <Text className="text-muted text-note font-bold bg-surface border border-line rounded-full px-3 py-1 overflow-hidden">
          Round {room.round}
        </Text>
        <Pips round={room.round} total={12} />
        <Text className="text-lime text-[13px] font-extrabold ml-auto">
          {(pot / 1e9).toFixed(2)} ◎
        </Text>
      </View>

      {/* The clock is a pill, not a bar - it reads from across a room. */}
      <View
        className={`self-center flex-row items-center gap-2 bg-surface rounded-full px-[18px] py-2.5 mb-4 border-[1.5px] ${
          low ? "border-bad-line" : "border-lime-dim"
        }`}
      >
        <Text className="text-[15px]">⏱</Text>
        <Text
          className={`text-[21px] font-extrabold tracking-wide tabular-nums ${
            low ? "text-bad" : "text-lime"
          }`}
        >
          {clock}
        </Text>
      </View>

      {/* The question is the one piece of paper in a dark room. */}
      <View className="bg-paper rounded-paper py-[30px] px-6 mb-4 rotate-[-0.6deg]">
        <Text className="text-paper-ink text-[27px] leading-[33px] font-extrabold -tracking-[0.6px] text-center">
          {question}
        </Text>
      </View>

      {!alive ? (
        <View className="gap-3">
          <View className="bg-bad-dim border border-bad-line rounded-card p-4 gap-2">
            <Text className="text-bad-ink text-sm font-extrabold">You're out</Text>
            <Text className="text-bad-ink text-[13px] leading-[19px]">
              Watching the rest play for the pot. Your stake is already in it.
            </Text>
          </View>
          {/* Being out is not a reason to be stuck. Nothing here waits on you. */}
          <Button ghost label="Leave and start another" onPress={onLeave} disabled={busy} />
        </View>
      ) : sealed ? (
        <View className="bg-[#1b2411] border border-lime-dim rounded-card p-4 items-center gap-2">
          <Text className="text-lime text-[26px] font-extrabold">{sealed}</Text>
          <Text className="text-faint text-note text-center">
            Locked in. Nobody can read it — not even the host.
          </Text>
        </View>
      ) : room.awaitingCoin || left <= 0 ? (
        <View className="bg-surface border border-line rounded-card p-4">
          <Text className="text-muted text-body">
            {room.awaitingCoin
              ? "Two of you left. Flipping for it…"
              : "Time's up. Scoring the round…"}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {options.length > 0 && (
            <View className="flex-row flex-wrap gap-2">
              {options.map((word) => {
                const picked = answer.trim().toLowerCase() === word;
                return (
                  <Pressable
                    key={word}
                    className={`rounded-full px-4 py-2.5 border active:opacity-80 ${
                      picked ? "border-lime bg-lime-dim" : "border-line bg-surface"
                    }`}
                    onPress={() => onChange(picked ? "" : word)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: picked }}
                  >
                    <Text
                      className={`text-[15px] font-semibold ${picked ? "text-lime" : "text-ink"}`}
                    >
                      {word}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <TextInput
            className="bg-surface2 border border-line rounded-field px-4 py-3.5 text-ink text-xl font-bold"
            placeholder="or type your own"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            value={answer}
            onChangeText={onChange}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
          />
          <Button label="LOCK IN  →" onPress={onSubmit} disabled={busy || !answer.trim()} />
          <Text className="text-faint text-note text-center">
            Once you lock in, you can't change it.
          </Text>
        </View>
      )}

      <View className="mt-5 gap-2.5">
        <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase">
          The room
        </Text>
        <View className="flex-row flex-wrap gap-3">
          {room.seats.map((seat) => {
            const key = seat.wallet.toBase58();
            return (
              <Avatar
                key={key}
                who={key}
                name={key === you ? "you" : nameOf?.(key)}
                size={42}
                out={!seat.alive}
                you={key === you}
                showName
              />
            );
          })}
        </View>
        <Seats room={room} you={you} nameOf={nameOf} />
      </View>
    </>
  );
}

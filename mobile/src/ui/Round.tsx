/** A live round: the question, the clock, and one answer. */

import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { Avatar, Pips } from "./Bits";
import { Seats } from "./Seats";
import { colors, s } from "./styles";
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
      <View style={s.roundBar}>
        <Text style={s.chip}>Round {room.round}</Text>
        <Pips round={room.round} total={12} />
        <Text style={s.pot}>{(pot / 1e9).toFixed(2)} ◎</Text>
      </View>

      <View style={[s.clock, low && s.clockLow]}>
        <Text style={{ fontSize: 15 }}>⏱</Text>
        <Text style={[s.clockText, low && s.clockTextLow]}>{clock}</Text>
      </View>

      {/* The question is the one piece of paper in a dark room. */}
      <View style={s.paperCard}>
        <Text style={s.question}>{question}</Text>
      </View>

      {!alive ? (
        <View style={{ gap: 11 }}>
          <View style={[s.card, s.cardBad]}>
            <Text style={s.errTitle}>You're out</Text>
            <Text style={s.err}>
              Watching the rest play for the pot. Your stake is already in it.
            </Text>
          </View>
          {/* Being out is not a reason to be stuck. Nothing here is waiting on
              you - the survivors finish the game and the winner collects it. */}
          <Button ghost label="Leave and start another" onPress={onLeave} disabled={busy} />
        </View>
      ) : sealed ? (
        <View style={[s.card, s.cardGood, s.sealed]}>
          <Text style={s.sealedWord}>{sealed}</Text>
          <Text style={s.note}>Locked in. Nobody can read it — not even the host.</Text>
        </View>
      ) : room.awaitingCoin || left <= 0 ? (
        <View style={s.card}>
          <Text style={s.body}>
            {room.awaitingCoin
              ? "Two of you left. Flipping for it…"
              : "Time's up. Scoring the round…"}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 11 }}>
          {options.length > 0 && (
            <View style={s.optRow}>
              {options.map((word) => {
                const picked = answer.trim().toLowerCase() === word;
                return (
                  <Pressable
                    key={word}
                    style={({ pressed }) => [
                      s.opt,
                      picked && s.optOn,
                      pressed && s.btnPressed,
                    ]}
                    onPress={() => onChange(picked ? "" : word)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: picked }}
                  >
                    <Text style={[s.optText, picked && s.optTextOn]}>{word}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <TextInput
            style={[s.input, s.inputBig]}
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
          <Text style={[s.note, { textAlign: "center" }]}>
            Once you lock in, you can't change it.
          </Text>
        </View>
      )}

      {/* Who is at the table, and who has already gone. */}
      <View style={{ marginTop: 20, gap: 10 }}>
        <Text style={s.section}>THE ROOM</Text>
        <PlayerRow room={room} you={you} nameOf={nameOf} />
        <Seats room={room} you={you} nameOf={nameOf} />
      </View>
    </>
  );
}

/** Faces in a row, the way the reference shows a table at a glance. */
function PlayerRow({
  room,
  you,
  nameOf,
}: {
  room: RoomState;
  you?: string;
  nameOf?: (key: string) => string;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
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
  );
}

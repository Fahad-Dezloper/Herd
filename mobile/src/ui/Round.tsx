/** A live round: the question, the clock, and one answer. */

import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { Seats } from "./Seats";
import { s } from "./styles";
import { Button } from "./Button";

export function Round({
  room,
  question,
  pot,
  answer,
  sealed,
  alive,
  busy,
  onChange,
  onSubmit,
  onLeave,
}: {
  room: RoomState;
  question: string;
  pot: number;
  answer: string;
  sealed: string | null;
  alive: boolean;
  busy: boolean;
  onChange(v: string): void;
  onSubmit(): void;
  /** Stop watching and go start another game. */
  onLeave(): void;
}) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const tick = () =>
      setLeft(Math.max(0, Number(room.roundEndsAt) - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [room.roundEndsAt]);

  const fraction = Math.min(1, left / Math.max(1, room.roundSeconds));
  const low = left <= 5;

  return (
    <>
      <View style={s.roundBar}>
        <Text style={s.chip}>Round {room.round}</Text>
        <Text style={s.chip}>{room.seats.filter((x) => x.alive).length} left</Text>
        <Text style={s.pot}>{(pot / 1e9).toFixed(3)} SOL</Text>
      </View>

      <View style={s.timerTrack}>
        <View style={[s.timerFill, low && s.timerLow, { width: `${fraction * 100}%` }]} />
      </View>

      <Text style={s.question}>{question}</Text>

      {!alive ? (
        <View style={{ gap: 11 }}>
          <View style={[s.card, s.cardBad]}>
            <Text style={s.errTitle}>You're out</Text>
            <Text style={s.err}>
              Watching the rest play for the pot. Your stake is already in it.
            </Text>
          </View>
          {/* Being out is not a reason to be stuck. Nothing here is waiting on
              you - the survivors finish the game and the winner collects it -
              so leaving costs nothing and starting another game is the more
              likely thing to want. */}
          <Button ghost label="Leave and start another" onPress={onLeave} disabled={busy} />
        </View>
      ) : sealed ? (
        <View style={[s.card, s.cardGold, s.sealed]}>
          <Text style={s.sealedWord}>{sealed}</Text>
          <Text style={s.note}>
            Sealed. Nobody can read it — not the other players, not the host, not us.
          </Text>
        </View>
      ) : room.awaitingRule || left <= 0 ? (
        <View style={s.card}>
          <Text style={s.body}>
            {room.awaitingRule
              ? "Round closed. Drawing the rule…"
              : "Time's up. Closing the round…"}
          </Text>
          <Text style={s.note}>
            {sealed
              ? "Your answer is in."
              : "No answer from you this round — silence counts as straying."}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 11 }}>
          <TextInput
            style={[s.input, s.inputBig]}
            placeholder="type your answer"
            placeholderTextColor="#5f6b7c"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            value={answer}
            onChangeText={onChange}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
          />
          <Button label="Lock it in" onPress={onSubmit} disabled={busy || !answer.trim()} />
          <Text style={s.note}>No signature needed — your session key handles this one.</Text>
        </View>
      )}

      <Text style={s.section}>THE ROOM</Text>
      <Seats room={room} />
    </>
  );
}

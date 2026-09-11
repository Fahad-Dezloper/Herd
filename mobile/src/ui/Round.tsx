/** A live round: the question, the clock, and one answer. */

import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { RoomState } from "../lib/herd";
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
      ) : room.awaitingCoin || left <= 0 ? (
        <View style={s.card}>
          <Text style={s.body}>
            {room.awaitingCoin
              ? "Two of you left. Flipping for it…"
              : "Time's up. Scoring the round…"}
          </Text>
          <Text style={s.note}>
            {sealed
              ? "Your answer is in."
              : "No answer from you this round — silence counts as straying."}
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
          <Button label="Lock it in" onPress={onSubmit} disabled={busy || !answer.trim()} />
          <Text style={s.note}>
            Tap one or write your own. The fewest people on a word are the ones who go, so the
            question is not what is right — it is what everybody else will pick.
          </Text>
        </View>
      )}

      <Text style={s.section}>THE ROOM</Text>
      <Seats room={room} nameOf={nameOf} />
    </>
  );
}

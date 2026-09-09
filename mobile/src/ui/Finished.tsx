/**
 * The end of a game.
 *
 * A result screen that only announces the result is a dead end - you are told
 * you lost, and the room you spent ten minutes in disappears. So this shows the
 * things you would want to know at the table: what the pot was and who has it,
 * what everyone said with their last word, how far you got, and how to start
 * another one.
 */

import { Text, View } from "react-native";

import { Ending, type RoomState } from "../lib/herd";
import { s, shortKey, tint } from "./styles";
import { Button } from "./Button";

export function Finished({
  room,
  pot,
  you,
  youWon,
  settled,
  busy,
  onSettle,
  onAgain,
}: {
  room: RoomState;
  pot: number;
  you?: string;
  youWon: boolean;
  settled: boolean;
  busy: boolean;
  onSettle(): void;
  onAgain(): void;
}) {
  const survivors = room.seats.filter((seat) => seat.alive);
  const share = survivors.length ? pot / survivors.length : 0;
  const coin = room.coinDecided;

  return (
    <>
      <View style={[s.card, youWon ? s.cardGood : s.cardBad]}>
        <Text style={s.big}>
          {youWon
            ? coin
              ? "The coin fell your way"
              : survivors.length === 1
                ? "Last one standing"
                : "You made it to the end"
            : coin
              ? "You made the last two, and the coin didn't"
              : "The herd moved on without you"}
        </Text>
        <Text style={s.body}>
          {coin
            ? `Down to two after ${room.round} rounds, and the table had voted to flip for it.`
            : survivors.length === 1
              ? `One player left after ${room.round} rounds.`
              : `${survivors.length} left after ${room.round} rounds.`}
        </Text>
      </View>

      {/* The money, and where it went. The thing everybody scrolls to. */}
      <View style={[s.card, s.cardGold, { marginTop: 14 }]}>
        <Text style={s.note}>THE POT</Text>
        <Text style={s.potBig}>{(pot / 1e9).toFixed(3)} SOL</Text>
        <Text style={s.body}>
          {survivors.length === 1
            ? youWon
              ? "All of it is yours."
              : `All of it went to ${shortKey(survivors[0].wallet.toBase58())}.`
            : `Split ${survivors.length} ways — ${(share / 1e9).toFixed(3)} SOL each.`}
        </Text>
        <Text style={s.note}>
          {settled
            ? "Paid out on Solana. The rollup ran the game and never held the money."
            : "Waiting to be paid out on Solana."}
        </Text>
      </View>

      {/* Why it ended the way it did. Without this, losing the last two to a
          coin looks like the game simply stopped working. */}
      {coin && (
        <View style={[s.card, { marginTop: 14 }]}>
          <Text style={s.note}>HOW IT ENDED</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
            {survivors.map((seat) => {
              const key = seat.wallet.toBase58();
              const isYou = key === you;
              return (
                <View key={key} style={[s.av, { backgroundColor: tint(key) }]}>
                  <Text style={s.avText}>{isYou ? "Y" : key[0].toUpperCase()}</Text>
                </View>
              );
            })}
            <Text style={s.seatName}>
              the coin chose {youWon ? "you" : shortKey(survivors[0]?.wallet.toBase58() ?? "")}
            </Text>
          </View>
          <Text style={s.note}>
            No round can separate two players — same word is one group, different words are two
            groups of one, and either way nobody strays. This table voted to flip for it instead of
            sharing.
          </Text>
        </View>
      )}

      <LastWords room={room} you={you} />

      <View style={{ marginTop: 18, gap: 10 }}>
        {!settled && <Button label="Pay out the pot" onPress={onSettle} disabled={busy} />}
        <Button
          ghost={!settled}
          label="Play another"
          onPress={onAgain}
          disabled={busy}
        />
      </View>
    </>
  );
}

/**
 * The last thing everyone said.
 *
 * The final round is the one people argue about afterwards, and it is already
 * on chain - the program publishes each round's words once scoring them can no
 * longer be influenced by reading them.
 */
function LastWords({ room, you }: { room: RoomState; you?: string }) {
  const said = room.seats
    .map((seat, i) => ({ seat, word: room.lastWords[i] }))
    .filter((x) => x.word);

  if (!said.length) return null;

  return (
    <>
      <Text style={s.section}>THE LAST WORD</Text>
      <View style={{ gap: 8 }}>
        {said.map(({ seat, word }) => {
          const key = seat.wallet.toBase58();
          const isYou = key === you;
          return (
            <View key={key} style={[s.seatRow, !seat.alive && s.seatOut]}>
              <View style={[s.av, { backgroundColor: tint(key) }]}>
                <Text style={s.avText}>{isYou ? "Y" : key[0].toUpperCase()}</Text>
              </View>
              <Text style={s.seatName}>{isYou ? "you" : shortKey(key)}</Text>
              <Text style={[s.lastWord, !seat.alive && s.seatStatusOut]}>{word}</Text>
            </View>
          );
        })}
      </View>
    </>
  );
}

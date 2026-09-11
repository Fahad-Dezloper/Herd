/**
 * The end of a game.
 *
 * A result screen that only announces the result is a dead end - you are told
 * you lost, and the room you spent ten minutes in disappears. So this shows
 * what you would want to know at the table: what the pot was and who has it,
 * what everyone said with their last word, and how to start another one.
 */

import { Text, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { Avatar } from "./Bits";
import { shortKey } from "./styles";
import { Button } from "./Button";

export function Finished({
  room,
  pot,
  you,
  nameOf,
  youWon,
  settled,
  busy,
  onSettle,
  onAgain,
}: {
  room: RoomState;
  pot: number;
  you?: string;
  nameOf?: (key: string) => string;
  youWon: boolean;
  settled: boolean;
  busy: boolean;
  onSettle(): void;
  onAgain(): void;
}) {
  const survivors = room.seats.filter((seat) => seat.alive);
  const share = survivors.length ? pot / survivors.length : 0;
  // Losing the final two to a coin is a different feeling from being
  // out-guessed, and the screen should not make you wonder which happened.
  const coin = room.coinDecided;
  const champion = survivors[0];
  const championName = champion
    ? champion.wallet.toBase58() === you
      ? "you"
      : (nameOf?.(champion.wallet.toBase58()) ?? shortKey(champion.wallet.toBase58()))
    : "";

  return (
    <>
      <View
        className={`rounded-card p-4 items-center gap-2.5 border ${
          youWon ? "bg-[#1b2411] border-lime-dim" : "bg-bad-dim border-bad-line"
        }`}
      >
        <Text className="text-[40px]">{youWon ? "👑" : "🐑"}</Text>
        <Text
          className={
            youWon
              ? "text-lime text-3xl font-black italic -tracking-[1px] text-center"
              : "text-ink text-2xl font-extrabold -tracking-[0.5px] text-center"
          }
        >
          {youWon
            ? survivors.length === 1
              ? "HERD CHAMPION"
              : "YOU MADE IT"
            : coin
              ? "The coin didn't fall your way"
              : "The herd moved on"}
        </Text>

        {champion && (
          <Avatar
            who={champion.wallet.toBase58()}
            name={championName}
            size={76}
            you={champion.wallet.toBase58() === you}
          />
        )}

        <View className="bg-lime rounded-full px-6 py-2">
          <Text className="text-lime-ink text-[17px] font-extrabold">
            {survivors.length === 1 ? championName : `${survivors.length} survivors`}
          </Text>
        </View>

        <Text className="text-muted text-body text-center">
          {coin
            ? `Down to two after ${room.round} rounds, and the table had voted to flip.`
            : survivors.length === 1
              ? `Last one standing after ${room.round} rounds.`
              : `${survivors.length} left after ${room.round} rounds.`}
        </Text>
      </View>

      {/* The money, and where it went. The thing everybody looks for. */}
      <View className="bg-[#1b2411] border border-lime-dim rounded-card p-4 mt-3.5 items-center gap-1.5">
        <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase">
          {settled ? "Paid out" : "The pot"}
        </Text>
        <Text className="text-ink text-[40px] font-black -tracking-[1.5px]">
          ◎ {(pot / 1e9).toFixed(2)}
        </Text>
        <Text className="text-muted text-body text-center">
          {survivors.length === 1
            ? youWon
              ? "All of it is yours."
              : `All of it went to ${championName}.`
            : `Split ${survivors.length} ways — ◎ ${(share / 1e9).toFixed(2)} each.`}
        </Text>
        <Text className="text-faint text-note text-center">
          {settled
            ? "Paid on Solana. The rollup ran the game and never held the money."
            : "Waiting to be paid out on Solana."}
        </Text>
      </View>

      {!settled && youWon && (
        <Text className="text-faint text-note mt-3.5">
          Your session key sends it, so there is no fingerprint and nothing to approve. Nobody else
          has to be here, and the pot keeps until you claim it.
        </Text>
      )}
      {!settled && !youWon && (
        <Text className="text-faint text-note mt-3.5">
          Nothing for you to do here — claiming is the winner's, and the vault holds the pot on
          Solana until they do.
        </Text>
      )}

      <LastWords room={room} you={you} nameOf={nameOf} />

      <View className="mt-5 gap-2.5">
        {!settled && youWon && (
          <Button
            label={`CLAIM ◎ ${(share / 1e9).toFixed(2)}`}
            onPress={onSettle}
            disabled={busy}
          />
        )}
        <Button
          ghost={!settled && youWon}
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
 * on chain - the program publishes each round's words once reading them can no
 * longer change the scoring.
 */
function LastWords({
  room,
  you,
  nameOf,
}: {
  room: RoomState;
  you?: string;
  nameOf?: (key: string) => string;
}) {
  const said = room.seats
    .map((seat, i) => ({ seat, word: room.lastWords[i] }))
    .filter((x) => x.word);

  if (!said.length) return null;

  return (
    <View className="mt-5 gap-2.5">
      <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase">
        The last word
      </Text>
      <View className="gap-2">
        {said.map(({ seat, word }) => {
          const key = seat.wallet.toBase58();
          const isYou = key === you;
          const name = isYou ? "you" : (nameOf?.(key) ?? shortKey(key));
          return (
            <View
              key={key}
              className={`flex-row items-center gap-3 py-2 px-3 bg-surface border border-line rounded-field ${
                !seat.alive ? "opacity-40" : ""
              }`}
            >
              <Avatar who={key} name={name} size={30} out={!seat.alive} you={isYou} />
              <Text className="flex-1 text-ink text-sm font-semibold">{name}</Text>
              <Text
                className={`text-sm font-bold ml-auto ${!seat.alive ? "text-bad" : "text-ink"}`}
              >
                {word}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

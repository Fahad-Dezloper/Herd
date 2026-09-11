/**
 * The other players, and how far they've got.
 *
 * This list is the reason the game state and the answers live in separate
 * accounts. You can see that someone has locked an answer in - which is most of
 * the tension in a thirty-second round - and you cannot see what it was.
 */

import { Text, View } from "react-native";

import type { RoomState, Seat } from "../lib/herd";
import { Avatar } from "./Bits";
import { shortKey } from "./styles";

export function answered(seat: Seat, round: number): boolean {
  return seat.hasAnswered && seat.answeredRound === round;
}

export function Seats({
  room,
  you,
  nameOf,
}: {
  room: RoomState;
  you?: string;
  /** What to call a wallet. Bots have names; strangers have keys. */
  nameOf?: (key: string) => string;
}) {
  return (
    <View className="gap-2">
      {room.seats.map((seat) => {
        const key = seat.wallet.toBase58();
        const done = answered(seat, room.round);
        const isYou = key === you;
        const name = isYou ? "you" : (nameOf?.(key) ?? shortKey(key));
        return (
          <View
            key={key}
            className={`flex-row items-center gap-3 py-2 px-3 bg-surface border rounded-field ${
              !seat.alive ? "opacity-40 border-line" : done ? "border-lime-dim" : "border-line"
            }`}
          >
            <Avatar who={key} name={name} size={30} out={!seat.alive} you={isYou} />
            <Text className="flex-1 text-ink text-sm font-semibold">{name}</Text>
            <Text
              className={`text-note font-semibold ${
                !seat.alive ? "text-bad" : done ? "text-lime" : "text-faint"
              }`}
            >
              {!seat.alive ? "out" : done ? "locked in" : "thinking…"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

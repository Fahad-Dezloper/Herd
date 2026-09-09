/**
 * The other players, and how far they've got.
 *
 * This list is the reason the game state and the answers live in separate
 * accounts. You can see that someone has locked an answer in - which is most of
 * the tension in a fifteen-second round - and you cannot see what it was.
 */

import { Text, View } from "react-native";

import type { RoomState, Seat } from "../lib/herd";
import { s, shortKey, tint } from "./styles";

export function answered(seat: Seat, round: number): boolean {
  return seat.hasAnswered && seat.answeredRound === round;
}

export function Seats({ room, you }: { room: RoomState; you?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {room.seats.map((seat) => {
        const key = seat.wallet.toBase58();
        const done = answered(seat, room.round);
        const isYou = key === you;
        return (
          <View
            key={key}
            style={[s.seatRow, done && seat.alive && s.seatDone, !seat.alive && s.seatOut]}
          >
            <View style={[s.av, { backgroundColor: tint(key) }]}>
              <Text style={s.avText}>{isYou ? "Y" : key[0].toUpperCase()}</Text>
            </View>
            <Text style={s.seatName}>{isYou ? "you" : shortKey(key)}</Text>
            <Text
              style={[
                s.seatStatus,
                !seat.alive && s.seatStatusOut,
                seat.alive && done && s.seatStatusDone,
              ]}
            >
              {!seat.alive ? "out" : done ? "answer sealed" : "thinking…"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

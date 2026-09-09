/** The room before it starts: who is in, what it is worth, and the code. */

import { Text, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { Seats } from "./Seats";
import { s } from "./styles";
import { Button } from "../../App";

export function Waiting({
  room,
  code,
  pot,
  isHost,
  busy,
  onStart,
}: {
  room: RoomState;
  code: string;
  pot: number;
  isHost: boolean;
  busy: boolean;
  onStart(): void;
}) {
  const enough = room.seats.length >= 3;

  return (
    <>
      <View style={s.card}>
        <View style={s.roundBar}>
          <Text style={s.chip}>{room.seats.length} seated</Text>
          <Text style={s.pot}>{(pot / 1e9).toFixed(3)} SOL</Text>
        </View>
        <Text style={s.note}>Share this so people can take a seat</Text>
        <Text style={s.mono} selectable>
          {code}
        </Text>
      </View>

      <Text style={s.section}>IN THE ROOM</Text>
      <Seats room={room} />

      {isHost ? (
        <View style={{ marginTop: 18, gap: 10 }}>
          <Button label="Start the game" onPress={onStart} disabled={busy || !enough} />
          {!enough && (
            <Text style={s.note}>
              Three is the smallest game there is. With two, every round is two groups of one -
              which culls everybody or nobody.
            </Text>
          )}
        </View>
      ) : (
        <Text style={[s.note, { marginTop: 18 }]}>Waiting for the host to start.</Text>
      )}
    </>
  );
}

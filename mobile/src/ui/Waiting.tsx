/** The room before it starts: who is in, what it is worth, and the code. */

import { Text, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { EndingTally } from "./EndingPick";
import { Seats } from "./Seats";
import { s } from "./styles";
import { Button } from "./Button";

export function Waiting({
  room,
  code,
  pot,
  isHost,
  busy,
  unseatedBots,
  onAddBots,
  onStart,
  onLeave,
}: {
  room: RoomState;
  code: string;
  pot: number;
  isHost: boolean;
  busy: boolean;
  /** Funded but not yet seated. */
  unseatedBots: number;
  onAddBots(): void;
  onStart(): void;
  /** Take the seat back and the stake with it. */
  onLeave(): void;
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

      <EndingTally room={room} />

      {isHost ? (
        <View style={{ marginTop: 18, gap: 10 }}>
          {unseatedBots > 0 && (
            <>
              <Button
                ghost
                label={`Seat ${unseatedBots} bots`}
                onPress={onAddBots}
                disabled={busy}
              />
              <Text style={s.note}>
                Real seats with real stakes, signing for themselves — the program cannot tell them
                from anyone else. They see no more than you do: the answers are sealed to them too.
              </Text>
            </>
          )}
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

      {/* Nothing has happened yet, so nothing is owed - the stake comes back
          whole. Once the room locks it is in play and this goes away. */}
      <View style={{ marginTop: 12 }}>
        <Button ghost label="Leave and take my stake back" onPress={onLeave} disabled={busy} />
      </View>
    </>
  );
}

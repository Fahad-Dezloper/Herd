/** The room before it starts: who is in, what it is worth, and the code. */

import { Text, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { Ring } from "./Bits";
import { EndingTally } from "./EndingPick";
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
  nameOf,
  you,
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
  nameOf?: (key: string) => string;
  you?: string;
}) {
  const enough = room.seats.length >= 3;
  const seats = room.seats.map((seat) => ({
    key: seat.wallet.toBase58(),
    alive: seat.alive,
  }));

  return (
    <>
      <Text style={[s.h1, { textAlign: "center" }]}>Finding your herd…</Text>
      <Text style={[s.note, { textAlign: "center", marginTop: 4, marginBottom: 20 }]}>
        {enough ? "Ready when you are." : "A game needs three people."}
      </Text>

      {/* A room of people, drawn as a room of people. A list of rows is a
          spreadsheet; this is a table you are sitting at. */}
      <Ring seats={seats} you={you} nameOf={nameOf}>
        <Text style={s.ringCount}>{room.seats.length}</Text>
        <Text style={s.ringLabel}>
          {room.seats.length === 1 ? "player joined" : "players joined"}
        </Text>
      </Ring>

      <View style={[s.split, { marginTop: 24 }]}>
        <View style={s.splitCell}>
          <Text style={s.splitLabel}>Entry fee</Text>
          <Text style={s.splitValue}>{(Number(room.stake) / 1e9).toFixed(2)} ◎</Text>
        </View>
        <View style={[s.splitCell, s.splitDivide]}>
          <Text style={s.splitLabel}>Current pot</Text>
          <Text style={s.splitValue}>{(pot / 1e9).toFixed(2)} ◎</Text>
        </View>
      </View>

      <View style={{ marginTop: 16, gap: 9 }}>
        <Text style={s.section}>SHARE THIS TO FILL THE ROOM</Text>
        <View style={s.card}>
          <Text style={s.mono} selectable>
            {code}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 14 }}>
        <EndingTally room={room} />
      </View>

      {isHost ? (
        <View style={{ marginTop: 16, gap: 10 }}>
          {unseatedBots > 0 && (
            <Button
              ghost
              label={`Seat ${unseatedBots} players`}
              onPress={onAddBots}
              disabled={busy}
            />
          )}
          <Button label="START  →" onPress={onStart} disabled={busy || !enough} />
          {!enough && (
            <Text style={[s.note, { textAlign: "center" }]}>
              Three is the smallest game there is.
            </Text>
          )}
        </View>
      ) : (
        <Text style={[s.note, { marginTop: 18, textAlign: "center" }]}>
          Waiting for the host to start.
        </Text>
      )}

      {/* Nothing has happened yet, so nothing is owed - the stake comes back
          whole. Once the room locks this goes away. */}
      <View style={{ marginTop: 12 }}>
        <Button ghost label="Leave and take my stake back" onPress={onLeave} disabled={busy} />
      </View>
    </>
  );
}

/** The room before it starts: who is in, what it is worth, and the code. */

import { Text, View } from "react-native";

import type { RoomState } from "../lib/herd";
import { Ring } from "./Bits";
import { EndingTally } from "./EndingPick";
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
      <Text className="text-ink text-[25px] font-extrabold -tracking-[0.6px] text-center">
        Finding your herd…
      </Text>
      <Text className="text-faint text-note text-center mt-1 mb-5">
        {enough ? "Ready when you are." : "A game needs three people."}
      </Text>

      {/* A room of people, drawn as a room of people. A list of rows is a
          spreadsheet; this is a table you are sitting at. */}
      <Ring seats={seats} you={you} nameOf={nameOf}>
        <Text className="text-ink text-[32px] font-black -tracking-[1px]">
          {room.seats.length}
        </Text>
        <Text className="text-muted text-xs font-semibold">
          {room.seats.length === 1 ? "player joined" : "players joined"}
        </Text>
      </Ring>

      <View className="flex-row bg-surface border border-line rounded-2xl overflow-hidden mt-6">
        <View className="flex-1 p-3.5 gap-[3px]">
          <Text className="text-faint text-[11px] font-semibold">Entry fee</Text>
          <Text className="text-ink text-[19px] font-extrabold -tracking-[0.5px]">
            {(Number(room.stake) / 1e9).toFixed(2)} ◎
          </Text>
        </View>
        <View className="flex-1 p-3.5 gap-[3px] border-l border-line">
          <Text className="text-faint text-[11px] font-semibold">Current pot</Text>
          <Text className="text-ink text-[19px] font-extrabold -tracking-[0.5px]">
            {(pot / 1e9).toFixed(2)} ◎
          </Text>
        </View>
      </View>

      <View className="mt-4 gap-2">
        <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase">
          Share this to fill the room
        </Text>
        <View className="bg-surface border border-line rounded-card p-4">
          <Text className="text-ink font-mono text-[11.5px]" selectable>
            {code}
          </Text>
        </View>
      </View>

      <View className="mt-3.5">
        <EndingTally room={room} />
      </View>

      {isHost ? (
        <View className="mt-4 gap-2.5">
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
            <Text className="text-faint text-note text-center">
              Three is the smallest game there is.
            </Text>
          )}
        </View>
      ) : (
        <Text className="text-faint text-note text-center mt-4">
          Waiting for the host to start.
        </Text>
      )}

      {/* Nothing has happened yet, so nothing is owed - the stake comes back
          whole. Once the room locks this goes away. */}
      <View className="mt-3">
        <Button ghost label="Leave and take my stake back" onPress={onLeave} disabled={busy} />
      </View>
    </>
  );
}

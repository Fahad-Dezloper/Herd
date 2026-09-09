/** The room before it starts: who is in, what it is worth, and the code. */

import { Text, View } from "react-native";

import { Ending, type RoomState } from "../lib/herd";
import { Seats } from "./Seats";
import { s } from "./styles";
import { Button } from "../../App";

export function Waiting({
  room,
  code,
  pot,
  isHost,
  busy,
  unseatedBots,
  onAddBots,
  onStart,
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
    </>
  );
}

/**
 * Where the table's vote stands.
 *
 * Shown while the door is still open, because a vote you cannot see the state
 * of is not really a vote - somebody about to take the last seat should be able
 * to tell whether they are the one who decides it.
 */
function EndingTally({ room }: { room: RoomState }) {
  const coins = room.seats.filter((seat) => seat.endingVote === Ending.Coin).length;
  const splits = room.seats.length - coins;
  const winning = coins > splits ? "a coin flip" : "a split";

  return (
    <View style={[s.card, { marginTop: 14 }]}>
      <Text style={s.note}>IF IT COMES DOWN TO TWO</Text>
      <Text style={s.body}>
        <Text style={s.leadStrong}>{winning}</Text>
        {coins === splits
          ? ` — the room is split ${coins}–${splits}, and a tie means you share.`
          : ` — ${Math.max(coins, splits)} of ${room.seats.length} want it that way.`}
      </Text>
    </View>
  );
}

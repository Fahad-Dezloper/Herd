/**
 * What the coin flip did.
 *
 * The rule is the whole point of this screen. It was not knowable when anyone
 * answered - it comes from VRF after every word is locked - which is what makes
 * a cartel a gamble rather than a strategy.
 */

import { Text, View } from "react-native";

import { Rule, type RoomState } from "../lib/herd";
import { Seats } from "./Seats";
import { s } from "./styles";
import { Button } from "../../App";

export function Reveal({
  room,
  question,
  youAlive,
  onNext,
}: {
  room: RoomState;
  question: string;
  youAlive: boolean;
  onNext(): void;
}) {
  const minority = room.rule === Rule.MinoritySurvives;
  const left = room.seats.filter((x) => x.alive).length;

  return (
    <>
      <Text style={[s.body, { marginBottom: 14 }]}>{question}</Text>

      <View style={[s.card, s.cardGold]}>
        <Text style={s.note}>The rule for that round, drawn after every answer was sealed</Text>
        <Text style={s.ruleLine}>
          {minority ? "Minority survives — the biggest groups went" : "Majority survives — the smallest groups went"}
        </Text>
      </View>

      <View style={[s.card, youAlive ? s.cardGood : s.cardBad, { marginTop: 12 }]}>
        <Text style={s.big}>{youAlive ? "Still with the herd" : "You strayed"}</Text>
        <Text style={s.body}>
          {left} left{youAlive ? "" : ", playing for the pot without you"}.
        </Text>
      </View>

      <Text style={s.section}>THE ROOM</Text>
      <Seats room={room} />

      <View style={{ marginTop: 18 }}>
        <Button label={left <= 1 ? "See who took it" : "Next round"} onPress={onNext} />
      </View>
    </>
  );
}

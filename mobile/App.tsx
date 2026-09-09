import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from "react-native";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import {
  BASE_RPC,
  TEE_VALIDATOR,
  accountData,
  authenticate,
  delegationOf,
  lamportsOf,
  latestBlockhash,
  sendLocal,
  sleep,
  submit,
} from "./src/lib/chain";
import { Herd, Phase, Rule, type RoomState } from "./src/lib/herd";
import { connectWallet, explainWalletError, signTransaction, type Wallet } from "./src/lib/mwa";
import { sessionFor } from "./src/lib/session";
import { botAnswer, botDelay, botsFor, type Bot } from "./src/bots";
import { questionFor } from "./src/questions";
import { answered } from "./src/ui/Seats";
import { Reveal } from "./src/ui/Reveal";
import { Round } from "./src/ui/Round";
import { Waiting } from "./src/ui/Waiting";
import { s } from "./src/ui/styles";
import idl from "./src/idl.json";

const herd = new Herd(idl);

const STAKE = 10_000_000n; // 0.01 SOL
const ROUND_SECONDS = 15;

/**
 * What the session key gets at the door.
 *
 * It pays for everything after the first signature: delegation rent, closing
 * each round, handing the room back, settling the pot, and funding bots. Enough
 * that a game never stops to ask for a fingerprint, small enough to be nobody's
 * problem if the key is lost.
 */
const SESSION_FUEL = 40_000_000n; // 0.04 SOL

/** Stake plus enough for a bot to pay its own transaction fees. */
const BOT_FUEL = 12_000_000n; // 0.012 SOL

/** Roughly what opening a game costs, before anyone joins. */
const HOST_COST = (bots: number) =>
  STAKE + SESSION_FUEL + BOT_FUEL * BigInt(bots) + 25_000_000n; // + account rent

type Screen = "connect" | "lobby" | "waiting" | "playing" | "reveal" | "finished";

/** How many bots a solo host gets. Six players is a game; three is barely one. */
const BOT_SEATS = 5;

interface RoomRef {
  host: PublicKey;
  roomId: bigint;
}

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [screen, setScreen] = useState<Screen>("connect");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ref, setRef] = useState<RoomRef | null>(null);
  const [session, setSession] = useState<Keypair | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [endpoint, setEndpoint] = useState<{ url: string; token?: string }>({ url: BASE_RPC });
  const [pot, setPot] = useState(0);

  const [bots, setBots] = useState<Bot[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [answer, setAnswer] = useState("");
  const [sealedWord, setSealedWord] = useState<string | null>(null);

  // The round the UI has already shown a reveal for, so it fires once.
  const shown = useRef(0);
  const closing = useRef(false);
  // The round the bots have already been sent into, so they answer once.
  const botted = useRef(0);

  /* ------------------------------------------------------------- polling */

  const refresh = useCallback(async () => {
    if (!ref) return;
    try {
      const key = herd.room(ref.host, ref.roomId);
      const data = await accountData(endpoint.url, key, endpoint.token);
      if (!data) return;
      const next = herd.decodeRoom(data);
      setRoom(next);
      setPot(await lamportsOf(BASE_RPC, herd.vault(key)));
    } catch {
      // A poll that misses is not worth surfacing; the next one is a second away.
    }
  }, [ref, endpoint]);

  useEffect(() => {
    if (!ref) return;
    refresh();
    const id = setInterval(refresh, 1200);
    return () => clearInterval(id);
  }, [ref, refresh]);

  /* ------------------------------------------------- react to game state */

  useEffect(() => {
    if (!room) return;

    if (room.phase === Phase.Open) {
      setScreen("waiting");
      return;
    }

    // A round is over when its result has been published, whether the game
    // continues or ends there. Watching `rule` would not work: it is drawn and
    // the next round starts in the same instruction, so a client polling a
    // second later sees only the aftermath.
    const resolved = room.lastRound > 0 && room.lastRound !== shown.current;
    if (resolved) {
      shown.current = room.lastRound;
      setSealedWord(null);
      setScreen("reveal");
      return;
    }

    if (screen === "reveal") return;
    if (room.phase === Phase.Finished || room.phase === Phase.Settled) setScreen("finished");
    else setScreen("playing");
  }, [room]);

  // Close the round when the clock runs out. Anyone may do it, so the app does
  // rather than waiting for someone else to notice.
  useEffect(() => {
    if (!room || !wallet || room.phase !== Phase.Playing || room.awaitingRule) return;
    const left = Number(room.roundEndsAt) - Math.floor(Date.now() / 1000);
    if (left > 0 || closing.current || !session) return;

    closing.current = true;
    (async () => {
      try {
        await sendLocal(
          endpoint.url,
          [session],
          [herd.closeRound(ref!.host, ref!.roomId, session.publicKey, room.round)],
          endpoint.token,
        );
      } catch {
        // Someone else got there first, which is fine - that is the point of
        // letting anyone close a round.
      } finally {
        setTimeout(() => (closing.current = false), 4000);
      }
    })();
  }, [room, session, endpoint]);

  // Bots answer on their own, once per round, spread across the window so the
  // room fills up the way it would with people in it.
  useEffect(() => {
    if (!room || !ref || room.phase !== Phase.Playing || room.awaitingRule) return;
    if (bots.length === 0 || botted.current === room.round) return;
    botted.current = room.round;

    const question = questionFor(room.round);
    const live = bots.filter((bot) =>
      room.seats.some(
        (seat) => seat.alive && seat.session.toBase58() === bot.keypair.publicKey.toBase58(),
      ),
    );

    live.forEach((bot) => {
      setTimeout(async () => {
        try {
          await sendLocal(
            endpoint.url,
            [bot.keypair],
            [
              herd.submitAnswer(
                ref.host,
                ref.roomId,
                bot.keypair.publicKey,
                botAnswer(question),
              ),
            ],
            endpoint.token,
          );
        } catch {
          // A bot that misses the window is culled for it, exactly like a person
          // who did not answer. Nothing to recover.
        }
      }, botDelay(room.roundSeconds));
    });
  }, [room, bots, endpoint, ref]);

  /* ------------------------------------------------------------- actions */

  const run = async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(explainWalletError(e));
    } finally {
      setBusy(null);
    }
  };

  /** Wallet signs, we submit. The wallet never chooses the network. */
  const sendAsWallet = async (instructions: any[]) => {
    if (!wallet) throw new Error("connect a wallet first");
    const tx = new Transaction({
      feePayer: new PublicKey(wallet.address),
      recentBlockhash: await latestBlockhash(BASE_RPC),
    });
    instructions.forEach((i) => tx.add(i));
    const signed = await signTransaction(wallet.authToken, tx, setWallet);
    return submit(BASE_RPC, signed);
  };

  const onConnect = () =>
    run("Connecting", async () => {
      setWallet(await connectWallet());
      setScreen("lobby");
    });

  /**
   * The only signature the host gives all game.
   *
   * Opening the room, taking a seat and fuelling the session key go in one
   * transaction, because they are one decision: I am starting a game and paying
   * to be in it. Everything after this - locking, delegating, sealing, closing
   * rounds, settling - is signed on the phone by the session key, which cannot
   * move money.
   */
  const onCreate = () =>
    run("Opening a room", async () => {
      const host = new PublicKey(wallet!.address);

      // Say what is wrong before the wallet does. A chain runs out of money with
      // "custom program error: 0x1" attributed to whichever instruction happened
      // to be short, which tells you nothing about what to do.
      const have = BigInt(await lamportsOf(BASE_RPC, host));
      const need = HOST_COST(BOT_SEATS);
      if (have < need) {
        throw new Error(
          `Opening a game costs about ${(Number(need) / 1e9).toFixed(2)} SOL on devnet — ` +
            `your stake, the bots' stakes, and rent for the accounts. ` +
            `This wallet has ${(Number(have) / 1e9).toFixed(3)}.`,
        );
      }

      const roomId = BigInt(Date.now() % 1_000_000);
      const key = herd.room(host, roomId);
      const mine = await sessionFor(key.toBase58());
      const crew = await botsFor(key.toBase58(), BOT_SEATS);
      setSession(mine);
      setBots(crew);

      // Everything the game will need, in the one transaction the host signs.
      // The bots are funded here rather than later so seating them costs no
      // further approval - and so a shortfall surfaces now, at the door, rather
      // than three taps into setting a game up.
      await sendAsWallet([
        herd.createRoom(host, roomId, STAKE, ROUND_SECONDS, mine.publicKey),
        herd.joinRoom(host, roomId, host, mine.publicKey),
        SystemProgram.transfer({
          fromPubkey: host,
          toPubkey: mine.publicKey,
          lamports: Number(SESSION_FUEL),
        }),
        ...crew.map((bot) =>
          SystemProgram.transfer({
            fromPubkey: host,
            toPubkey: bot.keypair.publicKey,
            lamports: Number(BOT_FUEL),
          }),
        ),
      ]);

      setRef({ host, roomId });
      setScreen("waiting");
    });

  const onJoin = () =>
    run("Taking a seat", async () => {
      const [hostText, idText] = joinCode.trim().split(":");
      const host = new PublicKey(hostText);
      const roomId = BigInt(idText);
      const key = herd.room(host, roomId);

      const mine = await sessionFor(key.toBase58());
      setSession(mine);
      await sendAsWallet([
        herd.joinRoom(host, roomId, new PublicKey(wallet!.address), mine.publicKey),
      ]);

      setRef({ host, roomId });
      setScreen("waiting");
    });

  /**
   * Seat some bots.
   *
   * One wallet signature funds them all; after that each one takes its own seat
   * and pays its own stake, signing for itself. The program has no idea they are
   * bots, which is the only way this proves anything.
   */
  const onAddBots = (count: number) =>
    run(`Seating ${count} players`, async () => {
      const { host, roomId } = ref!;
      const key = herd.room(host, roomId);
      const crew = await botsFor(key.toBase58(), count);

      // Already funded when the room opened, so this needs no wallet at all.
      for (const bot of crew) {
        const taken = room?.seats.some(
          (seat) => seat.wallet.toBase58() === bot.keypair.publicKey.toBase58(),
        );
        if (taken) continue;
        // The bot is its own session key: it only ever answers.
        await sendLocal(
          BASE_RPC,
          [bot.keypair],
          [herd.joinRoom(host, roomId, bot.keypair.publicKey, bot.keypair.publicKey)],
        );
        await sleep(600);
      }

      setBots(crew);
      await refresh();
    });

  /**
   * Lock, delegate, seal - and no fingerprint for any of it.
   *
   * Three transactions rather than one because each has to land before the next
   * makes sense: delegation reassigns the room's owner, and sealing happens
   * inside the rollup it has just arrived in.
   */
  const onStart = () =>
    run("Locking the room", async () => {
      const { host, roomId } = ref!;
      await sendLocal(BASE_RPC, [session!], [herd.lockRoom(host, roomId, session!.publicKey)]);
      await sleep(2500);

      setBusy("Handing it to the rollup");
      await sendLocal(
        BASE_RPC,
        [session!],
        [herd.delegateRoom(host, roomId, session!.publicKey, TEE_VALIDATOR)],
      );
      await sleep(4000);

      setBusy("Sealing the answers");
      const key = herd.room(host, roomId);
      const status = await delegationOf(key);
      if (!status.fqdn) throw new Error("the room did not reach a rollup");

      const url = status.fqdn.replace(/\/$/, "");
      const token = await authenticate(url, session!);
      setEndpoint({ url, token });

      // No wallet: sealing needs no signature, and a rollup transaction cannot
      // be shown to one anyway - it carries the rollup's own blockhash, which no
      // wallet can place on a Solana cluster.
      await sendLocal(url, [session!], [herd.sealRoom(host, roomId)], token);
      setScreen("playing");
    });

  /** The one that must never need a fingerprint. */
  const onAnswer = () =>
    run("Sealing", async () => {
      const word = answer.trim();
      if (!word) return;
      await sendLocal(
        endpoint.url,
        [session!],
        [herd.submitAnswer(ref!.host, ref!.roomId, session!.publicKey, word)],
        endpoint.token,
      );
      setSealedWord(word);
      setAnswer("");
    });

  const onSettle = () =>
    run("Paying out", async () => {
      const { host, roomId } = ref!;
      if (room!.phase === Phase.Finished) {
        try {
          await sendLocal(
            endpoint.url,
            [session!],
            [herd.finishRoom(host, roomId, session!.publicKey)],
            endpoint.token,
          );
          await sleep(14000);
        } catch {
          // Already handed back by another player.
        }
      }
      setEndpoint({ url: BASE_RPC });

      const data = await accountData(BASE_RPC, herd.room(host, roomId));
      const onBase = herd.decodeRoom(data!);
      // Settling is not a money decision for whoever calls it: it pays the
      // survivors and nobody else, whoever asks. So the session key does it and
      // the winner is not asked to sign for their own winnings.
      const winners = onBase.seats.filter((x) => x.alive).map((x) => x.wallet);
      await sendLocal(
        BASE_RPC,
        [session!],
        [herd.settle(host, roomId, session!.publicKey, winners)],
      );
      await refresh();
    });

  /* ---------------------------------------------------------------- view */

  const mySeat = room?.seats.find((x) => x.session.toBase58() === session?.publicKey.toBase58());

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0b0e13" />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <View style={s.mark} />
          <View>
            <Text style={s.title}>Herd</Text>
            <Text style={s.tagline}>say what everyone else says</Text>
          </View>
        </View>

        {error && (
          <View style={[s.card, s.cardBad, { marginBottom: 14 }]}>
            <Text style={s.errTitle}>Didn't work</Text>
            <Text style={s.err}>{error}</Text>
          </View>
        )}

        {busy && (
          <View style={[s.card, { marginBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }]}>
            <ActivityIndicator color="#ffcf3d" />
            <Text style={s.body}>{busy}…</Text>
          </View>
        )}

        {screen === "connect" && (
          <View style={s.card}>
            <Text style={s.lead}>
              Everyone answers the same question <Text style={s.leadStrong}>at the same time</Text>,
              in secret.
            </Text>
            <Text style={s.lead}>Stray from the herd and you're out.</Text>
            <Button label="Connect wallet" onPress={onConnect} disabled={!!busy} />
          </View>
        )}

        {screen === "lobby" && (
          <>
            <Text style={s.section}>START A GAME</Text>
            <View style={s.card}>
              <Text style={s.body}>
                Open a room and share the code. Everyone stakes 0.01 SOL; the last one standing
                takes the lot.
              </Text>
              <Button label="Open a room" onPress={onCreate} disabled={!!busy} />
            </View>

            <Text style={s.section}>OR JOIN ONE</Text>
            <View style={s.card}>
              <TextInput
                style={s.input}
                placeholder="paste a room code"
                placeholderTextColor="#5f6b7c"
                autoCapitalize="none"
                autoCorrect={false}
                value={joinCode}
                onChangeText={setJoinCode}
              />
              <Button ghost label="Take a seat" onPress={onJoin} disabled={!!busy || !joinCode} />
            </View>
          </>
        )}

        {screen === "waiting" && room && ref && (
          <Waiting
            room={room}
            code={`${ref.host.toBase58()}:${ref.roomId}`}
            pot={pot}
            isHost={wallet?.address === ref.host.toBase58()}
            busy={!!busy}
            botCount={bots.length}
            onAddBots={() => onAddBots(BOT_SEATS)}
            onStart={onStart}
          />
        )}

        {screen === "playing" && room && (
          <Round
            room={room}
            question={questionFor(room.round)}
            pot={pot}
            answer={answer}
            sealed={sealedWord && mySeat && answered(mySeat, room.round) ? sealedWord : null}
            alive={!!mySeat?.alive}
            busy={!!busy}
            onChange={setAnswer}
            onSubmit={onAnswer}
          />
        )}

        {screen === "reveal" && room && (
          <Reveal
            room={room}
            question={questionFor(room.lastRound)}
            you={wallet?.address}
            onNext={() =>
              setScreen(room.phase === Phase.Playing ? "playing" : "finished")
            }
          />
        )}

        {screen === "finished" && room && (
          <Finished
            room={room}
            pot={pot}
            youWon={!!mySeat?.alive}
            settled={room.phase === Phase.Settled}
            busy={!!busy}
            onSettle={onSettle}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* -------------------------------------------------------------- pieces */

export function Button({
  label,
  onPress,
  disabled,
  ghost,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  ghost?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        ghost ? s.btnGhost : s.btn,
        pressed && s.btnPressed,
        disabled && s.btnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={ghost ? s.btnGhostText : s.btnText}>{label}</Text>
    </Pressable>
  );
}

function Finished({
  room,
  pot,
  youWon,
  settled,
  busy,
  onSettle,
}: {
  room: RoomState;
  pot: number;
  youWon: boolean;
  settled: boolean;
  busy: boolean;
  onSettle(): void;
}) {
  const survivors = room.seats.filter((x) => x.alive);
  const share = survivors.length ? pot / survivors.length : 0;

  return (
    <View style={[s.card, youWon ? s.cardGood : s.cardBad]}>
      <Text style={s.big}>
        {youWon
          ? survivors.length === 1
            ? "Last one standing"
            : "You made it to the end"
          : "The herd moved on without you"}
      </Text>
      <Text style={s.body}>
        {survivors.length === 1
          ? "One player left after " + room.round + " rounds."
          : survivors.length + " left after " + room.round + " rounds."}
      </Text>
      {youWon && (
        <Text style={s.ruleLine}>
          {(share / 1e9).toFixed(3)} SOL {settled ? "paid out" : "waiting for you"}
        </Text>
      )}
      {!settled && <Button label="Pay out the pot" onPress={onSettle} disabled={busy} />}
      {settled && <Text style={s.note}>Settled on Solana. The rollup never touched it.</Text>}
    </View>
  );
}

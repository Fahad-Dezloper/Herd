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
import { Ending, Herd, Phase, Rule, type RoomState } from "./src/lib/herd";
import { explainChainError } from "./src/lib/errors";
import { connectWallet, explainWalletError, signTransaction, type Wallet } from "./src/lib/mwa";
import { sessionFor } from "./src/lib/session";
import { secureStore } from "./src/lib/secure";
import { botAnswer, botDelay, botsFor, type Bot } from "./src/bots";
import { EndingPick, EndingTally } from "./src/ui/EndingPick";
import { Finished } from "./src/ui/Finished";
import { questionFor } from "./src/questions";
import { Seats, answered } from "./src/ui/Seats";
import { Reveal } from "./src/ui/Reveal";
import { Round } from "./src/ui/Round";
import { Waiting } from "./src/ui/Waiting";
import { Button } from "./src/ui/Button";
import { s, shortKey } from "./src/ui/styles";
import idl from "./src/idl.json";

const herd = new Herd(idl);

const STAKE = 10_000_000n; // 0.01 SOL
/**
 * Seconds in a round.
 *
 * Fifteen was too tight. The clock starts when the room is sealed, which is the
 * last step of setting the game up - so a player is still reading the question
 * while it runs, and the first round was expiring before anyone could type.
 */
const ROUND_SECONDS = 30;

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

/**
 * What a joining player's session key gets, in the same transaction as the
 * stake.
 *
 * Enough to hand the room back from the rollup and pay the pot out, which is
 * all a player who is not the host ever needs it for. Without it a winner who
 * merely joined could not collect their own winnings - every ending would
 * depend on the host still being around, which is exactly the person with the
 * least reason to be once they are out.
 *
 * Answering costs nothing: rollup transactions are not charged, so the key
 * needs no fuel for the game itself.
 */
const JOIN_FUEL = 5_000_000n; // 0.005 SOL

/** Roughly what opening a game costs, before anyone joins. */
const HOST_COST = (bots: number) =>
  STAKE + SESSION_FUEL + BOT_FUEL * BigInt(bots) + 25_000_000n; // + account rent

type Screen =
  | "connect"
  | "lobby"
  /** Setting up a room you are about to open. */
  | "opening"
  /** Looking at a specific room before taking a seat in it. */
  | "joining"
  | "waiting"
  | "playing"
  | "reveal"
  | "finished";

/** How many bots a solo host gets. Six players is a game; three is barely one. */
const BOT_SEATS = 5;

interface RoomRef {
  host: PublicKey;
  roomId: bigint;
}

/**
 * Where the wallet authorisation is kept between launches.
 *
 * It is an MWA auth token, not a key - the key never leaves Seed Vault. What it
 * buys is the right to ask for a signature without a fresh approval screen,
 * which is the difference between opening the app and playing, and opening the
 * app and doing paperwork.
 */
const WALLET_KEY = "herd.wallet";

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [screen, setScreen] = useState<Screen>("connect");
  /** True until the stored wallet has been looked for. */
  const [restoring, setRestoring] = useState(true);
  // The tiebreak is a property of one room, not a setting you carry around, so
  // it is asked once you are looking at the room it applies to.
  const [vote, setVote] = useState<Ending>(Ending.Split);
  /** The room a join code pointed at, read before anyone commits a stake to it. */
  const [preview, setPreview] = useState<RoomState | null>(null);
  const [pending, setPending] = useState<{ host: PublicKey; roomId: bigint } | null>(null);
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

  /**
   * Hold on to a wallet authorisation.
   *
   * Called both on a fresh connect and whenever MWA has to renew a token that
   * went stale - the wallet drops them when its network changes - so the
   * renewal is not paid for twice.
   */
  const keepWallet = useCallback((next: Wallet) => {
    setWallet(next);
    secureStore.set(WALLET_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // Pick up where the last session left off. A connect screen on every launch
  // is asking the same question that was already answered.
  useEffect(() => {
    (async () => {
      const raw = await secureStore.get(WALLET_KEY);
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Wallet;
          if (saved?.address && saved?.authToken) {
            setWallet(saved);
            setScreen("lobby");
          }
        } catch {
          // Corrupt or from an older shape. Not worth recovering; ask again.
          await secureStore.del(WALLET_KEY);
        }
      }
      setRestoring(false);
    })();
  }, []);

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
      } catch (e) {
        // Someone else closing it first is expected and fine - that is the point
        // of letting anyone close a round. Anything else is worth seeing.
        const why = explainChainError(e);
        if (why && !/hasn't finished|already/i.test(why)) setError(why);
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

  /**
   * Back to the lobby for another game.
   *
   * Everything tied to the finished room goes with it - a stale session key or
   * room reference would otherwise be signing for a game that is over.
   */
  const onAgain = () => {
    setRef(null);
    setRoom(null);
    setSession(null);
    setPreview(null);
    setPending(null);
    setBots([]);
    setJoinCode("");
    setSealedWord(null);
    setError(null);
    setEndpoint({ url: BASE_RPC });
    setScreen("lobby");
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      // A chain error the player can act on beats a correct one they cannot.
      setError(explainChainError(e) ?? explainWalletError(e));
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
    const signed = await signTransaction(wallet.authToken, tx, keepWallet);
    return submit(BASE_RPC, signed);
  };

  /**
   * Forget the wallet.
   *
   * The counterpart to staying signed in: without it, a phone that remembers
   * you is a phone you cannot change your mind about. The MWA token is dropped
   * here; the key it refers to was always Seed Vault's and is untouched.
   */
  const onDisconnect = async () => {
    await secureStore.del(WALLET_KEY);
    setWallet(null);
    onAgain();
    setScreen("connect");
  };

  const onConnect = () =>
    run("Connecting", async () => {
      keepWallet(await connectWallet());
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
        herd.joinRoom(host, roomId, host, mine.publicKey, vote),
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

  /**
   * Look the room up before asking for a stake.
   *
   * A join code is opaque - it says nothing about how many people are in there,
   * what it costs, or what the table has voted for. Reading the room first
   * turns "paste this and hope" into a decision, and it is also the only honest
   * moment to ask for a vote, because the vote belongs to that room.
   */
  const onFind = () =>
    run("Finding the room", async () => {
      const [hostText, idText] = joinCode.trim().split(":");
      const host = new PublicKey(hostText);
      const roomId = BigInt(idText);

      const data = await accountData(BASE_RPC, herd.room(host, roomId));
      if (!data) throw new Error("No room with that code.");

      const found = herd.decodeRoom(data);
      if (found.phase !== Phase.Open) throw new Error("That room has already started.");

      setPreview(found);
      setPending({ host, roomId });
      setVote(Ending.Split);
      setScreen("joining");
    });

  const onJoin = () =>
    run("Taking a seat", async () => {
      const { host, roomId } = pending!;
      const key = herd.room(host, roomId);

      const mine = await sessionFor(key.toBase58());
      setSession(mine);
      await sendAsWallet([
        herd.joinRoom(host, roomId, new PublicKey(wallet!.address), mine.publicKey, vote),
        SystemProgram.transfer({
          fromPubkey: new PublicKey(wallet!.address),
          toPubkey: mine.publicKey,
          lamports: Number(JOIN_FUEL),
        }),
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
        //
        // Bots vote with whoever seated them. They exist so one person can play
        // a game that wants twelve, and five stand-ins outvoting the only human
        // at the table would be a strange way to honour a majority.
        await sendLocal(
          BASE_RPC,
          [bot.keypair],
          [herd.joinRoom(host, roomId, bot.keypair.publicKey, bot.keypair.publicKey, vote)],
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

  // Bots that exist and are funded but have not taken a seat yet. Counting the
  // ones that exist would hide the button the moment a room is opened, since
  // they are created and funded then.
  const unseatedBots = bots.filter(
    (bot) =>
      !room?.seats.some(
        (seat) => seat.wallet.toBase58() === bot.keypair.publicKey.toBase58(),
      ),
  ).length;

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

        {restoring && screen === "connect" && (
          <View style={s.card}>
            <Text style={s.note}>Looking for your wallet…</Text>
          </View>
        )}

        {!restoring && screen === "connect" && (
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
              <Button
                label="Open a room"
                onPress={() => {
                  setVote(Ending.Split);
                  setScreen("opening");
                }}
                disabled={!!busy}
              />
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
              <Button ghost label="Look at the room" onPress={onFind} disabled={!!busy || !joinCode} />
            </View>

            <View style={s.walletRow}>
              <Text style={s.note}>
                {wallet ? `${shortKey(wallet.address)} · ${wallet.label}` : ""}
              </Text>
              <Text style={s.disconnect} onPress={onDisconnect}>
                Disconnect
              </Text>
            </View>
          </>
        )}

        {screen === "opening" && (
          <>
            <Text style={s.section}>YOUR ROOM</Text>
            <View style={s.card}>
              <Text style={s.body}>
                Twelve seats, 0.01 SOL each. You can seat bots once it is open, so you do not need
                to find eleven people first.
              </Text>
            </View>

            <EndingPick value={vote} onChange={setVote} disabled={!!busy} />

            <View style={{ gap: 10 }}>
              <Button label="Open it" onPress={onCreate} disabled={!!busy} />
              <Button ghost label="Back" onPress={() => setScreen("lobby")} disabled={!!busy} />
            </View>
          </>
        )}

        {screen === "joining" && preview && (
          <>
            <Text style={s.section}>THIS ROOM</Text>
            <View style={s.card}>
              <View style={s.roundBar}>
                <Text style={s.chip}>{preview.seats.length} seated</Text>
                <Text style={s.pot}>
                  {((Number(preview.stake) * preview.seats.length) / 1e9).toFixed(3)} SOL
                </Text>
              </View>
              <Text style={s.body}>
                Taking a seat stakes {(Number(preview.stake) / 1e9).toFixed(3)} SOL.
              </Text>
            </View>

            <Text style={s.section}>WHO IS IN</Text>
            <Seats room={preview} />

            <View style={{ marginTop: 14 }}>
              <EndingTally room={preview} />
            </View>

            <EndingPick value={vote} onChange={setVote} disabled={!!busy} />

            <View style={{ gap: 10 }}>
              <Button label="Take the seat" onPress={onJoin} disabled={!!busy} />
              <Button ghost label="Back" onPress={() => setScreen("lobby")} disabled={!!busy} />
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
            unseatedBots={unseatedBots}
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
            onLeave={onAgain}
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
            you={wallet?.address}
            youWon={!!mySeat?.alive}
            settled={room.phase === Phase.Settled}
            busy={!!busy}
            onSettle={onSettle}
            onAgain={onAgain}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* -------------------------------------------------------------- pieces */

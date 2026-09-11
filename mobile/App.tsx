import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

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
import { Ending, Herd, Phase, type RoomState } from "./src/lib/herd";
import { explainChainError } from "./src/lib/errors";
import {
  connectWallet,
  explainWalletError,
  signTransaction,
  type Wallet,
} from "./src/lib/mwa";
import { sessionFor } from "./src/lib/session";
import { secureStore } from "./src/lib/secure";
import { botAnswer, botDelay, botsFor, type Bot } from "./src/bots";
import { EndingPick, EndingTally } from "./src/ui/EndingPick";
import { Avatar, Pips, Wordmark } from "./src/ui/Bits";
import { Fairness, GuardBar } from "./src/ui/Fairness";
import { Finished } from "./src/ui/Finished";
import { optionsFor, questionFor } from "./src/questions";
import { Seats, answered } from "./src/ui/Seats";
import { Reveal } from "./src/ui/Reveal";
import { Round } from "./src/ui/Round";
import { Waiting } from "./src/ui/Waiting";
import { Button } from "./src/ui/Button";
import { colors, shortKey } from "./src/ui/styles";
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
  /** The "why is this fair" sheet. */
  const [fairness, setFairness] = useState(false);
  // The tiebreak is a property of one room, not a setting you carry around, so
  // it is asked once you are looking at the room it applies to.
  const [vote, setVote] = useState<Ending>(Ending.Split);
  /** The room a join code pointed at, read before anyone commits a stake to it. */
  const [preview, setPreview] = useState<RoomState | null>(null);
  const [pending, setPending] = useState<{
    host: PublicKey;
    roomId: bigint;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ref, setRef] = useState<RoomRef | null>(null);
  const [session, setSession] = useState<Keypair | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [endpoint, setEndpoint] = useState<{ url: string; token?: string }>({
    url: BASE_RPC,
  });
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

  /**
   * What to call whoever is in a seat.
   *
   * A table of truncated public keys does not read as people, and it is the one
   * thing that gives a bot away instantly - a real room has names in it. Bots
   * carry theirs; anybody else is still their key, because that is genuinely
   * all we know about them.
   */
  const nameOf = useCallback(
    (key: string) => {
      if (key === wallet?.address) return "you";
      const bot = bots.find((b) => b.keypair.publicKey.toBase58() === key);
      return bot ? bot.name : shortKey(key);
    },
    [bots, wallet],
  );

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
    if (room.phase === Phase.Finished || room.phase === Phase.Settled)
      setScreen("finished");
    else setScreen("playing");
  }, [room]);

  // Close the round when the clock runs out. Anyone may do it, so the app does
  // rather than waiting for someone else to notice.
  useEffect(() => {
    if (!room || !wallet || room.phase !== Phase.Playing || room.awaitingCoin)
      return;
    const left = Number(room.roundEndsAt) - Math.floor(Date.now() / 1000);
    if (left > 0 || closing.current || !session) return;

    closing.current = true;
    (async () => {
      try {
        await sendLocal(
          endpoint.url,
          [session],
          [
            herd.closeRound(
              ref!.host,
              ref!.roomId,
              session.publicKey,
              room.round,
            ),
          ],
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
    if (!room || !ref || room.phase !== Phase.Playing || room.awaitingCoin)
      return;
    if (bots.length === 0 || botted.current === room.round) return;
    botted.current = room.round;

    const question = questionFor(room.round);
    const live = bots.filter((bot) =>
      room.seats.some(
        (seat) =>
          seat.alive &&
          seat.session.toBase58() === bot.keypair.publicKey.toBase58(),
      ),
    );

    live.forEach((bot) => {
      setTimeout(
        async () => {
          try {
            await sendLocal(
              endpoint.url,
              [bot.keypair],
              [
                herd.submitAnswer(
                  ref.host,
                  ref.roomId,
                  bot.keypair.publicKey,
                  botAnswer(question, bot.persona),
                ),
              ],
              endpoint.token,
            );
          } catch {
            // A bot that misses the window is culled for it, exactly like a person
            // who did not answer. Nothing to recover.
          }
        },
        botDelay(room.roundSeconds, bot.persona),
      );
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
      if (found.phase !== Phase.Open)
        throw new Error("That room has already started.");

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
        herd.joinRoom(
          host,
          roomId,
          new PublicKey(wallet!.address),
          mine.publicKey,
          vote,
        ),
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
          [
            herd.joinRoom(
              host,
              roomId,
              bot.keypair.publicKey,
              bot.keypair.publicKey,
              vote,
            ),
          ],
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
      await sendLocal(
        BASE_RPC,
        [session!],
        [herd.lockRoom(host, roomId, session!.publicKey)],
      );
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

  /**
   * Give the seat back before the game starts.
   *
   * A room needs three people, so without this a stake could be lost to nothing
   * happening at all - two players waiting on a third who never arrives had
   * paid into a vault with no way out of it.
   */
  const onLeave = () =>
    run("Leaving", async () => {
      const { host, roomId } = ref!;
      await sendAsWallet([
        herd.leaveRoom(host, roomId, new PublicKey(wallet!.address)),
      ]);
      onAgain();
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

  const mySeat = room?.seats.find(
    (x) => x.session.toBase58() === session?.publicKey.toBase58(),
  );

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
      className="flex-1 bg-bg"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <ScrollView
        contentContainerClassName="p-[18px] pt-[54px] pb-10 grow"
        keyboardShouldPersistTaps="handled"
      >
        {screen !== "connect" && screen !== "lobby" && (
          <View className="items-center mb-[18px]">
            <Wordmark small />
          </View>
        )}

        {error && (
          <View className="bg-bad-dim border border-bad-line rounded-card p-4 gap-3 mb-3.5">
            <Text className="text-bad-ink text-sm font-extrabold">Didn't work</Text>
            <Text className="text-bad-ink text-[13px] leading-[19px]">{error}</Text>
          </View>
        )}

        {busy && (
          <View className="bg-surface border border-line rounded-card p-4 mb-3.5 flex-row items-center gap-3">
            <ActivityIndicator color={colors.lime} />
            <Text className="text-muted text-body">{busy}…</Text>
          </View>
        )}

        {restoring && screen === "connect" && (
          <View className="bg-surface border border-line rounded-card p-4 gap-3">
            <Text className="text-faint text-note">Looking for your wallet…</Text>
          </View>
        )}

        {!restoring && screen === "connect" && (
          <>
            <View className="items-center mb-1.5">
              <Wordmark />
              <Text className="text-ink text-[15px] font-semibold -tracking-[0.2px] mt-0.5">Think alike. Stay alive.</Text>
              {/* An Image needs a size of its own - it has no text to grow around. */}
              <Image
                source={require("./assets/landing/herds.png")}
                className="w-[240px] h-[96px] mt-2.5 mb-1"
                resizeMode="contain"
              />
            </View>
            <View style={{ gap: 12, marginTop: 18 }}>
              <Button
                label="Connect wallet  →"
                onPress={onConnect}
                disabled={!!busy}
              />
              <Text className="text-faint text-note text-center">
                Everyone answers the same question. The odd one out goes.
              </Text>
            </View>
            <GuardBar onPress={() => setFairness(true)} />
          </>
        )}

        {screen === "lobby" && (
          <>
            <View className="items-center mb-1.5">
              <Wordmark />
              <Text className="text-ink text-[15px] font-semibold -tracking-[0.2px] mt-0.5">Think alike. Stay alive.</Text>
              {/* An Image needs a size of its own - it has no text to grow around. */}
              <Image
                source={require("./assets/landing/herds.png")}
                className="w-[240px] h-[96px] mt-2.5 mb-1"
                resizeMode="contain"
              />
            </View>

            <View style={{ gap: 12, marginTop: 14 }}>
              <Button
                label="PLAY  →"
                onPress={() => {
                  setVote(Ending.Split);
                  setScreen("opening");
                }}
                disabled={!!busy}
              />

              <View className="flex-row bg-surface border border-line rounded-2xl overflow-hidden">
                <View className="flex-1 p-3.5 gap-[3px]">
                  <Text className="text-faint text-[11px] font-semibold">Entry fee</Text>
                  <Text className="text-ink text-[19px] font-extrabold -tracking-[0.5px]">
                    {(Number(STAKE) / 1e9).toFixed(2)} ◎
                  </Text>
                </View>
                <View className="flex-1 p-3.5 gap-[3px] border-l border-line">
                  <Text className="text-faint text-[11px] font-semibold">Est. pot</Text>
                  <Text className="text-ink text-[19px] font-extrabold -tracking-[0.5px]">
                    ~{((Number(STAKE) * (BOT_SEATS + 1)) / 1e9).toFixed(2)} ◎
                  </Text>
                </View>
              </View>

              <View className="bg-surface border border-line rounded-card p-4 gap-3">
                <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase mb-2">GOT A CODE?</Text>
                <TextInput
                  className="bg-surface2 border border-line rounded-field px-4 py-3.5 text-ink text-[15px]"
                  placeholder="paste a room code"
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={joinCode}
                  onChangeText={setJoinCode}
                />
                <Button
                  ghost
                  label="Look at the room"
                  onPress={onFind}
                  disabled={!!busy || !joinCode}
                />
              </View>
            </View>

            <GuardBar onPress={() => setFairness(true)} />

            <View className="flex-row items-center mt-5 pt-3.5 border-t border-line">
              <Text className="text-faint text-note">
                {wallet ? `${shortKey(wallet.address)} · ${wallet.label}` : ""}
              </Text>
              <Text className="text-faint text-[12.5px] font-bold ml-auto" onPress={onDisconnect}>
                Disconnect
              </Text>
            </View>
          </>
        )}

        {screen === "opening" && (
          <>
            <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase mb-2">YOUR ROOM</Text>
            <View className="bg-surface border border-line rounded-card p-4 gap-3">
              <Text className="text-muted text-body">
                Twelve seats, 0.01 SOL each. You can seat bots once it is open,
                so you do not need to find eleven people first.
              </Text>
            </View>

            <EndingPick value={vote} onChange={setVote} disabled={!!busy} />

            <View style={{ gap: 10 }}>
              <Button label="Open it" onPress={onCreate} disabled={!!busy} />
              <Button
                ghost
                label="Back"
                onPress={() => setScreen("lobby")}
                disabled={!!busy}
              />
            </View>
          </>
        )}

        {screen === "joining" && preview && (
          <>
            <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase mb-2">THIS ROOM</Text>
            <View className="bg-surface border border-line rounded-card p-4 gap-3">
              <View className="flex-row items-center gap-2.5 mb-3.5">
                <Text className="text-muted text-note font-bold bg-surface border border-line rounded-full px-3 py-1 overflow-hidden">{preview.seats.length} seated</Text>
                <Text className="text-lime text-[13px] font-extrabold ml-auto">
                  {(
                    (Number(preview.stake) * preview.seats.length) /
                    1e9
                  ).toFixed(3)}{" "}
                  SOL
                </Text>
              </View>
              <Text className="text-muted text-body">
                Taking a seat stakes {(Number(preview.stake) / 1e9).toFixed(3)}{" "}
                SOL.
              </Text>
            </View>

            <Text className="text-faint text-micro font-extrabold tracking-[1.4px] uppercase mb-2">WHO IS IN</Text>
            <Seats room={preview} />

            <View style={{ marginTop: 14 }}>
              <EndingTally room={preview} />
            </View>

            <EndingPick value={vote} onChange={setVote} disabled={!!busy} />

            <View style={{ gap: 10 }}>
              <Button
                label="Take the seat"
                onPress={onJoin}
                disabled={!!busy}
              />
              <Button
                ghost
                label="Back"
                onPress={() => setScreen("lobby")}
                disabled={!!busy}
              />
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
            nameOf={nameOf}
            you={wallet?.address}
            onAddBots={() => onAddBots(BOT_SEATS)}
            onStart={onStart}
            onLeave={onLeave}
          />
        )}

        {screen === "playing" && room && (
          <Round
            room={room}
            question={questionFor(room.round)}
            options={optionsFor(room.round)}
            nameOf={nameOf}
            you={wallet?.address}
            pot={pot}
            answer={answer}
            sealed={
              sealedWord && mySeat && answered(mySeat, room.round)
                ? sealedWord
                : null
            }
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
            nameOf={nameOf}
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
            nameOf={nameOf}
            youWon={!!mySeat?.alive}
            settled={room.phase === Phase.Settled}
            busy={!!busy}
            onSettle={onSettle}
            onAgain={onAgain}
          />
        )}
      </ScrollView>
      <Fairness open={fairness} onClose={() => setFairness(false)} />
    </KeyboardAvoidingView>
  );
}

/* -------------------------------------------------------------- pieces */

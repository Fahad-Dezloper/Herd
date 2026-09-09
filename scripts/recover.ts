/**
 * Driving an abandoned public room to its end.
 *
 * Nobody owns a dealt room, so nobody is obliged to finish one. Six people
 * could be seated and all six close the app, and their stakes would sit in a
 * vault behind a game that never ends.
 *
 * They do not, because closing a round is permissionless once its window has
 * passed and a room can only survive twelve of them. Anyone at all can walk a
 * dead room to the end, and settle then pays whoever the rules left standing.
 * This is that walk.
 */
import { BASE_RPC, accountData, confirm, lamportsOf, loadKeypair, send, sleep } from "./lib/chain";
import { Herd, Phase } from "./lib/herd";
import idl from "./idl.json";

const herd = new Herd(idl);
const payer = loadKeypair(`${process.env.HOME}/.config/solana/id.json`);
const STAKE = 10_000_000n;
const queue = herd.queue(STAKE);

const ONLY = process.env.ROOM ? BigInt(process.env.ROOM) : null;

for (let index = 0n; index < 10n; index++) {
  if (ONLY !== null && index !== ONLY) continue;
  const room = herd.publicRoom(STAKE, index);
  const data = await accountData(BASE_RPC, room);
  if (!data) continue;
  let state = herd.decodeRoom(data);
  if (state.phase !== Phase.Playing) {
    console.log(`room ${index}: ${Phase[state.phase]}, nothing to do`);
    continue;
  }

  process.stdout.write(`room ${index}: abandoned at round ${state.round}, walking it out`);
  // A dealt room that was never delegated is still on Solana, so the rounds can
  // be closed right here. Nobody answered any of them, so every player is their
  // own group of one, every group ties, and nobody strays - which is exactly
  // what should happen to a game nobody played.
  for (let guard = 0; guard < 14 && state.phase === Phase.Playing; guard++) {
    // Every round after the first has a real window, and it has to run out
    // before anyone may close it - the same rule that stops a player closing a
    // round early on the people still typing.
    const waitFor = Number(state.roundEndsAt) - Math.floor(Date.now() / 1000) + 2;
    if (waitFor > 0) await sleep(waitFor * 1000);
    await confirm(
      BASE_RPC,
      await send(BASE_RPC, [payer], [herd.closeRound(queue, index, payer.publicKey, state.round)]),
    );
    state = herd.decodeRoom((await accountData(BASE_RPC, room))!);
    process.stdout.write(".");
  }
  console.log(` ${Phase[state.phase]}`);

  const winners = state.seats.filter((x) => x.alive).map((x) => x.wallet);
  const vaultBefore = await lamportsOf(BASE_RPC, herd.vault(room));
  await confirm(
    BASE_RPC,
    await send(BASE_RPC, [payer], [herd.settle(queue, index, payer.publicKey, winners)]),
  );
  console.log(
    `  refunded ${winners.length} players; vault ${vaultBefore} -> ${await lamportsOf(BASE_RPC, herd.vault(room))}`,
  );
}

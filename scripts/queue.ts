/**
 * The public queue, on devnet.
 *
 * Twelve strangers pay to stand in one line and the oracle decides who ends up
 * where. What this has to show is that nobody chose: not the players, not
 * whoever triggered the deal, not us.
 */
import { Keypair, PublicKey, SystemProgram, Transaction, Connection } from "@solana/web3.js";
import { BASE_RPC, accountData, confirm, lamportsOf, loadKeypair, send, sleep } from "./lib/chain";
import { Ending, Herd, Phase } from "./lib/herd";
import idl from "./idl.json";

const herd = new Herd(idl);
const payer = loadKeypair(`${process.env.HOME}/.config/solana/id.json`);
const STAKE = 10_000_000n;
const conn = new Connection(BASE_RPC, "confirmed");

const ok = (m: string) => console.log(`   PASS  ${m}`);
const bad = (m: string) => console.log(`   FAIL  ${m}`);

const queue = herd.queue(STAKE);
const qvault = herd.queueVault(queue);
console.log(`queue  ${queue.toBase58()}`);

async function fire(signers: Keypair[], ixs: any[], label: string) {
  try {
    const sig = await send(BASE_RPC, signers, ixs);
    await confirm(BASE_RPC, sig);
    return sig;
  } catch (e: any) {
    console.log(`    ${label} failed: ${String(e.message).split("\n").slice(0, 3).join(" | ")}`);
    throw e;
  }
}

// The line and the tables are built once and reused for every game after this.
if (!(await accountData(BASE_RPC, queue))) {
  await fire([payer], [herd.openQueue(payer.publicKey, STAKE, 30)], "open queue");
  console.log("  line opened");
}


// Devnet has leftovers from earlier runs. A line that is already full would
// refuse the twelve this run is about to add, so clear it out first.
{
  const before = herd.decodeQueue((await accountData(BASE_RPC, queue))!);
  if (before.count > 0) {
    console.log(`  clearing ${before.count} left over from an earlier run`);
    let spare = 0n;
    while (herd.decodeQueue((await accountData(BASE_RPC, queue))!).count >= 6) {
      while (true) {
        const data = await accountData(BASE_RPC, herd.publicRoom(STAKE, spare));
        if (!data) {
          await fire([payer], [herd.openPublicRoom(payer.publicKey, STAKE, spare)], "spare");
          break;
        }
        const st = herd.decodeRoom(data);
        if (st.phase === Phase.Open || st.phase === Phase.Settled) break;
        spare += 1n;
      }
      await fire([payer], [herd.deal(payer.publicKey, STAKE, spare, 3)], "drain");
      for (let i = 0; i < 25; i++) {
        await sleep(1500);
        if (!herd.decodeQueue((await accountData(BASE_RPC, queue))!).awaitingDeal) break;
      }
      spare += 1n;
    }
  }
}

/**
 * Two tables that are free to be dealt.
 *
 * A room mid-game refuses a new table, which is what should happen - so a
 * client looks for one that has never been used or has already paid out, and
 * builds another only when every existing one is busy.
 */
const tables: bigint[] = [];
for (let index = 0n; index < 16n && tables.length < 2; index++) {
  const data = await accountData(BASE_RPC, herd.publicRoom(STAKE, index));
  if (!data) {
    await fire([payer], [herd.openPublicRoom(payer.publicKey, STAKE, index)], `room ${index}`);
    console.log(`  public room ${index} built`);
    tables.push(index);
    continue;
  }
  const state = herd.decodeRoom(data);
  if (state.phase === Phase.Open || state.phase === Phase.Settled) {
    tables.push(index);
  }
}
if (tables.length < 2) throw new Error("no free public rooms");
console.log(`  dealing into rooms ${tables.join(" and ")}`);

console.log("\n[1] twelve strangers pay to stand in line");
const people: { wallet: Keypair; session: Keypair }[] = [];
for (let i = 0; i < 12; i++) {
  people.push({ wallet: Keypair.generate(), session: Keypair.generate() });
}

const fund = new Transaction();
people.forEach((p) =>
  fund.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: p.wallet.publicKey,
      lamports: Number(STAKE) + 10_000_000,
    }),
  ),
);
fund.feePayer = payer.publicKey;
fund.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
fund.sign(payer);
await confirm(BASE_RPC, await conn.sendRawTransaction(fund.serialize()));

for (const p of people) {
  await fire(
    [p.wallet],
    [herd.enterQueue(p.wallet.publicKey, STAKE, p.session.publicKey, Ending.Split)],
    "enter",
  );
}
const line = herd.decodeQueue((await accountData(BASE_RPC, queue))!);
console.log(`    ${line.count} waiting, vault holds ${await lamportsOf(BASE_RPC, qvault)}`);

console.log("\n[2] the oracle deals two rooms");
const dealt: string[][] = [];
for (const index of tables) {
  const room = herd.publicRoom(STAKE, index);
  await fire([payer], [herd.deal(payer.publicKey, STAKE, index, Number(index) + 7)], `deal ${index}`);

  let state = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1500);
    const q = herd.decodeQueue((await accountData(BASE_RPC, queue))!);
    if (!q.awaitingDeal) {
      state = herd.decodeRoom((await accountData(BASE_RPC, room))!);
      break;
    }
  }
  if (!state) {
    bad(`room ${index}: the oracle never answered`);
    process.exit(1);
  }
  const seats = state.seats.map((s) => s.wallet.toBase58());
  dealt.push(seats);
  console.log(
    `    room ${index}: ${seats.length} seated, phase ${Phase[state.phase]}, vault ${await lamportsOf(BASE_RPC, herd.vault(room))}`,
  );
  console.log(`      ${seats.map((k) => k.slice(0, 6)).join("  ")}`);
}

console.log("\n[3] what the shuffle did with the line");
const order = people.map((p) => p.wallet.publicKey.toBase58());
const seatedIn = (k: string) => (dealt[0].includes(k) ? 0 : dealt[1].includes(k) ? 1 : -1);
console.log(`    joined 1st..12th -> room ${order.map((k) => seatedIn(k)).join(" ")}`);

const everyone = [...dealt[0], ...dealt[1]];
if (new Set(everyone).size === 12 && everyone.length === 12) {
  ok("all twelve were dealt, nobody twice, nobody dropped");
} else {
  bad(`${everyone.length} seats filled by ${new Set(everyone).size} people`);
}

// Two friends who deliberately queued back to back.
const together = seatedIn(order[0]) === seatedIn(order[1]);
console.log(`    the two who joined back to back landed ${together ? "TOGETHER" : "apart"}`);

const left = herd.decodeQueue((await accountData(BASE_RPC, queue))!);
console.log(`    line now holds ${left.count}, vault ${await lamportsOf(BASE_RPC, qvault)}`);
if (left.count === 0) ok("the line emptied into the rooms");
else bad(`${left.count} still waiting`);

import { BASE_RPC, accountData } from "./lib/chain";
import { Herd, Phase } from "./lib/herd";
import idl from "./idl.json";
const herd = new Herd(idl);
const STAKE = 10_000_000n;
const q = herd.decodeQueue((await accountData(BASE_RPC, herd.queue(STAKE)))!);
console.log(`queue: ${q.count} waiting, awaitingDeal=${q.awaitingDeal}, dealingInto=${q.dealingInto}`);
for (let i = 0n; i < 10n; i++) {
  const d = await accountData(BASE_RPC, herd.publicRoom(STAKE, i));
  if (!d) { console.log(`room ${i}: (not built)`); continue; }
  const r = herd.decodeRoom(d);
  console.log(`room ${i}: phase=${Phase[r.phase]} seats=${r.seats.length} round=${r.round} dealt=${r.dealt}`);
}

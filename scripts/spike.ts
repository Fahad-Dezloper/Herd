/**
 * PHASE 1 - the three spikes.
 *
 * Answers, against the real devnet TEE rollup and the real VRF oracle:
 *
 *   1a  can state be committed out of a rollup back to Solana?
 *   1b  can an ephemeral permission have no readable members at all?
 *   1c  does VRF work from inside a rollup, request and callback?
 *
 * Nothing else in the project starts until this reports. Run:
 *   bun run spike.ts
 */

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  BASE_RPC,
  TEE_VALIDATOR,
  accountData,
  authenticate,
  confirm,
  delegationOf,
  lamportsOf,
  loadKeypair,
  send,
  sleep,
} from "./lib/chain";
import { Program, optionPubkey, u8 } from "./lib/program";

const idl = await Bun.file(new URL("../target/idl/herd.json", import.meta.url).pathname).json();
const program = new Program(idl);

const owner = loadKeypair(`${process.env.HOME}/.config/solana/id.json`);
const probe = program.pda([Buffer.from("probe"), owner.publicKey.toBuffer()]);

// Every seed path the IDL asks for. `probe.owner` is a field of the probe, which
// the client cannot read before the probe exists, so it is named explicitly.
// The permission program derives this; the seed carries a trailing colon and
// dropping it produces a different, perfectly valid-looking address that the
// program then rejects.
const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const permission = PublicKey.findProgramAddressSync(
  [Buffer.from("permission:"), probe.toBuffer()],
  PERMISSION_PROGRAM,
)[0];

const named = {
  owner: owner.publicKey,
  probe,
  "probe.owner": owner.publicKey,
  payer: owner.publicKey,
  permission,
};

const say = (s: string) => console.log(s);
const ok = (s: string) => console.log(`   PASS  ${s}`);
const bad = (s: string) => console.log(`   FAIL  ${s}`);

say(`program ${program.id.toBase58()}`);
say(`owner   ${owner.publicKey.toBase58()}`);
say(`probe   ${probe.toBase58()}`);
say(`perm    ${permission.toBase58()}\n`);

/* ------------------------------------------------------------ base layer */

say("[0] create the probe on Solana");
if (await accountData(BASE_RPC, probe)) {
  say("    already exists");
} else {
  const sig = await send(BASE_RPC, [owner], [program.build("init_probe", named)]);
  await confirm(BASE_RPC, sig);
  say(`    ${sig}`);
}
say(`    lamports ${await lamportsOf(BASE_RPC, probe)}`);

say("\n[1] delegate it to the TEE validator");
let status = await delegationOf(probe);
if (!status.isDelegated) {
  const sig = await send(
    BASE_RPC,
    [owner],
    [program.build("delegate_probe", named, optionPubkey(TEE_VALIDATOR))],
  );
  await confirm(BASE_RPC, sig);
  say(`    ${sig}`);
  await sleep(3000);
  status = await delegationOf(probe);
}
say(`    delegated=${status.isDelegated} fqdn=${status.fqdn} authority=${status.authority}`);
if (!status.fqdn) throw new Error("not delegated - cannot continue");

const ER = status.fqdn.replace(/\/$/, "");
const token = await authenticate(ER, owner);
say(`    authenticated to the rollup`);

/* ------------------------------------------------------------------ 1a */

say("\n[SPIKE 1a] commit rollup state back to Solana");
const before = decodeProbe(await accountData(BASE_RPC, probe));
say(`    value on Solana before: ${before.value}`);

const bump = await send(ER, [owner], [program.build("bump_probe", named)], token);
await confirm(ER, bump, token);
const inRollup = decodeProbe(await accountData(ER, probe, token));
say(`    value in the rollup after a bump: ${inRollup.value}`);

const commit = await send(ER, [owner], [program.build("commit_probe", named)], token);
await confirm(ER, commit, token);
say(`    commit ${commit}`);
await sleep(12000);

const after = decodeProbe(await accountData(BASE_RPC, probe));
say(`    value on Solana after the commit: ${after.value}`);
if (after.value === inRollup.value && after.value > before.value) {
  ok("rollup state reaches Solana - the pot can pay out");
} else {
  bad(`commit did not land (solana=${after.value}, rollup=${inRollup.value})`);
}

/* ------------------------------------------------------------------ 1c */

say("\n[SPIKE 1c] VRF from inside the rollup");
const beforeRoll = decodeProbe(await accountData(ER, probe, token));
if (beforeRoll.rolled) {
  say("    already rolled once; requesting again to prove it is repeatable");
}
const queue = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"); // DEFAULT_EPHEMERAL_QUEUE
try {
  const roll = await send(
    ER,
    [owner],
    [program.build("request_roll", { ...named, oracle_queue: queue }, u8(7))],
    token,
  );
  say(`    request accepted ${roll}`);

  let delivered = null;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const p = decodeProbe(await accountData(ER, probe, token));
    if (p.rolled && !sameBytes(p.randomness, beforeRoll.randomness)) {
      delivered = p;
      break;
    }
  }
  if (delivered) {
    ok(`randomness delivered: ${Buffer.from(delivered.randomness).toString("hex").slice(0, 24)}…`);
  } else {
    bad("request was accepted but no callback arrived within 30s");
  }
} catch (e: any) {
  bad(`request rejected: ${String(e.message).split("\n")[0]}`);
}

/* ------------------------------------------------------------------ 1b */

say("\n[SPIKE 1b] seal the probe so nobody can read it");
try {
  const seal = await send(ER, [owner], [program.build("seal_probe", named)], token);
  await confirm(ER, seal, token);
  say(`    sealed ${seal}`);
  await sleep(3000);
} catch (e: any) {
  bad(`seal rejected: ${String(e.message).split("\n").slice(0, 2).join(" | ")}`);
}

const anon = await accountData(ER, probe);
const asOwner = await accountData(ER, probe, await authenticate(ER, owner));
const stranger = Keypair.generate();
const asStranger = await accountData(ER, probe, await authenticate(ER, stranger));

say(`    anonymous read : ${anon ? `READABLE (${anon.length} bytes)` : "refused"}`);
say(`    owner read     : ${asOwner ? `READABLE (${asOwner.length} bytes)` : "refused"}`);
say(`    stranger read  : ${asStranger ? `READABLE (${asStranger.length} bytes)` : "refused"}`);

if (!anon && !asOwner && !asStranger) {
  ok("a zero-member permission hides the account from everyone, including its owner");
} else if (!anon && !asStranger && asOwner) {
  bad("the owner can still read it - answers would leak to whoever owns the room");
} else {
  bad("the account is still readable - sealing did not take");
}

/* ------------------------------------------------------------------ util */

function decodeProbe(data: Uint8Array | null) {
  if (!data) return { value: -1, randomness: new Uint8Array(32), rolled: false };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    value: Number(view.getBigUint64(8 + 32, true)),
    randomness: data.slice(8 + 32 + 8, 8 + 32 + 8 + 32),
    rolled: data[8 + 32 + 8 + 32] === 1,
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

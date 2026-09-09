/**
 * Building instructions straight from the generated IDL.
 *
 * Hand-writing discriminators and account lists is how a client silently drifts
 * from its program - the `#[delegate]`, `#[commit]` and `#[vrf]` macros inject
 * accounts that appear nowhere in the Rust source, so a list written by reading
 * the program is wrong before you start. Reading the IDL means the two cannot
 * disagree: change the program, rebuild, and the client follows.
 *
 * Fixed addresses and derivable PDAs are filled in automatically. Anything else
 * the caller names explicitly.
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface IdlAccount {
  name: string;
  signer?: boolean;
  writable?: boolean;
  address?: string;
  pda?: { seeds: any[]; program?: { kind: string; value?: number[] } };
}

export interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: IdlAccount[];
  args: { name: string; type: any }[];
}

export interface Idl {
  address: string;
  instructions: IdlInstruction[];
  accounts?: { name: string; discriminator: number[] }[];
}

/** Accounts the caller supplies, by IDL name (and by seed path where needed). */
export type Named = Record<string, PublicKey>;

export class Program {
  readonly id: PublicKey;

  constructor(private readonly idl: Idl) {
    this.id = new PublicKey(idl.address);
  }

  instruction(name: string): IdlInstruction {
    const ix = this.idl.instructions.find((i) => i.name === name);
    if (!ix) throw new Error(`no instruction "${name}" in the IDL`);
    return ix;
  }

  accountDiscriminator(name: string): Uint8Array {
    const a = this.idl.accounts?.find((x) => x.name === name);
    if (!a) throw new Error(`no account "${name}" in the IDL`);
    return Uint8Array.from(a.discriminator);
  }

  /** Derive a PDA the way the IDL says the program does. */
  pda(seeds: (Uint8Array | Buffer)[], program = this.id): PublicKey {
    return PublicKey.findProgramAddressSync(seeds as Buffer[], program)[0];
  }

  build(name: string, named: Named, args: Uint8Array = new Uint8Array(0)): TransactionInstruction {
    const ix = this.instruction(name);

    const keys = ix.accounts.map((account) => {
      const pubkey = this.resolve(name, account, named);
      return {
        pubkey,
        isSigner: !!account.signer,
        isWritable: !!account.writable,
      };
    });

    const data = new Uint8Array(8 + args.length);
    data.set(ix.discriminator, 0);
    data.set(args, 8);

    return new TransactionInstruction({ programId: this.id, keys, data: Buffer.from(data) });
  }

  private resolve(ixName: string, account: IdlAccount, named: Named): PublicKey {
    if (named[account.name]) return named[account.name];
    if (account.address) return new PublicKey(account.address);

    if (account.pda) {
      const seeds = account.pda.seeds.map((seed) => this.seed(ixName, account, seed, named));
      return this.pda(seeds, this.pdaProgram(ixName, account, named));
    }

    throw new Error(
      `${ixName}: no address for account "${account.name}" - pass it in explicitly`,
    );
  }

  /**
   * Which program a PDA is derived under.
   *
   * Usually this program, but the delegation macros derive their record and
   * metadata accounts under the delegation program, and the IDL expresses that
   * as a reference to another account in the same instruction rather than as a
   * literal. Missing that derives a plausible-looking address the program then
   * rejects with a seeds-constraint violation.
   */
  private pdaProgram(ixName: string, account: IdlAccount, named: Named): PublicKey {
    const program = account.pda!.program;
    if (!program) return this.id;

    if (program.kind === "const" && program.value) {
      return new PublicKey(Uint8Array.from(program.value));
    }

    if (program.kind === "account") {
      const path = (program as any).path as string;
      const referenced = this.instruction(ixName).accounts.find((a) => a.name === path);
      if (referenced) return this.resolve(ixName, referenced, named);
      if (named[path]) return named[path];
    }

    throw new Error(
      `${ixName}: cannot resolve the program for PDA "${account.name}"`,
    );
  }

  private seed(ixName: string, account: IdlAccount, seed: any, named: Named): Uint8Array {
    if (seed.kind === "const") return Uint8Array.from(seed.value);

    if (seed.kind === "account") {
      // Paths look like "owner" or "probe.owner". A dotted path reads a field of
      // another account, which the client cannot know without fetching it, so
      // the caller supplies it under that exact name.
      const found = named[seed.path];
      if (found) return found.toBytes();
      throw new Error(
        `${ixName}: account "${account.name}" needs seed "${seed.path}" - pass it in as named["${seed.path}"]`,
      );
    }

    throw new Error(`${ixName}: unsupported seed kind "${seed.kind}"`);
  }
}

/* ------------------------------------------------------------------ borsh */

export const u8 = (n: number) => Uint8Array.from([n]);

export function u64(n: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return out;
}

export function optionPubkey(key: PublicKey | null): Uint8Array {
  if (!key) return Uint8Array.from([0]);
  const out = new Uint8Array(33);
  out[0] = 1;
  out.set(key.toBytes(), 1);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Mobile Wallet Adapter, native.
 *
 * This is the path a mobile browser cannot take. In a browser, local MWA needs
 * a Local Network Access permission the browser never actually prompts for, and
 * the remote reflector flow is broken in the shipped Seeker wallets
 * (solana-mobile/mobile-wallet-adapter#1484). Native MWA is affected by
 * neither: it binds to the wallet service over Android Intents directly, and on
 * the Seeker that is Seed Vault, whose key lives in hardware and signs behind a
 * biometric.
 *
 * `transact` opens a short-lived session. Everything that needs the wallet must
 * happen inside that callback - the session closes when it resolves.
 */

import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, Transaction } from "@solana/web3.js";

const APP_IDENTITY = {
  name: "Herd",
  uri: "https://herd.game",
};

const CHAIN = "solana:devnet";

export interface Wallet {
  address: string;
  label: string;
  /** Cached so later sessions can skip the approval prompt. */
  authToken: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode base64 without depending on atob or Buffer, neither of which React
 *  Native guarantees. Addresses arrive from MWA in this form. */
function fromBase64(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "");
  const out = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("not base64");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Address comes back base64-encoded; render it as the base58 users recognise. */
function addressToBase58(address: string): string {
  try {
    return new PublicKey(fromBase64(address)).toBase58();
  } catch {
    return address;
  }
}

/**
 * Turn a wallet failure into something a person can act on.
 *
 * MWA surfaces raw Java exceptions - `CancellationException`, `TimeoutException`
 * - which say nothing about what to do next. Dismissing the biometric sheet is
 * the single most common outcome and is not an error at all, so it should not
 * read like a crash.
 */
export function explainWalletError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  // Seed Vault validates against its own global network setting, not the chain
  // the app authorised. There is nothing the app can do about it, so say what
  // to change rather than repeating the wallet's wording.
  if (/network mismatch|current network/i.test(raw)) {
    return "Your wallet is set to a different network. Switch Seed Vault to devnet and try again.";
  }
  if (/cancel/i.test(raw)) {
    return "The wallet approval was dismissed. Tap Approve and confirm with your fingerprint.";
  }
  if (/timeout|timed out/i.test(raw)) {
    return "The wallet did not respond in time. Try again.";
  }
  if (/not.*(found|installed)|no.*wallet/i.test(raw)) {
    return "No wallet app answered. Seed Vault should be available on a Seeker.";
  }
  if (/authorization request failed|auth.*token|reauthoriz/i.test(raw)) {
    return "The wallet session expired. Tap again and approve to renew it.";
  }
  return raw;
}

export async function connectWallet(): Promise<Wallet> {
  return transact(async (wallet) => {
    const result = await wallet.authorize({
      chain: CHAIN,
      identity: APP_IDENTITY,
    });

    const account = result.accounts[0];
    if (!account) throw new Error("the wallet returned no account");

    return {
      address: addressToBase58(account.address),
      label: account.label ?? "Seed Vault",
      authToken: result.auth_token,
    };
  });
}

/**
 * Get a usable session, re-authorising if the cached token has gone stale.
 *
 * A stored `auth_token` does not last forever, and it is dropped outright when
 * the wallet's network changes - `reauthorize` then fails with the unhelpful
 * "-1/authorization request failed". Making the user disconnect and reconnect
 * to recover from that is a poor answer when the app can simply ask again.
 *
 * `onRenewed` fires only when a fresh authorisation was needed, so the caller
 * can persist the new token rather than paying for another prompt next time.
 */
async function authorized(
  wallet: any,
  authToken: string,
  onRenewed?: (wallet: Wallet) => void,
): Promise<void> {
  try {
    await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY });
    return;
  } catch (e) {
    if (!/authoriz/i.test(String(e))) throw e;
  }

  const result = await wallet.authorize({ chain: CHAIN, identity: APP_IDENTITY });
  const account = result.accounts[0];
  if (!account) throw new Error("the wallet returned no account");
  onRenewed?.({
    address: addressToBase58(account.address),
    label: account.label ?? "Seed Vault",
    authToken: result.auth_token,
  });
}

/**
 * Pull the signature out of an MWA signed payload.
 *
 * `sign_messages` returns the message with the 64-byte signature appended, not
 * the signature alone. Handing the whole payload to HKDF would still produce a
 * stable seed, so the mistake is invisible - which is exactly why it is worth
 * being strict about.
 */
const SIGNATURE_BYTES = 64;

function signatureFrom(signedPayload: Uint8Array, message: Uint8Array): Uint8Array {
  if (signedPayload.length === SIGNATURE_BYTES) return signedPayload;

  const expected = message.length + SIGNATURE_BYTES;
  if (signedPayload.length !== expected) {
    throw new Error(
      `the wallet returned ${signedPayload.length} bytes; expected ${expected} ` +
        `(a ${message.length}-byte message plus a ${SIGNATURE_BYTES}-byte signature)`,
    );
  }
  return signedPayload.subarray(message.length);
}

/**
 * Something that signs bytes with the wallet key, for as long as the session
 * is open. Matches the `Ed25519Signer` the derivation layer expects.
 */
export interface SessionSigner {
  publicKey: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Open one wallet session and do all the signing inside it.
 *
 * MWA sessions are short-lived and each `transact` is a separate hand-off to
 * the wallet app, so signing n messages through n calls means n round trips
 * through the wallet UI. Deriving codes needs several signatures at once;
 * this keeps them in a single session.
 *
 * The signer is only valid inside `fn` - it stops working the moment this
 * resolves, by design.
 *
 * Ed25519 is deterministic, so the same message always yields the same
 * signature and therefore the same seed. That is what lets codes follow the
 * wallet to another phone. Never substitute a hardware P-256 key here: ECDSA
 * is randomised and would give a different code on every unlock.
 */
export async function withSigner<T>(
  authToken: string,
  address: string,
  fn: (signer: SessionSigner) => Promise<T>,
  onRenewed?: (wallet: Wallet) => void,
): Promise<T> {
  return transact(async (wallet) => {
    await authorized(wallet, authToken, onRenewed);

    const signer: SessionSigner = {
      publicKey: address,
      async signMessage(message) {
        const [signed] = await wallet.signMessages({
          addresses: [address],
          payloads: [message],
        });
        return signatureFrom(new Uint8Array(signed), message);
      },
    };

    return fn(signer);
  });
}

/** Sign a single message. Prefer `withSigner` when signing more than one. */
export async function signMessage(
  authToken: string,
  address: string,
  message: Uint8Array,
): Promise<Uint8Array> {
  return withSigner(authToken, address, (signer) => signer.signMessage(message));
}

/**
 * Sign a transaction without sending it.
 *
 * Everything is submitted by us rather than by the wallet. A rollup transaction
 * has to be: it goes to the endpoint the router names for that account, and a
 * private one wants an auth token on the URL. A base-layer transaction should
 * be, for a different reason - `signAndSendTransactions` lets the wallet choose
 * the network, and Seed Vault set to mainnet refuses a devnet transaction with
 * "Network mismatch". Signing here and delivering ourselves keeps the endpoint
 * our decision.
 */
export async function signTransaction(
  authToken: string,
  transaction: Transaction,
  onRenewed?: (wallet: Wallet) => void,
): Promise<Uint8Array> {
  return transact(async (wallet) => {
    await authorized(wallet, authToken, onRenewed);
    const [signed] = await wallet.signTransactions({
      transactions: [transaction],
    });
    return new Uint8Array(signed.serialize({ requireAllSignatures: false }));
  });
}

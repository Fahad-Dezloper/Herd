/**
 * Entry point, and the two globals React Native does not provide.
 *
 * These must be installed before anything else is imported, which is why they
 * are here rather than in App.tsx: module initialisation runs on import, and a
 * module that touches `Buffer` at load time would fail before App ever renders.
 *
 * `crypto.getRandomValues` is needed for salts and account ids. `Buffer` is
 * needed by @solana/web3.js throughout - `PublicKey.toBuffer`, transaction
 * serialisation, PDA derivation - and its absence is invisible under a test
 * runner like Bun, which has both.
 */

import "react-native-get-random-values";
import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);

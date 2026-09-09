/**
 * Hardware-backed storage, via expo-secure-store.
 *
 * Only one thing goes in here: the session key. It is a throwaway that can sign
 * answers and nothing else - it cannot join a room, settle a pot or touch the
 * vault - but it is still a key, and a key on a phone belongs in the Keystore.
 */

import * as SecureStore from "expo-secure-store";

export const secureStore = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      // A phone with site data blocked, or a first run. Absent, not fatal.
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
  async del(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};

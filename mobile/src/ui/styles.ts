/** One palette, so the screens cannot drift apart. */

import { StyleSheet } from "react-native";

/**
 * Paper, not an inverted night screen.
 *
 * The neutrals carry a faint warm bias so they sit under the gold rather than
 * fighting it, and the gold splits in two: the bright one is a fill you put
 * dark text on, and `goldInk` is the only one legible as text on paper. Using
 * the fill colour for a word is the mistake this pair exists to prevent.
 */
export const colors = {
  bg: "#faf9f5",
  surface: "#ffffff",
  surface2: "#f2f0ea",
  line: "#e5e2d9",
  lineStrong: "#cdc8bb",
  ink: "#16181d",
  muted: "#5c6270",
  faint: "#8b8f9a",
  gold: "#ffc733",
  goldInk: "#8a5a00",
  good: "#15803d",
  bad: "#c2381f",
};

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 44, flexGrow: 1 },

  brand: { marginBottom: 26 },
  title: { color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: -1 },

  lead: { color: colors.muted, fontSize: 16, lineHeight: 24, marginBottom: 8 },
  leadStrong: { color: colors.ink, fontWeight: "600" },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  cardBad: { backgroundColor: "#fdf1ee", borderColor: "#f0cec4" },
  cardGood: { backgroundColor: "#eef7f0", borderColor: "#c3e0cb" },
  cardGold: { backgroundColor: "#fff8e3", borderColor: "#f0dda2" },

  section: {
    color: colors.faint,
    fontSize: 11,
    letterSpacing: 1.3,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 10,
  },

  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  note: { color: colors.faint, fontSize: 12, lineHeight: 18 },
  mono: { color: colors.ink, fontFamily: "monospace", fontSize: 12 },

  btn: {
    backgroundColor: colors.gold,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnPressed: { opacity: 0.85 },
  btnText: { color: "#16130a", fontWeight: "700", fontSize: 16 },
  btnGhost: {
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  btnGhostText: { color: colors.ink, fontWeight: "600", fontSize: 14.5 },
  // On paper a faded button reads as broken rather than unavailable, so a
  // disabled one changes colour instead of going transparent.
  btnDisabled: { backgroundColor: colors.surface2, borderColor: colors.line, borderWidth: 1 },
  btnTextDisabled: { color: colors.faint },

  optRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  optOn: { borderColor: colors.goldInk, backgroundColor: "#fff4d6" },
  optText: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  optTextOn: { color: colors.goldInk },

  /* "Protected by MagicBlock", and what it opens */
  guardBar: {
    marginTop: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  guardDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.good },
  guardText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  guardMore: { color: colors.goldInk, fontSize: 13, fontWeight: "700" },

  /* The fairness sheet fills the screen exactly - no scrolling, because a
     promise you have to scroll for is one nobody reads. */
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 62,
    paddingHorizontal: 22,
    paddingBottom: 30,
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginBottom: 5,
  },
  sheetLead: { color: colors.muted, fontSize: 13.5, lineHeight: 19 },

  guarantees: { flex: 1, justifyContent: "space-evenly", paddingVertical: 6 },
  guarantee: { gap: 4 },

  /* The badge names the thing doing the work, and its colour groups them -
     the two promises kept by the same draw wear the same badge, which is the
     point rather than decoration. */
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
  },
  badgeText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.8 },

  badgeRollup: { backgroundColor: "#efe9ff" },
  badgeRollupText: { color: "#4b3a9c" },
  badgeRandom: { backgroundColor: "#fff1d4" },
  badgeRandomText: { color: "#8a5a00" },
  badgeSolana: { backgroundColor: "#e4f5ea" },
  badgeSolanaText: { color: "#15703a" },
  badgeChain: { backgroundColor: "#e6f0fb" },
  badgeChainText: { color: "#1f5c99" },
  badgeKeys: { backgroundColor: "#fdeade" },
  badgeKeysText: { color: "#9a4a1c" },

  guaranteeHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  guaranteeTick: { color: colors.good, fontSize: 13, fontWeight: "800" },
  guaranteeTitle: { color: colors.ink, fontSize: 15.5, fontWeight: "700", letterSpacing: -0.2, flex: 1 },
  guaranteeBody: { color: colors.muted, fontSize: 12.5, lineHeight: 17 },

  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 22,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  disconnect: {
    color: colors.faint,
    fontSize: 12.5,
    fontWeight: "600",
    marginLeft: "auto",
  },

  potBig: {
    color: colors.goldInk,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1,
    marginVertical: 2,
  },
  lastWord: {
    color: colors.ink,
    fontSize: 14.5,
    fontWeight: "600",
    marginLeft: "auto",
  },

  pickRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  pick: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  pickOn: { borderColor: colors.goldInk, backgroundColor: "#fff4d6" },
  pickTitle: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  pickTitleOn: { color: colors.goldInk },
  pickBlurb: { color: colors.faint, fontSize: 12, lineHeight: 17 },

  input: {
    color: colors.ink,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
  },
  inputBig: { fontSize: 22, fontWeight: "600" },

  /* round */
  roundBar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  chip: {
    color: colors.ink,
    fontSize: 11.5,
    fontWeight: "600",
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },
  pot: { color: colors.goldInk, fontSize: 13, fontWeight: "700", marginLeft: "auto" },

  timerTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, marginBottom: 26 },
  timerFill: { height: 6, borderRadius: 3, backgroundColor: colors.gold },
  timerLow: { backgroundColor: colors.bad },

  question: {
    color: colors.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 22,
  },

  sealed: { alignItems: "center", gap: 8 },
  sealedWord: { color: colors.goldInk, fontSize: 24, fontWeight: "700" },

  seatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 11,
  },
  seatDone: { borderColor: "#c3e0cb" },
  seatOut: { opacity: 0.45 },
  seatName: { flex: 1, color: colors.muted, fontSize: 13.5 },
  seatStatus: { fontSize: 12, color: colors.faint },
  seatStatusDone: { color: colors.good },
  seatStatusOut: { color: colors.bad },

  av: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avText: { color: "#16181d", fontSize: 11, fontWeight: "800" },

  /* reveal */
  big: { color: colors.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  ruleLine: { color: colors.goldInk, fontSize: 18, fontWeight: "700" },
  groupWord: { color: colors.ink, fontSize: 20, fontWeight: "700" },

  /* misc */
  err: { color: "#8c3520", fontSize: 13, lineHeight: 19 },
  errTitle: { color: "#8c3520", fontSize: 14, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
});

/** A stable colour for a public key, so a player looks the same all game. */
export function tint(key: string): string {
  // Pale enough to carry dark initials on paper, saturated enough to tell six
  // players apart at a glance.
  const palette = ["#ffd88a", "#a8dcb4", "#a9cdf5", "#f3b6cd", "#cfbaf0", "#f8c49a"];
  let n = 0;
  for (const c of key.slice(0, 8)) n += c.charCodeAt(0);
  return palette[n % palette.length];
}

export const shortKey = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

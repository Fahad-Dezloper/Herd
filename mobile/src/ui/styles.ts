/** One palette, so the screens cannot drift apart. */

import { StyleSheet } from "react-native";

/**
 * Near-black with a green cast, and one loud lime.
 *
 * The lime is the only saturated colour in the app and it means "this is the
 * thing to press" - spending it anywhere else would cost it that meaning. Red
 * appears exactly once, on whoever just went out. Everything else is a neutral
 * mixed toward the same green so the dark surfaces sit under the lime instead
 * of fighting it.
 */
export const colors = {
  bg: "#0c0f0b",
  surface: "#171b14",
  surface2: "#1f241a",
  line: "#2a3122",
  lineStrong: "#3d462f",
  ink: "#f1f4ec",
  muted: "#98a08e",
  faint: "#6b7362",

  lime: "#c9f24a",
  limeInk: "#0d1408",
  limeDim: "#3c4a1c",

  /** The question card. Paper in a dark room is the thing you look at. */
  paper: "#f4efe1",
  paperInk: "#14170e",

  bad: "#f2603c",
  badDim: "#3a1a12",
};

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 18, paddingTop: 54, paddingBottom: 40, flexGrow: 1 },

  /* ------------------------------------------------------------- brand */

  brand: { alignItems: "center", marginBottom: 6 },
  wordmark: {
    color: colors.lime,
    fontSize: 62,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: -2.5,
    lineHeight: 68,
  },
  wordmarkSm: {
    color: colors.lime,
    fontSize: 26,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: -1,
  },
  tagline: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginTop: 2,
  },
  flock: { fontSize: 34, letterSpacing: -6, marginTop: 10, marginBottom: 4 },

  /* -------------------------------------------------------------- text */

  h1: { color: colors.ink, fontSize: 25, fontWeight: "800", letterSpacing: -0.6 },
  h2: { color: colors.ink, fontSize: 19, fontWeight: "700", letterSpacing: -0.3 },
  lead: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  leadStrong: { color: colors.ink, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 13.5, lineHeight: 20 },
  note: { color: colors.faint, fontSize: 11.5, lineHeight: 17 },
  mono: { color: colors.ink, fontFamily: "monospace", fontSize: 11.5 },

  section: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 9,
  },

  /* ------------------------------------------------------------- cards */

  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardBad: { backgroundColor: colors.badDim, borderColor: "#5c2a1c" },
  cardGood: { backgroundColor: "#1b2411", borderColor: colors.limeDim },
  cardGold: { backgroundColor: "#1b2411", borderColor: colors.limeDim },

  /* A row of label/value pairs, split by a hairline. */
  split: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  splitCell: { flex: 1, padding: 14, gap: 3 },
  splitDivide: { borderLeftWidth: 1, borderLeftColor: colors.line },
  splitLabel: { color: colors.faint, fontSize: 11, fontWeight: "600" },
  splitValue: { color: colors.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.5 },

  /* ----------------------------------------------------------- buttons */

  btn: {
    backgroundColor: colors.lime,
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPressed: { opacity: 0.85 },
  btnText: { color: colors.limeInk, fontWeight: "800", fontSize: 16.5, letterSpacing: 0.2 },
  btnGhost: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { color: colors.ink, fontWeight: "700", fontSize: 14.5 },
  btnDisabled: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  btnTextDisabled: { color: colors.faint },

  /* ------------------------------------------------------------ inputs */

  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: colors.ink,
    fontSize: 15,
  },
  inputBig: { fontSize: 20, fontWeight: "700" },

  /* -------------------------------------------------- round furniture */

  roundBar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  chip: {
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: "700",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
    overflow: "hidden",
  },
  pot: { color: colors.lime, fontSize: 13, fontWeight: "800", marginLeft: "auto" },

  /* Round pips, the way the reference counts them out. */
  pips: { flexDirection: "row", gap: 5, alignItems: "center" },
  pip: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  pipOn: { backgroundColor: colors.lime },
  pipNow: { backgroundColor: colors.lime, width: 18 },

  /* The clock is a pill, not a bar - it reads at a glance from across a room. */
  clock: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.limeDim,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginBottom: 16,
  },
  clockText: {
    color: colors.lime,
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  clockLow: { borderColor: "#5c2a1c" },
  clockTextLow: { color: colors.bad },

  /* The question, on paper. */
  paperCard: {
    backgroundColor: colors.paper,
    borderRadius: 6,
    paddingVertical: 30,
    paddingHorizontal: 22,
    marginBottom: 16,
    transform: [{ rotate: "-0.6deg" }],
  },
  question: {
    color: colors.paperInk,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "800",
    letterSpacing: -0.6,
    textAlign: "center",
  },

  sealed: { alignItems: "center", gap: 8 },
  sealedWord: { color: colors.lime, fontSize: 26, fontWeight: "800" },

  /* ----------------------------------------------------------- answers */

  optRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  optOn: { borderColor: colors.lime, backgroundColor: colors.limeDim },
  optText: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  optTextOn: { color: colors.lime },

  /* The two endings, offered as a pair so the choice reads as a fork. */
  pickRow: { flexDirection: "row", gap: 10, marginBottom: 9 },
  pick: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  pickOn: { borderColor: colors.lime, backgroundColor: colors.limeDim },
  pickTitle: { color: colors.muted, fontSize: 15, fontWeight: "800" },
  pickTitleOn: { color: colors.lime },
  pickBlurb: { color: colors.faint, fontSize: 11.5, lineHeight: 16 },

  lastWord: { color: colors.ink, fontSize: 14, fontWeight: "700", marginLeft: "auto" },

  /* ------------------------------------------------------------- seats */

  seatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
  },
  seatDone: { borderColor: colors.limeDim },
  seatOut: { opacity: 0.4 },
  seatName: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "600" },
  seatStatus: { fontSize: 11.5, color: colors.faint, fontWeight: "600" },
  seatStatusDone: { color: colors.lime },
  seatStatusOut: { color: colors.bad },

  /* Avatars carry a ring, so a face reads as a player rather than a dot. */
  av: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  avText: { color: colors.ink, fontWeight: "800" },
  avStack: { alignItems: "center", gap: 5 },
  avName: { color: colors.muted, fontSize: 10.5, fontWeight: "600" },

  /* ------------------------------------------------------------ reveal */

  groupWord: { color: colors.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  tag: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1,
    overflow: "hidden",
  },
  tagHerd: { backgroundColor: colors.lime, color: colors.limeInk },
  tagOut: { backgroundColor: colors.bad, color: "#1c0d08" },
  ruleLine: { color: colors.lime, fontSize: 16, fontWeight: "800" },
  big: { color: colors.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },

  /* ----------------------------------------------------------- victory */

  crown: { fontSize: 40, textAlign: "center" },
  champion: {
    color: colors.lime,
    fontSize: 30,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: -1,
    textAlign: "center",
  },
  ribbon: {
    alignSelf: "center",
    backgroundColor: colors.lime,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  ribbonText: { color: colors.limeInk, fontSize: 17, fontWeight: "800" },
  potBig: {
    color: colors.ink,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: -1.5,
    textAlign: "center",
  },

  recapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  recapN: { color: colors.faint, fontSize: 11, fontWeight: "800", width: 26 },
  recapQ: { flex: 1, color: colors.muted, fontSize: 12.5 },
  recapCount: { color: colors.ink, fontSize: 12.5, fontWeight: "700" },

  /* -------------------------------------------------- fairness & chrome */

  guardBar: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  guardDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.lime },
  guardText: { color: colors.muted, fontSize: 12.5, fontWeight: "700" },
  guardMore: { color: colors.lime, fontSize: 12.5, fontWeight: "800" },

  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 58,
    paddingHorizontal: 20,
    paddingBottom: 28,
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginBottom: 5,
  },
  sheetLead: { color: colors.muted, fontSize: 13, lineHeight: 19 },

  guarantees: { flex: 1, justifyContent: "space-evenly", paddingVertical: 6 },
  guarantee: { gap: 4 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
  badgeText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.8 },

  badgeRollup: { backgroundColor: "#241d3d" },
  badgeRollupText: { color: "#b9a9ff" },
  badgeRandom: { backgroundColor: "#2b2a12" },
  badgeRandomText: { color: colors.lime },
  badgeSolana: { backgroundColor: "#12291f" },
  badgeSolanaText: { color: "#5fd39a" },
  badgeChain: { backgroundColor: "#13243a" },
  badgeChainText: { color: "#7bb6f0" },
  badgeKeys: { backgroundColor: "#2f2113" },
  badgeKeysText: { color: "#e8a765" },

  guaranteeHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  guaranteeTick: { color: colors.lime, fontSize: 13, fontWeight: "800" },
  guaranteeTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
    flex: 1,
  },
  guaranteeBody: { color: colors.muted, fontSize: 12.5, lineHeight: 17 },

  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  disconnect: { color: colors.faint, fontSize: 12.5, fontWeight: "700", marginLeft: "auto" },

  /* --------------------------------------------------------- matchmaking */

  ring: { alignItems: "center", justifyContent: "center", alignSelf: "center" },
  ringCore: { position: "absolute", alignItems: "center", gap: 2 },
  ringCount: { color: colors.ink, fontSize: 32, fontWeight: "900", letterSpacing: -1 },
  ringLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },

  err: { color: "#f3b6a4", fontSize: 13, lineHeight: 19 },
  errTitle: { color: "#f3b6a4", fontSize: 14, fontWeight: "800" },
});

/**
 * A player's colour, from their key.
 *
 * Saturated enough to tell six people apart at a glance on a near-black ground,
 * and none of them lime - that one belongs to the buttons.
 */
export function tint(key: string): string {
  const palette = ["#f2a33c", "#5db8f0", "#e86f9e", "#a98cf5", "#5fd39a", "#f2603c"];
  let n = 0;
  for (const c of key.slice(0, 8)) n += c.charCodeAt(0);
  return palette[n % palette.length];
}

export const shortKey = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

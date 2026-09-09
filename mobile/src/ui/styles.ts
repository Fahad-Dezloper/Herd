/** One palette, so the screens cannot drift apart. */

import { StyleSheet } from "react-native";

export const colors = {
  bg: "#0b0e13",
  surface: "#151a22",
  surface2: "#1c232d",
  line: "#252d39",
  lineStrong: "#33404f",
  ink: "#eef2f6",
  muted: "#8b97a8",
  faint: "#5f6b7c",
  gold: "#ffcf3d",
  good: "#4ade80",
  bad: "#f87171",
};

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 44, flexGrow: 1 },

  brand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 },
  mark: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.gold },
  title: { color: colors.ink, fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  tagline: { color: colors.faint, fontSize: 12.5, marginTop: 2 },

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
  cardBad: { backgroundColor: "#1e1414", borderColor: "#4a2b2b" },
  cardGood: { backgroundColor: "#131e18", borderColor: "#2f4438" },
  cardGold: { backgroundColor: "#1c1810", borderColor: "#4a3f1f" },

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
  btnDisabled: { opacity: 0.4 },

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
  pickOn: { borderColor: colors.gold, backgroundColor: "#1c1810" },
  pickTitle: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  pickTitleOn: { color: colors.gold },
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
  pot: { color: colors.gold, fontSize: 13, fontWeight: "700", marginLeft: "auto" },

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
  sealedWord: { color: colors.gold, fontSize: 24, fontWeight: "700" },

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
  seatDone: { borderColor: "#2f4438" },
  seatOut: { opacity: 0.4 },
  seatName: { flex: 1, color: colors.muted, fontSize: 13.5 },
  seatStatus: { fontSize: 12, color: colors.faint },
  seatStatusDone: { color: colors.good },
  seatStatusOut: { color: colors.bad },

  av: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avText: { color: "#0b0e13", fontSize: 11, fontWeight: "800" },

  /* reveal */
  big: { color: colors.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  ruleLine: { color: colors.gold, fontSize: 18, fontWeight: "700" },
  groupWord: { color: colors.good, fontSize: 20, fontWeight: "700" },

  /* misc */
  err: { color: "#f0b8a6", fontSize: 13, lineHeight: 19 },
  errTitle: { color: "#f0b8a6", fontSize: 14, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
});

/** A stable colour for a public key, so a player looks the same all game. */
export function tint(key: string): string {
  const palette = ["#ffcf3d", "#4ade80", "#60a5fa", "#f472b6", "#c084fc", "#fb923c"];
  let n = 0;
  for (const c of key.slice(0, 8)) n += c.charCodeAt(0);
  return palette[n % palette.length];
}

export const shortKey = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

/**
 * The whole design system, in one place you can edit.
 *
 * Colours are named for what they do rather than what they are - `bg-surface`
 * survives a change of mind about which green, where `bg-[#171b14]` scattered
 * through nine files does not. The lime is the only saturated colour in the
 * app and it means "press this"; spending it elsewhere costs it that meaning.
 */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: "#0c0f0b",
        surface: "#171b14",
        surface2: "#1f241a",
        line: "#2a3122",
        "line-strong": "#3d462f",
        ink: "#f1f4ec",
        muted: "#98a08e",
        faint: "#6b7362",

        lime: "#c9f24a",
        "lime-ink": "#0d1408",
        "lime-dim": "#3c4a1c",

        /** The question card. Paper in a dark room is what you look at. */
        paper: "#f4efe1",
        "paper-ink": "#14170e",

        bad: "#f2603c",
        "bad-dim": "#3a1a12",
        "bad-line": "#5c2a1c",
        "bad-ink": "#f3b6a4",
      },
      borderRadius: {
        card: "18px",
        field: "14px",
        paper: "6px",
      },
      fontSize: {
        micro: ["10.5px", "15px"],
        note: ["11.5px", "17px"],
        body: ["13.5px", "20px"],
        lead: ["15px", "22px"],
      },
    },
  },
  plugins: [],
};

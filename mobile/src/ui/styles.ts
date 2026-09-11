/**
 * What is left once Tailwind owns the styling.
 *
 * Two kinds of thing cannot be a class: a colour computed from a player's key,
 * and the handful of props React Native takes as raw colour values rather than
 * styles - a placeholder tint, a spinner, the status bar. Those read from here,
 * and the values must match `tailwind.config.js`.
 */

export const colors = {
  bg: "#0c0f0b",
  surface: "#171b14",
  surface2: "#1f241a",
  line: "#2a3122",
  ink: "#f1f4ec",
  muted: "#98a08e",
  faint: "#6b7362",
  lime: "#c9f24a",
  limeInk: "#0d1408",
  bad: "#f2603c",
};

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

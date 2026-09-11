/**
 * The one button in the app.
 *
 * Two shapes only: lime means "this is the thing to press", and the ghost is
 * everything else. A third would start a conversation about which is which.
 */

import { Pressable, Text } from "react-native";

export function Button({
  label,
  onPress,
  disabled,
  ghost,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  ghost?: boolean;
}) {
  const base = "rounded-full items-center justify-center active:opacity-80";
  const shape = ghost
    ? "bg-surface2 border border-line py-[15px]"
    : "bg-lime py-[17px]";
  // A faded button reads as broken; a disabled one should read as unavailable.
  const off = disabled ? "bg-surface2 border border-line" : "";

  return (
    <Pressable
      className={`${base} ${shape} ${off}`}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text
        className={
          disabled
            ? "text-faint font-bold text-[15px]"
            : ghost
              ? "text-ink font-bold text-[14.5px]"
              : "text-lime-ink font-extrabold text-[16.5px] tracking-wide"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

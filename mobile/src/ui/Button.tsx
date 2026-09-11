/**
 * The one button in the app.
 *
 * It lives here rather than in App.tsx because every screen needs it, and
 * importing it from the root made each screen part of a require cycle - React
 * Native permits those but warns that they can leave a value uninitialised,
 * which for a component means rendering nothing with no error.
 */

import { Pressable, Text } from "react-native";

import { s } from "./styles";

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
  return (
    <Pressable
      style={({ pressed }) => [
        ghost ? s.btnGhost : s.btn,
        pressed && s.btnPressed,
        disabled && s.btnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[ghost ? s.btnGhostText : s.btnText, disabled && s.btnTextDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Small shared UI primitives + palette (plain StyleSheet, dark-on-light).
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import type { ErrandStatus } from "@nova26/shared";

export const C = {
  bg: "#f4f5f7",
  card: "#ffffff",
  text: "#111827",
  muted: "#6b7280",
  border: "#e5e7eb",
  primary: "#2563eb",
  primaryText: "#ffffff",
  green: "#16a34a",
  greenBg: "#dcfce7",
  amber: "#b45309",
  amberBg: "#fef3c7",
  red: "#dc2626",
  redBg: "#fee2e2",
  blueBg: "#dbeafe",
  gray: "#9ca3af",
  grayBg: "#f3f4f6",
};

const STATUS_COLORS: Record<ErrandStatus, [string, string]> = {
  draft: [C.muted, C.grayBg],
  ready: [C.primary, C.blueBg],
  running: [C.amber, C.amberBg],
  needs_input: [C.red, C.redBg],
  done: [C.green, C.greenBg],
  failed: [C.red, C.redBg],
};

export function StatusPill({ status }: { status: ErrandStatus }) {
  const [fg, bg] = STATUS_COLORS[status] ?? [C.muted, C.grayBg];
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: fg }]}>{status.replace("_", " ")}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  kind = "primary",
  loading,
  style,
  big,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "danger" | "success";
  loading?: boolean;
  style?: ViewStyle;
  big?: boolean;
}) {
  const bg =
    kind === "primary" ? C.primary : kind === "danger" ? C.red : kind === "success" ? C.green : C.card;
  const fg = kind === "secondary" ? C.text : C.primaryText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        big && s.btnBig,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        kind === "secondary" && { borderWidth: 1, borderColor: C.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.btnText, big && s.btnTextBig, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[s.card, style as ViewStyle]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}

const s = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  pillText: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnBig: { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 12 },
  btnText: { fontSize: 15, fontWeight: "600" },
  btnTextBig: { fontSize: 19, fontWeight: "700" },
  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  section: { fontSize: 13, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
});

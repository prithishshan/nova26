// Hero-flow design primitives: soft background, white cards, one accent color.
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View, ViewStyle, TextStyle } from "react-native";

export const T = {
  bg: "#f3f5f9",
  card: "#ffffff",
  text: "#0f172a",
  sub: "#475569",
  muted: "#94a3b8",
  line: "#e6eaf0",
  accent: "#4f46e5",
  accentSoft: "#eef2ff",
  accentText: "#ffffff",
  green: "#15803d",
  greenSoft: "#ecfdf3",
  amber: "#b45309",
  amberSoft: "#fff7e6",
  red: "#b91c1c",
  redSoft: "#fef2f2",
  radius: 20,
};

export const shadow: ViewStyle = {
  shadowColor: "#0f172a",
  shadowOpacity: 0.07,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
};

export function money(n: number | undefined | null): string {
  const v = Number(n) || 0;
  const neg = v < 0;
  const [i, d] = Math.abs(v).toFixed(2).split(".");
  const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${withCommas}.${d}`;
}

export function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Run fn but make sure at least `ms` elapses (so short animations are visible). */
export async function atLeast<R>(ms: number, fn: () => Promise<R>): Promise<R> {
  const [r] = await Promise.all([fn(), wait(ms)]);
  return r;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle | (ViewStyle | false | undefined)[] }) {
  return <View style={[s.card, ...(Array.isArray(style) ? style : [style])]}>{children}</View>;
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  kind = "primary",
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  kind?: "primary" | "ghost";
  style?: ViewStyle;
}) {
  const primary = kind === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        primary ? s.btnPrimary : s.btnGhost,
        { opacity: disabled ? 0.4 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? T.accentText : T.accent} />
      ) : (
        <Text style={[s.btnText, { color: primary ? T.accentText : T.accent }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function H1({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}
export function Lead({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.lead, style]}>{children}</Text>;
}
export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Dots({ count, active }: { count: number; active: number }) {
  return (
    <View style={s.dots}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[s.dot, i === active ? s.dotActive : i < active ? s.dotDone : null]}
        />
      ))}
    </View>
  );
}

/** Three softly pulsing dots — calm "working" indicator. */
export function Pulse({ color = T.accent, size = 10 }: { color?: string; size?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ flexDirection: "row", gap: size * 0.7 }}>
      {[0, 1, 2].map((i) => {
        const start = i / 3;
        const opacity = v.interpolate({
          inputRange: [0, start, Math.min(start + 0.33, 1), 1],
          outputRange: [0.25, 0.25, 1, 0.25],
          extrapolate: "clamp",
        });
        return (
          <Animated.View
            key={i}
            style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }}
          />
        );
      })}
    </View>
  );
}

/** Simple padlock drawn with Views (no icon libraries / logos). */
export function LockIcon({ size = 28, color = T.accent }: { size?: number; color?: string }) {
  const w = size;
  return (
    <View style={{ width: w, height: w * 1.15, alignItems: "center" }}>
      <View
        style={{
          width: w * 0.62,
          height: w * 0.55,
          borderWidth: w * 0.11,
          borderColor: color,
          borderBottomWidth: 0,
          borderTopLeftRadius: w * 0.31,
          borderTopRightRadius: w * 0.31,
        }}
      />
      <View
        style={{
          width: w,
          height: w * 0.62,
          backgroundColor: color,
          borderRadius: w * 0.16,
          marginTop: -w * 0.02,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: w * 0.14, height: w * 0.24, borderRadius: w * 0.07, backgroundColor: "#fff" }} />
      </View>
    </View>
  );
}

export function Check({ size = 28, color = T.green }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: size * 0.6, lineHeight: size * 0.75 }}>✓</Text>
    </View>
  );
}

export function Badge({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={s.err}>
      <Text style={s.errText}>Something went wrong. {text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.card, borderRadius: T.radius, padding: 20, marginBottom: 14, ...shadow },
  btn: { borderRadius: 16, paddingVertical: 18, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", minHeight: 60 },
  btnPrimary: { backgroundColor: T.accent, ...shadow, shadowColor: T.accent, shadowOpacity: 0.25 },
  btnGhost: { backgroundColor: T.accentSoft },
  btnText: { fontSize: 19, fontWeight: "700", letterSpacing: 0.2 },
  h1: { fontSize: 32, lineHeight: 39, fontWeight: "800", color: T.text, letterSpacing: -0.6 },
  lead: { fontSize: 18, lineHeight: 27, color: T.sub, marginTop: 10 },
  label: { fontSize: 13, fontWeight: "700", color: T.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  dots: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.line },
  dotDone: { backgroundColor: "#c7d2fe" },
  dotActive: { width: 22, backgroundColor: T.accent },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  badgeText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
  err: { backgroundColor: T.redSoft, borderRadius: 14, padding: 14, marginBottom: 14 },
  errText: { color: T.red, fontSize: 15, lineHeight: 21 },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { API_URL, Health } from "../api";
import { C } from "../ui";

export function HealthBar({ health, error }: { health: Health | null; error: string | null }) {
  let color = C.gray;
  let text = "Checking server…";
  if (error) {
    color = C.red;
    text = `Server unreachable at ${API_URL}`;
  } else if (health) {
    const missing: string[] = [];
    if (!health.hasOpenRouterKey) missing.push("OPENROUTER key");
    if (health.callMode && health.callMode !== "sim" && !health.hasTwilio) missing.push("Twilio");
    color = missing.length ? C.amber : C.green;
    text =
      `Connected · calls: ${health.callMode ?? "?"}` +
      (health.publicUrl ? ` · ${health.publicUrl}` : "") +
      (missing.length ? ` · missing: ${missing.join(", ")}` : "");
  }
  return (
    <View style={s.bar}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={s.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { fontSize: 13, color: C.muted, flexShrink: 1 },
});

// Intake: chat on the left, live Errand card on the right (stacked on narrow screens).
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type { ChatMessage, Errand } from "@nova26/shared";
import { api } from "../api";
import { ErrandCard } from "../components/ErrandCard";
import { confirm } from "../confirm";
import { Button, C } from "../ui";

export function Intake({
  errandId: initialId,
  onRun,
}: {
  errandId?: string;
  onRun: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [errand, setErrand] = useState<Errand | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    if (!initialId) return;
    api
      .getErrand(initialId)
      .then(({ errand, messages }) => {
        setErrand(errand);
        setMessages(messages ?? []);
      })
      .catch((e) => setError(e.message));
  }, [initialId]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    // optimistic user bubble
    setMessages((m) => [...m, { role: "user", text, at: new Date().toISOString() }]);
    try {
      const res = await api.intake(text, errand?.id);
      setErrand(res.errand);
      setMessages(
        res.messages?.length ? res.messages : (m) => [...m, { role: "agent", text: res.reply, at: new Date().toISOString() }],
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const patch = async (p: Partial<Errand>) => {
    if (!errand) return;
    setErrand({ ...errand, ...p }); // optimistic
    try {
      const res = await api.patchErrand(errand.id, p);
      setErrand(res.errand);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const run = async () => {
    if (!errand) return;
    if (errand.status !== "ready") {
      const ok = await confirm(
        "Errand not marked ready",
        errand.missingInfo.length
          ? `Still missing: ${errand.missingInfo.join("; ")}. Run anyway?`
          : `Status is "${errand.status}". Run anyway?`,
      );
      if (!ok) return;
    }
    setRunning(true);
    try {
      await api.run(errand.id);
      onRun(errand.id);
    } catch (e: any) {
      setError(e.message);
      setRunning(false);
    }
  };

  const chat = (
    <View style={[s.chatPane, wide ? { flex: 1 } : { minHeight: 380 }]}>
      <ScrollView
        ref={scrollRef}
        style={s.thread}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <Text style={s.hint}>
            Describe your errand in your own words — what you need done, by when, for whom, and anything to avoid.
            {"\n\n"}e.g. “Find my mom a dentist near Shadyside who takes Delta Dental, Tuesday or Thursday afternoon
            next week. Check with me before booking.”
          </Text>
        )}
        {messages.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === "user" ? s.userBubble : s.agentBubble]}>
            <Text style={[s.bubbleText, m.role === "user" && { color: "#fff" }]}>{m.text}</Text>
          </View>
        ))}
        {sending && (
          <View style={[s.bubble, s.agentBubble]}>
            <ActivityIndicator />
          </View>
        )}
      </ScrollView>
      <View style={s.inputRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={errand ? "Add details or answer…" : "What do you need done?"}
          style={s.input}
          multiline
          onKeyPress={(e: any) => {
            // Enter sends on web; Shift+Enter for newline
            if (Platform.OS === "web" && e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              send();
            }
          }}
        />
        <Button title="Send" onPress={send} disabled={!input.trim()} loading={sending} />
      </View>
    </View>
  );

  const card = errand ? (
    <View>
      <ErrandCard errand={errand} onPatch={patch} />
      <Button
        title={errand.status === "ready" ? "▶  Run errand" : "▶  Run errand (not ready)"}
        kind={errand.status === "ready" ? "success" : "secondary"}
        onPress={run}
        loading={running}
        big
      />
    </View>
  ) : (
    <View style={s.placeholder}>
      <Text style={s.hint}>The structured errand will appear here as you chat.</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {error && <Text style={s.error}>{error}</Text>}
      {wide ? (
        <View style={s.wide}>
          {chat}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
            {card}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }}>
          {chat}
          {card}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wide: { flex: 1, flexDirection: "row", gap: 16, padding: 16 },
  chatPane: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  thread: { flex: 1 },
  hint: { color: C.muted, fontSize: 16, lineHeight: 23 },
  bubble: { maxWidth: "85%", padding: 12, borderRadius: 14 },
  userBubble: { alignSelf: "flex-end", backgroundColor: C.primary, borderBottomRightRadius: 4 },
  agentBubble: { alignSelf: "flex-start", backgroundColor: C.grayBg, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 16, color: C.text, lineHeight: 22 },
  inputRow: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.border, alignItems: "flex-end" },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: C.text,
  },
  placeholder: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: C.border,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
  },
  error: { color: C.red, backgroundColor: C.redBg, padding: 8, margin: 8, borderRadius: 6 },
});

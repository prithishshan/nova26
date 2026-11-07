// Hero step 6: live payer call. Polls GET /errands/:id/events?after=<seq> every 1s.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ScrollViewInstance } from "react-native";
import type { CallStatus, Errand, ErrandEvent } from "@nova26/shared";
import { api, Health } from "../api";
import { Card, Check, PrimaryButton, Pulse, shadow, T } from "./theme";

const STEPS: { key: CallStatus; label: string }[] = [
  { key: "dialing", label: "Dialing" },
  { key: "ringing", label: "Ringing" },
  { key: "in_progress", label: "In progress" },
  { key: "on_hold_for_user", label: "On hold for you" },
  { key: "completed", label: "Completed" },
];
const TERMINAL: CallStatus[] = ["completed", "failed", "no_answer"];

type Relay = { id: number; text: string; afterSeq: number; failed?: boolean };
type Q = { id: string; text: string; options?: string[] };

export function LiveCall({
  errandId,
  health,
  payer,
  onDone,
}: {
  errandId: string;
  health: Health | null;
  payer: string;
  onDone: () => void;
}) {
  const [errand, setErrand] = useState<Errand | null>(null);
  const [events, setEvents] = useState<ErrandEvent[]>([]);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [relays, setRelays] = useState<Relay[]>([]);
  const lastSeq = useRef(0);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    lastSeq.current = 0;
    setEvents([]);
    const tick = async () => {
      try {
        const res = await api.events(errandId, lastSeq.current);
        if (!alive) return;
        setErrand(res.errand);
        const fresh = (res.events ?? []).filter((e) => e.seq > lastSeq.current);
        if (fresh.length) {
          lastSeq.current = Math.max(...fresh.map((e) => e.seq));
          setEvents((prev) => [...prev, ...fresh]);
        }
        setPollErr(null);
      } catch (e: any) {
        if (alive) setPollErr(String(e?.message || e));
      }
      if (alive) timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [errandId]);

  const d = useMemo(() => {
    let callId: string | null = null;
    let status: CallStatus | null = null;
    let to = "";
    const answered = new Set<string>();
    let question: Q | undefined;
    let result: { outcome: string; details?: string } | undefined;
    const bubbles: { seq: number; speaker: "agent" | "callee"; text: string }[] = [];
    let lastAgentSeq = 0;
    for (const e of events) {
      if (e.type === "call_status") {
        callId = e.callId || callId;
        status = e.status;
        to = e.to || to;
      } else if (e.type === "transcript") {
        callId = callId || e.callId;
        if (!status) status = "in_progress";
        bubbles.push({ seq: e.seq, speaker: e.speaker, text: e.text });
        if (e.speaker === "agent") lastAgentSeq = e.seq;
      } else if (e.type === "question") question = e.question;
      else if (e.type === "answer") answered.add(e.questionId);
      else if (e.type === "result") result = { outcome: e.outcome, details: e.details };
    }
    if (question && answered.has(question.id)) question = undefined;
    if (errand?.pendingQuestion && !answered.has(errand.pendingQuestion.id)) question = errand.pendingQuestion;
    if (errand?.result) result = errand.result;
    if (errand?.status === "failed" && !result) result = { outcome: "The call couldn't be completed.", details: undefined };
    const active = !!callId && !!status && !TERMINAL.includes(status) && !result;
    return { callId, status, to, question, result, bubbles, lastAgentSeq, active };
  }, [events, errand]);

  const sendRelay = async (text: string) => {
    if (!d.callId) return;
    const r: Relay = { id: Date.now(), text, afterSeq: lastSeq.current };
    setRelays((x) => [...x, r]);
    try {
      await api.relay(d.callId, text);
    } catch {
      setRelays((x) => x.map((y) => (y.id === r.id ? { ...y, failed: true } : y)));
    }
  };

  // merge relayed bubbles into the transcript timeline by the seq at which they were sent
  type Item =
    | { k: "t"; seq: number; speaker: "agent" | "callee"; text: string }
    | { k: "r"; seq: number; relay: Relay };
  const items: Item[] = [
    ...d.bubbles.map((b) => ({ k: "t" as const, ...b })),
    ...relays.map((r) => ({ k: "r" as const, seq: r.afterSeq + 0.5, relay: r })),
  ].sort((a, b) => a.seq - b.seq);

  const statusIdx = d.status ? STEPS.findIndex((s) => s.key === d.status) : -1;
  const failed = d.status === "failed" || d.status === "no_answer";
  const callee = `${payer || "Aetna"} Member Services`;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.top}>
        <View style={s.who}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(payer || "A").slice(0, 1)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.whoLabel}>Your agent is calling</Text>
            <Text style={s.whoName}>{callee}</Text>
          </View>
          {d.active && <View style={s.liveDot} />}
        </View>
        <View style={s.stepper}>
          {STEPS.map((st, i) => {
            const done = d.status === "completed" || (statusIdx >= 0 && i < statusIdx) || (i === 3 && statusIdx > 3);
            const now = i === statusIdx && d.status !== "completed";
            // "on hold for you" only lights if it actually happened
            const skipped = i === 3 && !events.some((e) => e.type === "call_status" && e.status === "on_hold_for_user");
            return (
              <View key={st.key} style={s.stepItem}>
                <View
                  style={[
                    s.stepDot,
                    done && !skipped && { backgroundColor: T.accent },
                    now && { backgroundColor: T.accent, transform: [{ scale: 1.35 }] },
                    failed && now && { backgroundColor: T.red },
                  ]}
                />
                <Text style={[s.stepLabel, (now || (done && !skipped)) && { color: T.text, fontWeight: "700" }]} numberOfLines={2}>
                  {st.label}
                </Text>
              </View>
            );
          })}
        </View>
        {failed && <Text style={s.failed}>{d.status === "no_answer" ? "No one answered." : "The call dropped."}</Text>}
        {pollErr && <Text style={s.pollErr}>Reconnecting… {pollErr}</Text>}
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {!items.length && !d.result && (
          <View style={s.waiting}>
            <Pulse />
            <Text style={s.waitingText}>{d.status ? "Connecting the call…" : "Getting ready to call…"}</Text>
          </View>
        )}
        {items.map((it) =>
          it.k === "t" ? (
            <View key={`t${it.seq}`} style={[s.bubbleWrap, it.speaker === "agent" ? s.right : s.left]}>
              <Text style={[s.speaker, it.speaker === "agent" && { textAlign: "right" }]}>
                {it.speaker === "agent" ? "Your agent" : payer || "Aetna"}
              </Text>
              <View style={[s.bubble, it.speaker === "agent" ? s.bAgent : s.bCallee]}>
                <Text style={[s.bText, it.speaker === "agent" && { color: "#fff" }]}>{it.text}</Text>
              </View>
            </View>
          ) : (
            <View key={`r${it.relay.id}`} style={[s.bubbleWrap, s.right]}>
              <Text style={[s.speaker, { textAlign: "right" }]}>
                You → your agent ·{" "}
                {it.relay.failed ? "couldn't send" : d.lastAgentSeq > it.relay.afterSeq ? "passed along" : "waiting for its turn"}
              </Text>
              <View style={[s.bubble, s.bRelay, it.relay.failed && { borderColor: T.red }]}>
                <Text style={[s.bText, { color: T.accent }]}>“{it.relay.text}”</Text>
              </View>
            </View>
          ),
        )}
        {!d.result && pollErr?.includes("404") && (
          <Card>
            <Text style={s.resultOutcome}>This call is no longer available.</Text>
            <Text style={s.resultDetails}>The server may have restarted. You can go back and start the call again.</Text>
            <PrimaryButton title="Back to my results" onPress={onDone} style={{ marginTop: 18 }} />
          </Card>
        )}
        {d.result && (
          <Card style={s.result}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Check />
              <Text style={s.resultKicker}>What happened</Text>
            </View>
            <Text style={s.resultOutcome}>{d.result.outcome}</Text>
            {d.result.details ? <Text style={s.resultDetails}>{d.result.details}</Text> : null}
            <PrimaryButton title="Done" onPress={onDone} style={{ marginTop: 18 }} />
          </Card>
        )}
      </ScrollView>

      {d.active && health?.callMode === "sim" && d.callId && <SimBox callId={d.callId} />}
      {d.active && d.callId && !d.question && <RelayBar onSend={sendRelay} />}
      {d.question && !d.result && <QuestionSheet errandId={errandId} q={d.question} payer={payer} />}
    </KeyboardAvoidingView>
  );
}

function RelayBar({ onSend }: { onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <View style={s.relayBar}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Tell your agent to say…"
        placeholderTextColor={T.muted}
        style={s.relayInput}
        onSubmitEditing={send}
        returnKeyType="send"
      />
      <Pressable onPress={send} style={({ pressed }) => [s.relaySend, { opacity: text.trim() ? (pressed ? 0.8 : 1) : 0.4 }]}>
        <Text style={s.relaySendText}>Say</Text>
      </Pressable>
    </View>
  );
}

function QuestionSheet({ errandId, q, payer }: { errandId: string; q: Q; payer: string }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setSent(null);
    setText("");
    setErr(null);
  }, [q.id]);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.answer(errandId, q.id, t.trim());
      setSent(t.trim());
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.sheet}>
      <View style={s.grabber} />
      <Text style={s.sheetKicker}>{payer || "Aetna"} is asking:</Text>
      <Text style={s.sheetQ}>{q.text}</Text>
      {sent ? (
        <View style={s.sentRow}>
          <Pulse size={7} color={T.green} />
          <Text style={s.sentText}>Sent “{sent}” — your agent is passing it along.</Text>
        </View>
      ) : (
        <>
          {!!q.options?.length && (
            <View style={s.opts}>
              {q.options.map((o) => (
                <Pressable
                  key={o}
                  disabled={busy}
                  onPress={() => send(o)}
                  style={({ pressed }) => [s.opt, { opacity: busy ? 0.5 : pressed ? 0.8 : 1 }]}
                >
                  <Text style={s.optText}>{o}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={[s.relayBar, { paddingHorizontal: 0, borderTopWidth: 0, backgroundColor: "transparent" }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Or type your answer…"
              placeholderTextColor={T.muted}
              style={s.relayInput}
              onSubmitEditing={() => send(text)}
              returnKeyType="send"
            />
            <Pressable onPress={() => send(text)} disabled={busy} style={[s.relaySend, { opacity: text.trim() ? 1 : 0.4 }]}>
              <Text style={s.relaySendText}>Send</Text>
            </Pressable>
          </View>
          {err && <Text style={s.pollErr}>{err}</Text>}
        </>
      )}
    </View>
  );
}

function SimBox({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      await api.simReply(callId, t.trim());
      if (t !== "[hangup]") setText("");
    } catch {
      // ignore in dev box
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.sim}>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8}>
        <Text style={s.simTitle}>{open ? "▾" : "▸"} Simulate Aetna rep (test mode)</Text>
      </Pressable>
      {open && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Rep says…"
            placeholderTextColor={T.muted}
            style={[s.relayInput, { paddingVertical: 8, fontSize: 15 }]}
            onSubmitEditing={() => send(text)}
          />
          <Pressable onPress={() => send(text)} disabled={busy} style={[s.simBtn]}>
            <Text style={s.simBtnText}>Send</Text>
          </Pressable>
          <Pressable onPress={() => send("[hangup]")} disabled={busy} style={[s.simBtn, { backgroundColor: T.red }]}>
            <Text style={s.simBtnText}>Hang up</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  top: { backgroundColor: T.card, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  who: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.accentSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontWeight: "800", color: T.accent },
  whoLabel: { fontSize: 14, color: T.sub },
  whoName: { fontSize: 20, fontWeight: "800", color: T.text },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#22c55e" },
  stepper: { flexDirection: "row", marginTop: 16 },
  stepItem: { flex: 1, alignItems: "center", gap: 6 },
  stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: T.line },
  stepLabel: { fontSize: 12, color: T.muted, textAlign: "center" },
  failed: { color: T.red, fontSize: 15, fontWeight: "700", marginTop: 10, textAlign: "center" },
  pollErr: { color: T.amber, fontSize: 13, marginTop: 6 },
  waiting: { alignItems: "center", gap: 14, paddingVertical: 40 },
  waitingText: { fontSize: 17, color: T.sub },
  bubbleWrap: { marginBottom: 12, maxWidth: "86%" },
  left: { alignSelf: "flex-start" },
  right: { alignSelf: "flex-end" },
  speaker: { fontSize: 12, fontWeight: "700", color: T.muted, marginBottom: 4, marginHorizontal: 6 },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bAgent: { backgroundColor: T.accent, borderBottomRightRadius: 6 },
  bCallee: { backgroundColor: T.card, borderBottomLeftRadius: 6, ...shadow },
  bRelay: { backgroundColor: T.accentSoft, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#a5b4fc", borderBottomRightRadius: 6 },
  bText: { fontSize: 18, lineHeight: 26, color: T.text },
  result: { marginTop: 8, borderWidth: 2, borderColor: "#bbf7d0" },
  resultKicker: { fontSize: 14, fontWeight: "800", color: T.green, letterSpacing: 1, textTransform: "uppercase" },
  resultOutcome: { fontSize: 22, fontWeight: "800", color: T.text, lineHeight: 30 },
  resultDetails: { fontSize: 17, color: T.sub, lineHeight: 25, marginTop: 8 },
  relayBar: { flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: T.card, borderTopWidth: 1, borderTopColor: T.line },
  relayInput: { flex: 1, backgroundColor: T.bg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: T.text },
  relaySend: { backgroundColor: T.accent, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  relaySendText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  sheet: {
    backgroundColor: T.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
    ...shadow,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
    borderTopWidth: 3,
    borderTopColor: T.accent,
  },
  grabber: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: T.line, marginBottom: 12 },
  sheetKicker: { fontSize: 15, fontWeight: "800", color: T.accent, letterSpacing: 0.5, marginBottom: 6 },
  sheetQ: { fontSize: 22, fontWeight: "800", color: T.text, lineHeight: 30 },
  opts: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  opt: { backgroundColor: T.accent, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14 },
  optText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  sentRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
  sentText: { fontSize: 16, color: T.green, fontWeight: "600", flex: 1 },
  sim: { marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: T.muted, backgroundColor: "#fafafa" },
  simTitle: { fontSize: 13, fontWeight: "700", color: T.sub },
  simBtn: { backgroundColor: T.sub, borderRadius: 10, paddingHorizontal: 12, justifyContent: "center" },
  simBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});

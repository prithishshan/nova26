// Live run screen: polls events every 1s and renders plan, calls, question, feed, result.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { CallStatus, Errand, ErrandEvent, PlanStep } from "@nova26/shared";
import { api, Health } from "../api";
import { Button, C, Card, SectionTitle, StatusPill } from "../ui";

type Call = {
  callId: string;
  to: string;
  status: CallStatus;
  transcript: { speaker: "agent" | "callee"; text: string; seq: number }[];
};

const TERMINAL: CallStatus[] = ["completed", "failed", "no_answer"];

export function Live({ errandId, health, onEdit }: { errandId: string; health: Health | null; onEdit: () => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [errand, setErrand] = useState<Errand | null>(null);
  const [events, setEvents] = useState<ErrandEvent[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const lastSeq = useRef(0);

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
        if (res.events?.length) {
          const fresh = res.events.filter((e) => e.seq > lastSeq.current);
          if (fresh.length) {
            lastSeq.current = Math.max(...fresh.map((e) => e.seq));
            setEvents((prev) => [...prev, ...fresh]);
          }
        }
        setPollError(null);
      } catch (e: any) {
        if (alive) setPollError(e.message);
      }
      if (alive) timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [errandId]);

  const derived = useMemo(() => {
    let plan: PlanStep[] = [];
    const calls = new Map<string, Call>();
    let lastCallId: string | null = null;
    const answered = new Set<string>();
    let question: { id: string; text: string; options?: string[] } | undefined;
    let result: { outcome: string; details?: string } | undefined;
    for (const e of events) {
      if (e.type === "plan") plan = e.plan;
      else if (e.type === "call_status") {
        const c = calls.get(e.callId) ?? { callId: e.callId, to: e.to, status: e.status, transcript: [] };
        c.status = e.status;
        c.to = e.to || c.to;
        calls.set(e.callId, c);
        lastCallId = e.callId;
      } else if (e.type === "transcript") {
        const c = calls.get(e.callId) ?? { callId: e.callId, to: "", status: "in_progress" as CallStatus, transcript: [] };
        c.transcript.push({ speaker: e.speaker, text: e.text, seq: e.seq });
        calls.set(e.callId, c);
        lastCallId = e.callId;
      } else if (e.type === "question") question = e.question;
      else if (e.type === "answer") answered.add(e.questionId);
      else if (e.type === "result") result = { outcome: e.outcome, details: e.details };
    }
    if (question && answered.has(question.id)) question = undefined;
    if (errand?.pendingQuestion && !answered.has(errand.pendingQuestion.id)) question = errand.pendingQuestion;
    if (errand?.plan?.length) plan = errand.plan;
    if (errand?.result) result = errand.result;
    const callList = [...calls.values()];
    const active = callList.find((c) => !TERMINAL.includes(c.status)) ?? null;
    const shown = active ?? (lastCallId ? calls.get(lastCallId)! : null);
    const feed = events.filter((e) => ["log", "web", "error", "question", "answer", "call_status", "result"].includes(e.type));
    return { plan, question, result, active, shown, callList, feed };
  }, [events, errand]);

  const left = (
    <>
      {derived.question && <QuestionCard errandId={errandId} q={derived.question} />}
      {derived.result && <ResultCard result={derived.result} />}
      {derived.shown && <CallPanel call={derived.shown} />}
      {derived.active && health?.callMode === "sim" && <SimCalleePanel call={derived.active} />}
      <PlanChecklist plan={derived.plan} />
    </>
  );
  const right = <ActivityFeed events={derived.feed} />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={2}>
            {errand?.summary || errand?.objective || "Loading…"}
          </Text>
          {pollError && <Text style={{ color: C.red }}>{pollError}</Text>}
        </View>
        {errand && <StatusPill status={errand.status} />}
        <Button title="Edit" kind="secondary" onPress={onEdit} />
      </View>
      {wide ? (
        <View style={{ flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: 16 }}>
          <ScrollView style={{ flex: 3 }} contentContainerStyle={{ paddingBottom: 40 }}>
            {left}
          </ScrollView>
          <ScrollView style={{ flex: 2 }} contentContainerStyle={{ paddingBottom: 40 }}>
            {right}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
          {left}
          {right}
        </ScrollView>
      )}
    </View>
  );
}

// ---------- Plan ----------
const STEP_ICON: Record<PlanStep["status"], string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✗",
  skipped: "–",
};
const STEP_COLOR: Record<PlanStep["status"], string> = {
  pending: C.gray,
  running: C.amber,
  done: C.green,
  failed: C.red,
  skipped: C.gray,
};
const KIND_ICON: Record<PlanStep["kind"], string> = { web: "🔎", call: "📞", ask_user: "🙋", note: "📝" };

function PlanChecklist({ plan }: { plan: PlanStep[] }) {
  return (
    <Card>
      <SectionTitle>Plan</SectionTitle>
      {plan.length === 0 && <Text style={s.muted}>Waiting for the agent to plan…</Text>}
      {plan.map((p) => (
        <View key={p.id} style={[s.step, p.status === "running" && s.stepRunning]}>
          <Text style={[s.stepIcon, { color: STEP_COLOR[p.status] }]}>{STEP_ICON[p.status]}</Text>
          <Text
            style={[
              s.stepText,
              p.status === "done" && { color: C.muted },
              p.status === "skipped" && { textDecorationLine: "line-through", color: C.muted },
            ]}
          >
            {KIND_ICON[p.kind]} {p.description}
          </Text>
        </View>
      ))}
    </Card>
  );
}

// ---------- Call ----------
const STEPS: { key: CallStatus; label: string }[] = [
  { key: "dialing", label: "Dialing" },
  { key: "ringing", label: "Ringing" },
  { key: "in_progress", label: "In progress" },
  { key: "on_hold_for_user", label: "On hold for you" },
  { key: "completed", label: "Completed" },
];

function CallPanel({ call }: { call: Call }) {
  const idx = STEPS.findIndex((x) => x.key === call.status);
  const failed = call.status === "failed" || call.status === "no_answer";
  const live = !TERMINAL.includes(call.status);
  const scrollRef = useRef<any>(null);
  return (
    <Card style={live ? [s.callCard] : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={s.callTitle}>📞 {live ? "Calling" : "Called"} {call.to || "…"}</Text>
        {failed && <Text style={s.callFailed}>{call.status === "no_answer" ? "No answer" : "Call failed"}</Text>}
      </View>
      <View style={s.stepper}>
        {STEPS.map((st, i) => {
          const reached = idx >= 0 ? i <= idx : false;
          const current = i === idx;
          return (
            <View key={st.key} style={s.stepperItem}>
              <View
                style={[
                  s.stepDot,
                  reached && { backgroundColor: C.primary },
                  current && live && { backgroundColor: C.amber, transform: [{ scale: 1.25 }] },
                ]}
              />
              <Text style={[s.stepLabel, current && { color: C.text, fontWeight: "800" }]}>{st.label}</Text>
            </View>
          );
        })}
      </View>
      <View style={s.transcript}>
        <ScrollView
          ref={scrollRef}
          style={{ maxHeight: 420 }}
          contentContainerStyle={{ gap: 8, padding: 4 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {call.transcript.length === 0 && <Text style={s.muted}>Transcript will appear here…</Text>}
          {call.transcript.map((t) => (
            <View key={t.seq} style={[s.tBubble, t.speaker === "agent" ? s.tAgent : s.tCallee]}>
              <Text style={s.tSpeaker}>{t.speaker === "agent" ? "nova (agent)" : call.to || "Callee"}</Text>
              <Text style={[s.tText, t.speaker === "agent" && { color: "#fff" }]}>{t.text}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Card>
  );
}

function SimCalleePanel({ call }: { call: Call }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      await api.simReply(call.callId, t.trim());
      setText("");
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={s.simCard}>
      <Text style={s.simTitle}>🎭 Play the other side (simulated call)</Text>
      <Text style={s.muted}>You are {call.to || "the callee"}. Type what they say.</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="e.g. Hi, Shadyside Dental, how can I help?"
          style={s.input}
          onSubmitEditing={() => send(text)}
        />
        <Button title="Send" onPress={() => send(text)} loading={busy} disabled={!text.trim()} />
        <Button title="Hang up" kind="danger" onPress={() => send("[hangup]")} />
      </View>
      {err && <Text style={{ color: C.red, marginTop: 6 }}>{err}</Text>}
    </Card>
  );
}

// ---------- Question ----------
function QuestionCard({ errandId, q }: { errandId: string; q: { id: string; text: string; options?: string[] } }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    setSent(null);
    setText("");
  }, [q.id]);
  const answer = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      await api.answer(errandId, q.id, t.trim());
      setSent(t.trim());
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.qCard}>
      <Text style={s.qBadge}>THE AGENT NEEDS YOU</Text>
      <Text style={s.qText}>{q.text}</Text>
      {sent ? (
        <Text style={s.qSent}>Sent: “{sent}” — waiting for the agent…</Text>
      ) : (
        <>
          {q.options?.length ? (
            <View style={s.qOptions}>
              {q.options.map((o) => (
                <Button key={o} title={o} onPress={() => answer(o)} big disabled={busy} style={s.qOptBtn} />
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type an answer…"
              style={[s.input, { fontSize: 18, backgroundColor: "#fff" }]}
              onSubmitEditing={() => answer(text)}
            />
            <Button title="Answer" onPress={() => answer(text)} loading={busy} disabled={!text.trim()} big />
          </View>
        </>
      )}
      {err && <Text style={{ color: C.red, marginTop: 6 }}>{err}</Text>}
    </View>
  );
}

// ---------- Result ----------
function ResultCard({ result }: { result: { outcome: string; details?: string } }) {
  return (
    <View style={s.result}>
      <Text style={s.resultBadge}>✓ RESULT</Text>
      <Text style={s.resultOutcome}>{result.outcome}</Text>
      {result.details ? <Text style={s.resultDetails}>{result.details}</Text> : null}
    </View>
  );
}

// ---------- Feed ----------
function ActivityFeed({ events }: { events: ErrandEvent[] }) {
  const items = [...events].reverse();
  return (
    <Card>
      <SectionTitle>Activity</SectionTitle>
      {items.length === 0 && <Text style={s.muted}>No activity yet.</Text>}
      {items.map((e) => (
        <View key={e.seq} style={s.feedItem}>
          <Text style={s.feedTime}>{fmtTime(e.at)}</Text>
          <View style={{ flex: 1 }}>{renderFeed(e)}</View>
        </View>
      ))}
    </Card>
  );
}

function renderFeed(e: ErrandEvent) {
  switch (e.type) {
    case "web":
      return (
        <>
          <Text style={s.feedText}>
            {e.action === "search" ? "🔎 Searched: " : "🌐 Read: "}
            <Text style={{ fontWeight: "700" }}>{e.query}</Text>
          </Text>
          {e.summary ? <Text style={s.feedSub}>{e.summary}</Text> : null}
        </>
      );
    case "log":
      return <Text style={s.feedText}>{e.text}</Text>;
    case "error":
      return <Text style={[s.feedText, { color: C.red }]}>⚠ {e.text}</Text>;
    case "question":
      return <Text style={[s.feedText, { color: C.amber }]}>🙋 Asked you: {e.question.text}</Text>;
    case "answer":
      return <Text style={[s.feedText, { color: C.green }]}>💬 You answered: {e.text}</Text>;
    case "call_status":
      return (
        <Text style={s.feedText}>
          📞 {e.to}: {e.status.replace(/_/g, " ")}
        </Text>
      );
    case "result":
      return <Text style={[s.feedText, { color: C.green, fontWeight: "700" }]}>✓ {e.outcome}</Text>;
    default:
      return null;
  }
}

function fmtTime(at: string) {
  const d = new Date(at);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  title: { fontSize: 24, fontWeight: "800", color: C.text },
  muted: { color: C.muted, fontSize: 15 },
  step: { flexDirection: "row", gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8, alignItems: "flex-start" },
  stepRunning: { backgroundColor: C.amberBg },
  stepIcon: { fontSize: 22, width: 26, textAlign: "center", fontWeight: "800" },
  stepText: { fontSize: 18, color: C.text, flex: 1, lineHeight: 26 },
  callCard: { borderColor: C.primary, borderWidth: 2 },
  callTitle: { fontSize: 22, fontWeight: "800", color: C.text },
  callFailed: { color: C.red, fontWeight: "700", fontSize: 16 },
  stepper: { flexDirection: "row", marginVertical: 14, justifyContent: "space-between" },
  stepperItem: { alignItems: "center", flex: 1, gap: 6 },
  stepDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: C.border },
  stepLabel: { fontSize: 13, color: C.muted, textAlign: "center" },
  transcript: { backgroundColor: C.bg, borderRadius: 10, padding: 8 },
  tBubble: { maxWidth: "85%", padding: 12, borderRadius: 14 },
  tAgent: { alignSelf: "flex-end", backgroundColor: C.primary },
  tCallee: { alignSelf: "flex-start", backgroundColor: "#fff", borderWidth: 1, borderColor: C.border },
  tSpeaker: { fontSize: 12, fontWeight: "700", color: C.muted, marginBottom: 2, opacity: 0.9 },
  tText: { fontSize: 18, color: C.text, lineHeight: 25 },
  simCard: { backgroundColor: "#f5f3ff", borderColor: "#8b5cf6", borderWidth: 2, borderStyle: "dashed" },
  simTitle: { fontSize: 18, fontWeight: "800", color: "#5b21b6", marginBottom: 4 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff",
    color: C.text,
  },
  qCard: {
    backgroundColor: "#fff7ed",
    borderColor: "#f97316",
    borderWidth: 3,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#f97316",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  qBadge: { color: "#c2410c", fontWeight: "900", letterSpacing: 1.5, fontSize: 14, marginBottom: 8 },
  qText: { fontSize: 26, fontWeight: "800", color: C.text, lineHeight: 34 },
  qOptions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  qOptBtn: { backgroundColor: "#ea580c" },
  qSent: { marginTop: 12, fontSize: 17, color: C.green, fontWeight: "600" },
  result: { backgroundColor: C.greenBg, borderColor: C.green, borderWidth: 2, borderRadius: 16, padding: 20, marginBottom: 16 },
  resultBadge: { color: C.green, fontWeight: "900", letterSpacing: 1.5, fontSize: 14, marginBottom: 6 },
  resultOutcome: { fontSize: 24, fontWeight: "800", color: C.text, lineHeight: 32 },
  resultDetails: { fontSize: 17, color: C.text, marginTop: 8, lineHeight: 24 },
  feedItem: { flexDirection: "row", gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.grayBg },
  feedTime: { fontSize: 12, color: C.gray, width: 72, paddingTop: 3 },
  feedText: { fontSize: 15, color: C.text, lineHeight: 21 },
  feedSub: { fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 18 },
});

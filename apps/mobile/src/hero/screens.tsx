// Hero flow steps 1-5: Welcome, Connect MyChart, Add documents, Analyzing, Results.
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CriterionResult, DenialAnalysis, Finding, PatientCase } from "@nova26/shared";
import { api } from "../api";
import {
  atLeast,
  Badge,
  Card,
  Check,
  ErrorNote,
  H1,
  Label,
  Lead,
  LockIcon,
  money,
  PrimaryButton,
  Pulse,
  shadow,
  T,
} from "./theme";

type SetCase = (c: PatientCase) => void;
const errMsg = (e: any) => String(e?.message || e);

export function Screen({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------- 1. Welcome
export function Welcome({ c, onNext }: { c: PatientCase | null; onNext: () => void }) {
  const first = (c?.patient.name || "Prithish Shan").split(" ")[0];
  return (
    <Screen footer={<PrimaryButton title="Get started" onPress={onNext} />}>
      <View style={{ height: 40 }} />
      <View style={s.heroMark}>
        <Text style={s.heroMarkText}>$</Text>
      </View>
      <Text style={s.hello}>Hi {first},</Text>
      <H1>Aetna said no. Let's see if they're right.</H1>
      <Lead>
        Connect your records and your denial letter. We'll check your chart against Aetna's own policy — and appeal for you if you qualify.
      </Lead>
      <View style={{ height: 28 }} />
      {[
        ["1", "Connect your MyChart records"],
        ["2", "Add Aetna's denial letter"],
        ["3", "We check Aetna's policy and call Aetna for you"],
      ].map(([n, t]) => (
        <View key={n} style={s.welcomeRow}>
          <View style={s.welcomeNum}>
            <Text style={s.welcomeNumText}>{n}</Text>
          </View>
          <Text style={s.welcomeText}>{t}</Text>
        </View>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------- 2. Connect MyChart
export function ConnectChart({ c, setCase, onNext }: { c: PatientCase | null; setCase: SetCase; onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connected = !!c?.chartConnected && !!c.chart;

  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await atLeast(1600, () => api.connectMyChart());
      setCase(r.case);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        connected ? (
          <PrimaryButton title="Continue" onPress={onNext} />
        ) : (
          <PrimaryButton title={busy ? "Connecting…" : "Connect"} onPress={connect} loading={busy} />
        )
      }
    >
      <H1>{connected ? "Your records are in." : "Connect your records"}</H1>
      <Lead>
        {connected
          ? "Here's what we imported from MyChart. We'll use it to show Aetna you meet their requirements."
          : "We read your chart so we can prove what your care required. You stay in control — read-only access."}
      </Lead>
      <View style={{ height: 22 }} />
      <ErrorNote text={err} />

      {!connected && (
        <Card style={s.mychart}>
          <View style={s.mychartTop}>
            <View style={s.mychartLogo}>
              <LockIcon size={26} color={T.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.mychartName}>MyChart</Text>
              <Text style={s.mychartSub}>Secure connection · read-only</Text>
            </View>
          </View>
          {busy ? (
            <View style={s.importing}>
              <Pulse />
              <Text style={s.importingText}>Importing your records…</Text>
            </View>
          ) : (
            <View style={{ marginTop: 18, gap: 8 }}>
              {["Conditions & medications", "Recent labs and results", "Visit notes"].map((t) => (
                <Text key={t} style={s.bullet}>
                  •  {t}
                </Text>
              ))}
            </View>
          )}
        </Card>
      )}

      {connected && c?.chart && <ChartImported c={c} />}
    </Screen>
  );
}

function ChartImported({ c }: { c: PatientCase }) {
  const ch = c.chart!;
  const counts: [string, number][] = [
    ["Conditions", ch.conditions.length],
    ["Medications", ch.medications.length],
    ["Labs", ch.observations.length],
    ["Notes", ch.noteExcerpts.length],
  ];
  return (
    <>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Check />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{ch.name}</Text>
            <Text style={s.small}>
              MRN {ch.mrn}
              {ch.age ? ` · ${ch.age} yrs` : ""} · {c.patient.payer} member
            </Text>
          </View>
        </View>
        <View style={s.countRow}>
          {counts.map(([k, n]) => (
            <View key={k} style={s.countBox}>
              <Text style={s.countNum}>{n}</Text>
              <Text style={s.countLabel}>{k}</Text>
            </View>
          ))}
        </View>
      </Card>
      <ItemList title="Conditions" items={ch.conditions} />
      <ItemList title="Medications" items={ch.medications} />
      <ItemList title="Recent labs" items={ch.observations} />
      {ch.noteExcerpts.length > 0 && (
        <Card>
          <Label>Notes</Label>
          {ch.noteExcerpts.slice(0, 3).map((n, i) => (
            <View key={i} style={[s.noteRow, i > 0 && s.divider]}>
              <Text style={s.itemText}>{n.title}</Text>
              <Text style={s.small}>{n.date}</Text>
              <Text style={s.noteText} numberOfLines={2}>
                {n.text}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

function ItemList({ title, items, max = 4 }: { title: string; items: string[]; max?: number }) {
  if (!items.length) return null;
  return (
    <Card>
      <Label>{title}</Label>
      {items.slice(0, max).map((t, i) => (
        <Text key={i} style={[s.itemText, i > 0 && { marginTop: 8 }]}>
          {t}
        </Text>
      ))}
      {items.length > max && <Text style={[s.small, { marginTop: 8 }]}>+ {items.length - max} more</Text>}
    </Card>
  );
}

// ---------------------------------------------------------------- 3. Add documents (Aetna denial letter)
export function AddDocs({ c, setCase, onNext }: { c: PatientCase | null; setCase: SetCase; onNext: () => void }) {
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const L = c?.denialLetter;
  const payer = c?.patient.payer || "Aetna";

  const add = async () => {
    setReading(true);
    setErr(null);
    try {
      const r = await atLeast(1400, () => api.addDocuments({ denialLetter: true }));
      setCase(r.case);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setReading(false);
    }
  };

  return (
    <Screen footer={<PrimaryButton title="Do I have a case?" onPress={onNext} disabled={!L} />}>
      <H1>{L ? "Here's what Aetna sent you" : "Add your denial letter"}</H1>
      <Lead>
        {L
          ? "We read the letter. Next, we'll check it against your chart and Aetna's own policy."
          : `A photo of the letter from ${payer} is enough. We'll read it for you.`}
      </Lead>
      <View style={{ height: 22 }} />
      <ErrorNote text={err} />

      {!L && (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={s.docIcon}>
              <View style={s.docIconInner} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{payer} denial letter</Text>
              <Text style={s.small}>The letter saying your treatment wasn't approved</Text>
            </View>
          </View>
          {reading ? (
            <View style={s.importing}>
              <Pulse />
              <Text style={s.importingText}>Reading document…</Text>
            </View>
          ) : (
            <PrimaryButton title="Add photo / Upload" kind="ghost" onPress={add} style={{ marginTop: 16 }} />
          )}
        </Card>
      )}

      {L && (
        <Card style={s.letterCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <Check />
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{L.from}</Text>
              <Text style={s.small}>{L.date}</Text>
            </View>
          </View>
          <LetterField k="Service" v={`${L.service} · ${L.code}`} />
          <LetterField k="Requested by" v={L.requestedBy} />
          <View style={s.letterField}>
            <Text style={s.letterKey}>Decision</Text>
            <Text style={[s.letterVal, { color: T.red, fontWeight: "800" }]}>{L.decision}</Text>
          </View>
          <View style={s.letterField}>
            <Text style={s.letterKey}>Reason given</Text>
            <Text style={[s.letterVal, { fontStyle: "italic" }]}>“{L.reason}”</Text>
          </View>
          <LetterField k="Reference number" v={L.referenceNumber} />
          <LetterField k="Your appeal rights" v={L.appealRights} />
          <View style={s.letterNote}>
            <Text style={s.letterNoteText}>
              Sent {L.daysSinceDenial} day{L.daysSinceDenial === 1 ? "" : "s"} ago ·{" "}
              {L.officeAppealed ? "your doctor's office has appealed" : "your doctor's office hasn't appealed yet"}
            </Text>
          </View>
        </Card>
      )}
    </Screen>
  );
}

function LetterField({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.letterField}>
      <Text style={s.letterKey}>{k}</Text>
      <Text style={s.letterVal}>{v}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- 4. Analyzing
const ANALYZE_STEPS = [
  "Reading Aetna's denial",
  "Reading Aetna's Remicade policy (CPB 0341)",
  "Checking your chart against each requirement",
  "Drafting your expedited appeal",
];

export function Analyzing({ setCase, onDone }: { setCase: SetCase; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let alive = true;
    setErr(null);
    setI(0);
    const t = setInterval(() => {
      // advance through the steps; hold on the last one until the server responds
      Animated.sequence([
        Animated.timing(fade, { toValue: 0.3, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: true }),
      ]).start();
      setI((x) => Math.min(x + 1, ANALYZE_STEPS.length - 1));
    }, 4500);
    atLeast(3000, () => api.analyzeCase())
      .then((r) => {
        if (!alive) return;
        setCase(r.case);
        onDone();
      })
      .catch((e) => alive && setErr(errMsg(e)));
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <Screen footer={err ? <PrimaryButton title="Try again" onPress={() => setAttempt((a) => a + 1)} /> : undefined}>
      <View style={{ height: 30 }} />
      <H1>Checking your case…</H1>
      <Lead>This takes about half a minute. We're reading every requirement so you don't have to.</Lead>
      <View style={{ height: 28 }} />
      <ErrorNote text={err} />
      <Card>
        {ANALYZE_STEPS.map((t, k) => {
          const done = k < i;
          const now = k === i && !err;
          return (
            <View key={t} style={[s.anRow, k > 0 && { marginTop: 18 }]}>
              <View style={{ width: 34, alignItems: "center" }}>
                {done ? (
                  <Check size={26} />
                ) : now ? (
                  <Pulse size={7} />
                ) : (
                  <View style={s.anPending} />
                )}
              </View>
              <Animated.Text
                style={[s.anText, done && { color: T.sub }, now && { color: T.text, fontWeight: "700", opacity: fade }, !done && !now && { color: T.muted }]}
              >
                {t}
              </Animated.Text>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------- 5. Results
export function Results({
  c,
  onCall,
  callBusy,
  callErr,
  callDone,
}: {
  c: PatientCase;
  onCall: () => void;
  callBusy: boolean;
  callErr: string | null;
  callDone?: boolean;
}) {
  const a = c.analysis;
  const d = a?.denial;
  const payer = c.patient.payer || "Aetna";
  const finding = a?.findings.find((f) => f.kind === "appealable_denial") ?? a?.findings[0];
  const headline =
    d?.verdict === "strong"
      ? "You have a strong case"
      : d?.verdict === "weak"
        ? "Your case needs more evidence"
        : "You may have a case";

  return (
    <Screen
      footer={
        <>
          {callErr && <ErrorNote text={callErr} />}
          <PrimaryButton
            title={callDone ? `Call ${payer} again` : `Call ${payer} for an expedited appeal`}
            onPress={onCall}
            loading={callBusy}
          />
        </>
      }
    >
      <Text style={s.resultsKicker}>Here's what we found</Text>
      <H1 style={{ fontSize: 36, lineHeight: 43 }}>{headline}</H1>
      <Text style={s.resultsSub}>
        {payer} says the documentation doesn't show standard treatments failed. Your chart does.
      </Text>
      <View style={{ height: 20 }} />
      {callDone && <AppealTracker outcome={c.callOutcome} />}
      {finding && <FindingCard f={finding} />}
      {d && <CaseEvidence d={d} />}
      {!finding && !d && (
        <Card>
          <Text style={s.itemText}>No findings yet.</Text>
        </Card>
      )}
    </Screen>
  );
}

function AppealTracker({ outcome }: { outcome?: string }) {
  const steps: { icon: string; done: boolean; title: string; sub?: string }[] = [
    { icon: "✓", done: true, title: "Expedited appeal requested", sub: outcome },
    { icon: "⏳", done: false, title: "Aetna decision within 72 hours" },
    { icon: "✉", done: false, title: "Written appeal + chart evidence sent" },
    { icon: "✉", done: false, title: "Copy sent to your GI office (peer-to-peer)" },
  ];
  return (
    <Card style={[{ borderWidth: 1.5, borderColor: "#bbf7d0" }]}>
      <Label>Appeal tracker</Label>
      {steps.map((st, i) => (
        <View key={i} style={s.trackRow}>
          <View style={{ alignItems: "center" }}>
            <View style={[s.trackIcon, st.done ? { backgroundColor: T.green } : { backgroundColor: T.accentSoft }]}>
              <Text style={{ color: st.done ? "#fff" : T.accent, fontWeight: "900", fontSize: 15 }}>{st.icon}</Text>
            </View>
            {i < steps.length - 1 && <View style={s.trackLine} />}
          </View>
          <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
            <Text style={[s.critLabel, !st.done && { color: T.sub }]}>{st.title}</Text>
            {st.sub ? <Text style={s.critBody}>{st.sub}</Text> : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

function FindingCard({ f }: { f: Finding }) {
  return (
    <Card style={[{ borderWidth: 2, borderColor: T.accent }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Badge text="You can appeal this" fg={T.accentText} bg={T.accent} />
        {f.amount > 0 ? <Text style={[s.findAmt, { color: T.text }]}>{money(f.amount)}</Text> : null}
      </View>
      <Text style={[s.cardTitle, { marginTop: 12, fontSize: 20 }]}>{f.title}</Text>
      <Text style={s.plain}>{f.plain}</Text>
      {f.action ? (
        <View style={[s.action, { backgroundColor: T.accentSoft }]}>
          <Text style={[s.actionText, { color: T.accent }]}>{f.action}</Text>
        </View>
      ) : null}
    </Card>
  );
}

function CaseEvidence({ d }: { d: DenialAnalysis }) {
  const [letter, setLetter] = useState(false);
  const [showNA, setShowNA] = useState(false);
  const verdict =
    d.verdict === "strong"
      ? { t: "Strong case", fg: T.green, bg: T.greenSoft }
      : d.verdict === "weak"
        ? { t: "Weak case", fg: T.red, bg: T.redSoft }
        : { t: "Unclear case", fg: T.amber, bg: T.amberSoft };
  const applicable = d.criteria.filter((x) => !x.notApplicable);
  const na = d.criteria.filter((x) => x.notApplicable);
  const met = applicable.filter((x) => x.status === "met").length;
  return (
    <Card>
      <Text style={s.whyHeadText}>Why we think you'll win</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <Badge text={verdict.t} fg={verdict.fg} bg={verdict.bg} />
        <Text style={s.small}>
          {met} of {applicable.length} requirements met
        </Text>
      </View>
      <View style={s.meterWrap}>
        <View style={s.meterTrack}>
          <View style={[s.meterFill, { width: `${Math.max(0, Math.min(100, d.readinessPct))}%` }]} />
        </View>
        <Text style={s.meterPct}>{Math.round(d.readinessPct)}%</Text>
      </View>
      <Text style={s.small}>
        Checked against {d.policy.payer} {d.policy.policyId ? `${d.policy.policyId} · ` : ""}
        {d.policy.title}
        {d.indication ? ` · for ${d.indication}` : ""}
      </Text>
      <View style={{ height: 8 }} />
      {applicable.map((cr) => (
        <CriterionRow key={cr.id} cr={cr} payer={d.policy.payer} />
      ))}
      {na.length > 0 && (
        <>
          <Pressable onPress={() => setShowNA((v) => !v)} hitSlop={8} style={{ paddingVertical: 10 }}>
            <Text style={{ color: T.muted, fontSize: 14, fontWeight: "700" }}>
              {showNA ? "Hide requirements that don't apply" : `+${na.length} not applicable to you`}
            </Text>
          </Pressable>
          {showNA && na.map((cr) => <CriterionRow key={cr.id} cr={cr} payer={d.policy.payer} dim />)}
        </>
      )}
      {d.winRateNote ? <Text style={s.fine}>{d.winRateNote}</Text> : null}
      <PrimaryButton title="View appeal letter" kind="ghost" onPress={() => setLetter(true)} style={{ marginTop: 14 }} />
      <Modal visible={letter} animationType="slide" onRequestClose={() => setLetter(false)}>
        <View style={{ flex: 1, backgroundColor: T.bg }}>
          <View style={s.modalHead}>
            <Text style={s.cardTitle}>Your appeal letter</Text>
            <Pressable onPress={() => setLetter(false)} hitSlop={12}>
              <Text style={{ color: T.accent, fontSize: 18, fontWeight: "700" }}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
            <Card>
              <Text selectable style={s.letter}>
                {d.appealLetter}
              </Text>
            </Card>
          </ScrollView>
        </View>
      </Modal>
    </Card>
  );
}

function CriterionRow({ cr, payer, dim }: { cr: CriterionResult; payer: string; dim?: boolean }) {
  const [full, setFull] = useState(false);
  const icon =
    cr.status === "met"
      ? { ch: "✓", fg: "#fff", bg: T.green }
      : cr.status === "unmet"
        ? { ch: "✕", fg: "#fff", bg: T.red }
        : { ch: "?", fg: "#fff", bg: T.amber };
  const LIMIT = 140;
  const long = cr.policyQuote.length > LIMIT;
  const quote = long && !full ? cr.policyQuote.slice(0, LIMIT).trimEnd() + "…" : cr.policyQuote;
  return (
    <View style={[s.crit, dim && { opacity: 0.55 }]}>
      <View style={[s.critIcon, { backgroundColor: icon.bg }]}>
        <Text style={{ color: icon.fg, fontWeight: "900", fontSize: 14 }}>{icon.ch}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.critLabel}>{cr.label}</Text>
        {cr.evidence ? (
          <Text style={s.critBody}>
            <Text style={s.critKey}>Your chart: </Text>
            {cr.evidence}
          </Text>
        ) : null}
        {cr.policyQuote ? (
          <Pressable onPress={() => long && setFull((v) => !v)}>
            <Text style={s.critQuote}>
              <Text style={s.critKey}>
                {payer || "Aetna"} policy{cr.sectionPath ? ` §${cr.sectionPath}` : ""}:{" "}
              </Text>
              “{quote}”
              {long ? <Text style={{ color: T.accent, fontWeight: "700" }}>{full ? "  Show less" : "  Show more"}</Text> : null}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 30 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, backgroundColor: T.bg },
  heroMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: T.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 26,
    ...shadow,
    shadowColor: T.accent,
    shadowOpacity: 0.3,
  },
  heroMarkText: { color: "#fff", fontSize: 32, fontWeight: "800" },
  hello: { fontSize: 20, color: T.sub, marginBottom: 6, fontWeight: "600" },
  welcomeRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  welcomeNum: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.accentSoft, alignItems: "center", justifyContent: "center" },
  welcomeNumText: { color: T.accent, fontWeight: "800", fontSize: 16 },
  welcomeText: { fontSize: 18, color: T.text, flex: 1, lineHeight: 25 },
  mychart: { padding: 22 },
  mychartTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  mychartLogo: { width: 56, height: 56, borderRadius: 16, backgroundColor: T.accentSoft, alignItems: "center", justifyContent: "center" },
  mychartName: { fontSize: 24, fontWeight: "800", color: T.text, letterSpacing: -0.3 },
  mychartSub: { fontSize: 15, color: T.sub, marginTop: 2 },
  bullet: { fontSize: 17, color: T.sub },
  importing: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 20, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: T.accentSoft, borderRadius: 14 },
  importingText: { fontSize: 17, color: T.accent, fontWeight: "700" },
  cardTitle: { fontSize: 19, fontWeight: "800", color: T.text },
  small: { fontSize: 14, color: T.sub, lineHeight: 20 },
  countRow: { flexDirection: "row", gap: 8 },
  countBox: { flex: 1, backgroundColor: T.bg, borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  countNum: { fontSize: 26, fontWeight: "800", color: T.accent },
  countLabel: { fontSize: 12, color: T.sub, fontWeight: "600", marginTop: 2 },
  itemText: { fontSize: 17, color: T.text, lineHeight: 24 },
  noteRow: { paddingVertical: 4 },
  noteText: { fontSize: 15, color: T.sub, marginTop: 4, lineHeight: 21 },
  divider: { borderTopWidth: 1, borderTopColor: T.line, marginTop: 10, paddingTop: 10 },
  docIcon: { width: 28, height: 34, borderRadius: 6, borderWidth: 2.5, borderColor: T.muted, padding: 5, justifyContent: "center" },
  docIconInner: { height: 2.5, backgroundColor: T.muted, borderRadius: 2 },
  lineRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  lineCode: { fontSize: 13, fontWeight: "800", color: T.muted, letterSpacing: 0.5 },
  lineDesc: { fontSize: 16, color: T.text, lineHeight: 22, marginTop: 1 },
  lineOwe: { fontSize: 16, fontWeight: "800", color: T.text, marginTop: 2 },
  anRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  anPending: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: T.line },
  anText: { fontSize: 18, flex: 1, lineHeight: 25 },
  resultsKicker: { fontSize: 15, fontWeight: "700", color: T.accent, letterSpacing: 0.5, marginBottom: 6, marginTop: 6 },
  resultsSub: { fontSize: 17, color: T.sub, marginTop: 10 },
  callDoneNote: { backgroundColor: T.greenSoft, padding: 12, borderRadius: 12, marginTop: 14 },
  findAmt: { fontSize: 22, fontWeight: "800" },
  plain: { fontSize: 17, color: T.sub, lineHeight: 25, marginTop: 6 },
  action: { borderRadius: 12, padding: 12, marginTop: 12 },
  actionText: { fontSize: 16, color: T.text, fontWeight: "600", lineHeight: 22 },
  whyHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderTopWidth: 1, borderTopColor: T.line },
  whyHeadText: { fontSize: 18, fontWeight: "800", color: T.accent },
  whyChevron: { fontSize: 24, fontWeight: "700", color: T.accent, width: 24, textAlign: "center" },
  meterWrap: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 12 },
  meterTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: T.line, overflow: "hidden" },
  meterFill: { height: 10, borderRadius: 5, backgroundColor: T.accent },
  meterPct: { fontSize: 18, fontWeight: "800", color: T.text, minWidth: 48, textAlign: "right" },
  crit: { flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: T.line },
  critIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 2 },
  critLabel: { fontSize: 17, fontWeight: "700", color: T.text, lineHeight: 23 },
  critKey: { fontWeight: "700", color: T.text },
  critBody: { fontSize: 15, color: T.sub, lineHeight: 21, marginTop: 4 },
  critQuote: { fontSize: 15, color: T.sub, lineHeight: 21, marginTop: 6, fontStyle: "italic" },
  fine: { fontSize: 13, color: T.muted, lineHeight: 19, marginTop: 10 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingTop: 22, backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.line },
  letterCard: { borderWidth: 1, borderColor: T.line },
  letterField: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.line },
  letterKey: { fontSize: 12, fontWeight: "800", color: T.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
  letterVal: { fontSize: 17, color: T.text, lineHeight: 24 },
  letterNote: { backgroundColor: T.amberSoft, borderRadius: 12, padding: 12, marginTop: 10 },
  letterNoteText: { fontSize: 15, color: T.amber, fontWeight: "700", lineHeight: 21 },
  trackRow: { flexDirection: "row", gap: 12 },
  trackIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  trackLine: { width: 2, flex: 1, backgroundColor: T.line, marginVertical: 2 },
  letter: { fontSize: 16, lineHeight: 25, color: T.text },
});

// Single-patient hero flow: Welcome -> MyChart -> Documents -> Analyzing -> Results -> Live call.
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PatientCase } from "@nova26/shared";
import { api, Health } from "../api";
import { AddDocs, Analyzing, ConnectChart, Results, Welcome } from "./screens";
import { LiveCall } from "./LiveCall";
import { Dots, ErrorNote, PrimaryButton, Pulse, shadow, T } from "./theme";

type Step = 0 | 1 | 2 | 3 | 4 | 5;
const STEP_COUNT = 6;

function stepFor(c: PatientCase): Step {
  if (c.analysis) {
    if (c.stage === "calling" && c.errandId) return 5;
    return 4;
  }
  if (c.chartConnected) return 2;
  return 0;
}

export function HeroApp() {
  const [c, setC] = useState<PatientCase | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [menu, setMenu] = useState(false);
  const [errandId, setErrandId] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [callErr, setCallErr] = useState<string | null>(null);
  const [callDone, setCallDone] = useState(false);

  const load = useCallback(async () => {
    setBooting(true);
    setBootErr(null);
    try {
      const r = await api.getCase();
      setC(r.case);
      setStep(stepFor(r.case));
      setErrandId(r.case.errandId ?? null);
      setCallDone(r.case.stage === "done");
    } catch (e: any) {
      setBootErr(String(e?.message || e));
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    const check = () => api.health().then((h) => alive && setHealth(h)).catch(() => {});
    check();
    const t = setInterval(check, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const reset = async () => {
    setMenu(false);
    try {
      const r = await api.resetCase();
      setC(r.case);
    } catch (e: any) {
      setBootErr(String(e?.message || e));
    }
    setErrandId(null);
    setCallDone(false);
    setCallErr(null);
    setStep(0);
  };

  const callPayer = async () => {
    setCallBusy(true);
    setCallErr(null);
    try {
      const r = await api.callPayer();
      setC(r.case);
      const id = r.errandId ?? r.case.errandId;
      if (!id) throw new Error("No call was started.");
      setErrandId(id);
      setCallDone(false);
      setStep(5);
    } catch (e: any) {
      setCallErr(String(e?.message || e));
    } finally {
      setCallBusy(false);
    }
  };

  const finishCall = async () => {
    setCallDone(true);
    try {
      const r = await api.getCase();
      setC(r.case);
    } catch {
      // keep local state
    }
    setStep(4);
  };

  let body: React.ReactNode;
  if (booting) {
    body = (
      <View style={s.center}>
        <Pulse />
      </View>
    );
  } else if (bootErr && !c) {
    body = (
      <View style={[s.center, { padding: 24 }]}>
        <Text style={s.bootTitle}>Can't reach nova26 right now.</Text>
        <ErrorNote text={bootErr} />
        <PrimaryButton title="Try again" onPress={load} style={{ alignSelf: "stretch" }} />
      </View>
    );
  } else if (step === 0) body = <Welcome c={c} onNext={() => setStep(c?.chartConnected ? 2 : 1)} />;
  else if (step === 1) body = <ConnectChart c={c} setCase={setC} onNext={() => setStep(2)} />;
  else if (step === 2) body = <AddDocs c={c} setCase={setC} onNext={() => setStep(3)} />;
  else if (step === 3) body = <Analyzing setCase={setC} onDone={() => setStep(4)} />;
  else if (step === 4 && c?.analysis)
    body = <Results c={c} onCall={callPayer} callBusy={callBusy} callErr={callErr} callDone={callDone} />;
  else if (step === 5 && errandId)
    body = <LiveCall errandId={errandId} health={health} payer={c?.patient.payer || "Aetna"} onDone={finishCall} />;
  else body = <Welcome c={c} onNext={() => setStep(1)} />;

  const canBack = step === 1 || step === 2;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={s.header}>
        <View style={s.headerSide}>
          {canBack ? (
            <Pressable onPress={() => setStep((x) => (x - 1) as Step)} hitSlop={12}>
              <Text style={s.back}>‹ Back</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ alignItems: "center", gap: 8 }}>
          <Text style={s.brand}>nova26</Text>
          <Dots count={STEP_COUNT} active={step} />
        </View>
        <View style={[s.headerSide, { alignItems: "flex-end" }]}>
          <Pressable onPress={() => setMenu((m) => !m)} hitSlop={12} style={s.more}>
            <Text style={s.moreText}>•••</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {body}
        {menu && (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} />
            <View style={s.menu}>
              <Pressable onPress={reset} style={({ pressed }) => [s.menuItem, pressed && { backgroundColor: T.bg }]}>
                <Text style={s.menuText}>Reset demo</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: T.bg,
  },
  headerSide: { width: 70 },
  back: { fontSize: 16, color: T.accent, fontWeight: "700" },
  brand: { fontSize: 14, fontWeight: "800", color: T.sub, letterSpacing: 1 },
  more: { paddingHorizontal: 8, paddingVertical: 4 },
  moreText: { fontSize: 16, color: T.sub, fontWeight: "900", letterSpacing: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  bootTitle: { fontSize: 22, fontWeight: "800", color: T.text, marginBottom: 16, textAlign: "center" },
  menu: {
    position: "absolute",
    top: 0,
    right: 14,
    backgroundColor: T.card,
    borderRadius: 14,
    paddingVertical: 6,
    minWidth: 170,
    ...shadow,
    shadowOpacity: 0.15,
    elevation: 8,
  },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  menuText: { fontSize: 16, color: T.red, fontWeight: "700" },
});

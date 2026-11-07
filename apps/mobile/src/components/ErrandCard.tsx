// Live structured view of the Errand schema, with inline edits (PATCH /errands/:id).
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Constraint, Contact, Errand } from "@nova26/shared";
import { C, Card, SectionTitle, StatusPill } from "../ui";

const KINDS: Constraint["kind"][] = ["time", "budget", "location", "preference", "must", "must_not", "other"];
const KIND_LABEL: Record<Constraint["kind"], string> = {
  time: "Time",
  budget: "Budget",
  location: "Location",
  preference: "Preference",
  must: "Must",
  must_not: "Must not",
  other: "Other",
};

export function ErrandCard({
  errand,
  onPatch,
}: {
  errand: Errand;
  onPatch: (patch: Partial<Errand>) => void;
}) {
  const [newKind, setNewKind] = useState<Constraint["kind"]>("preference");
  const [newText, setNewText] = useState("");
  const [newRule, setNewRule] = useState("");

  const grouped = KINDS.map((k) => ({
    kind: k,
    items: errand.constraints.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === k),
  })).filter((g) => g.items.length);

  const addConstraint = () => {
    const t = newText.trim();
    if (!t) return;
    onPatch({ constraints: [...errand.constraints, { kind: newKind, text: t }] });
    setNewText("");
  };
  const removeConstraint = (i: number) =>
    onPatch({ constraints: errand.constraints.filter((_, j) => j !== i) });

  const addRule = () => {
    const t = newRule.trim();
    if (!t) return;
    onPatch({ approvalRules: [...errand.approvalRules, t] });
    setNewRule("");
  };

  return (
    <Card>
      <View style={s.topRow}>
        <Text style={s.cardTitle}>Errand card</Text>
        <StatusPill status={errand.status} />
      </View>

      <SectionTitle>Objective</SectionTitle>
      <Text style={s.objective}>{errand.objective || "—"}</Text>
      {errand.summary ? <Text style={s.summary}>{errand.summary}</Text> : null}

      {errand.onBehalfOf ? (
        <>
          <SectionTitle>On behalf of</SectionTitle>
          <Text style={s.body}>{errand.onBehalfOf}</Text>
        </>
      ) : null}

      {errand.missingInfo.length > 0 && (
        <View style={s.missing}>
          <Text style={s.missingTitle}>Still needed</Text>
          {errand.missingInfo.map((m, i) => (
            <Text key={i} style={s.missingItem}>
              • {m}
            </Text>
          ))}
        </View>
      )}

      <SectionTitle>Constraints</SectionTitle>
      {grouped.length === 0 && <Text style={s.mutedText}>None yet</Text>}
      {grouped.map((g) => (
        <View key={g.kind} style={s.group}>
          <Text style={s.groupLabel}>{KIND_LABEL[g.kind]}</Text>
          <View style={s.chips}>
            {g.items.map(({ c, i }) => (
              <View key={i} style={[s.chip, g.kind === "must_not" && { backgroundColor: C.redBg }]}>
                <Text style={s.chipText}>{c.text}</Text>
                <Pressable onPress={() => removeConstraint(i)} hitSlop={8}>
                  <Text style={s.chipX}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ))}
      <View style={s.kindRow}>
        {KINDS.map((k) => (
          <Pressable key={k} onPress={() => setNewKind(k)} style={[s.kindOpt, newKind === k && s.kindOptOn]}>
            <Text style={[s.kindOptText, newKind === k && { color: C.primaryText }]}>{KIND_LABEL[k]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.addRow}>
        <TextInput
          value={newText}
          onChangeText={setNewText}
          placeholder="Add a constraint…"
          style={s.input}
          onSubmitEditing={addConstraint}
        />
        <Pressable onPress={addConstraint} style={s.addBtn}>
          <Text style={s.addBtnText}>Add</Text>
        </Pressable>
      </View>

      <SectionTitle>Contacts</SectionTitle>
      {errand.contacts.length === 0 && <Text style={s.mutedText}>None yet</Text>}
      {errand.contacts.map((c, i) => (
        <ContactRow
          key={i}
          contact={c}
          onChange={(next) => onPatch({ contacts: errand.contacts.map((x, j) => (j === i ? next : x)) })}
          onRemove={() => onPatch({ contacts: errand.contacts.filter((_, j) => j !== i) })}
        />
      ))}

      <SectionTitle>Check with me before…</SectionTitle>
      {errand.approvalRules.length === 0 && <Text style={s.mutedText}>No approval rules</Text>}
      {errand.approvalRules.map((r, i) => (
        <View key={i} style={s.ruleRow}>
          <Text style={s.rule}>✋ {r}</Text>
          <Pressable
            onPress={() => onPatch({ approvalRules: errand.approvalRules.filter((_, j) => j !== i) })}
            hitSlop={8}
          >
            <Text style={s.chipX}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={s.addRow}>
        <TextInput
          value={newRule}
          onChangeText={setNewRule}
          placeholder="e.g. paying anything"
          style={s.input}
          onSubmitEditing={addRule}
        />
        <Pressable onPress={addRule} style={s.addBtn}>
          <Text style={s.addBtnText}>Add</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function ContactRow({
  contact,
  onChange,
  onRemove,
}: {
  contact: Contact;
  onChange: (c: Contact) => void;
  onRemove: () => void;
}) {
  const [phone, setPhone] = useState(contact.phone ?? "");
  useEffect(() => setPhone(contact.phone ?? ""), [contact.phone]);
  const commit = () => {
    if ((contact.phone ?? "") !== phone.trim()) onChange({ ...contact, phone: phone.trim() || undefined });
  };
  return (
    <View style={s.contact}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={s.contactName}>
          {contact.name}
          {contact.role ? <Text style={s.mutedText}> · {contact.role}</Text> : null}
        </Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={s.chipX}>×</Text>
        </Pressable>
      </View>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder="Phone (+1…)"
        keyboardType="phone-pad"
        style={[s.input, { marginTop: 6 }]}
      />
      {contact.url ? <Text style={s.url}>{contact.url}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitle: { fontSize: 20, fontWeight: "800", color: C.text },
  objective: { fontSize: 18, fontWeight: "600", color: C.text, marginBottom: 4 },
  summary: { fontSize: 15, color: C.muted, marginBottom: 12, fontStyle: "italic" },
  body: { fontSize: 16, color: C.text, marginBottom: 12 },
  mutedText: { color: C.muted, fontSize: 14, marginBottom: 8 },
  missing: {
    backgroundColor: C.amberBg,
    borderColor: "#f59e0b",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginVertical: 10,
  },
  missingTitle: { fontWeight: "800", color: C.amber, marginBottom: 4, fontSize: 15 },
  missingItem: { color: "#78350f", fontSize: 15, marginTop: 2 },
  group: { marginBottom: 8 },
  groupLabel: { fontSize: 13, color: C.muted, fontWeight: "600", marginBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.blueBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  chipText: { fontSize: 14, color: C.text },
  chipX: { fontSize: 18, color: C.muted, fontWeight: "700", paddingHorizontal: 4 },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  kindOpt: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  kindOptOn: { backgroundColor: C.primary, borderColor: C.primary },
  kindOptText: { fontSize: 12, color: C.text },
  addRow: { flexDirection: "row", gap: 6, marginTop: 6, marginBottom: 14 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: "#fff",
    color: C.text,
  },
  addBtn: { backgroundColor: C.grayBg, borderRadius: 8, paddingHorizontal: 14, justifyContent: "center" },
  addBtnText: { fontWeight: "600", color: C.text },
  contact: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, marginBottom: 8 },
  contactName: { fontSize: 16, fontWeight: "600", color: C.text },
  url: { fontSize: 13, color: C.primary, marginTop: 4 },
  ruleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  rule: { fontSize: 15, color: C.text, flexShrink: 1 },
});

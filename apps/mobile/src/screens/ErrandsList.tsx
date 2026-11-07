import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { Errand } from "@nova26/shared";
import { api } from "../api";
import { Button, C, StatusPill } from "../ui";

export function ErrandsList({ onOpen, onNew }: { onOpen: (e: Errand) => void; onNew: () => void }) {
  const [errands, setErrands] = useState<Errand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { errands } = await api.listErrands();
      setErrands([...errands].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>Errands</Text>
        <Button title="+ New errand" onPress={onNew} big />
      </View>
      {error && <Text style={s.error}>{error}</Text>}
      <FlatList
        data={errands}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          !loading ? <Text style={s.empty}>No errands yet. Start one with “New errand”.</Text> : undefined
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle} numberOfLines={2}>
                {item.summary || item.objective || "(untitled)"}
              </Text>
              <Text style={s.rowMeta}>
                {item.onBehalfOf ? `For ${item.onBehalfOf} · ` : ""}
                {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
              </Text>
            </View>
            <StatusPill status={item.status} />
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 16, maxWidth: 900, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 30, fontWeight: "800", color: C.text },
  error: { color: C.red, marginBottom: 8 },
  empty: { color: C.muted, fontSize: 17, textAlign: "center", marginTop: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  rowTitle: { fontSize: 18, fontWeight: "600", color: C.text },
  rowMeta: { fontSize: 13, color: C.muted, marginTop: 4 },
});

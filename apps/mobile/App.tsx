// App entry: launches the single-patient hero flow. (The older errand screens in
// src/screens/* are kept for reference but are no longer the main flow.)
import React from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { HeroApp } from "./src/hero/HeroApp";
import { T } from "./src/hero/theme";

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root}>
        <StatusBar style="dark" />
        <HeroApp />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
});

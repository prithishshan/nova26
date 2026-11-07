import { Alert, Platform } from "react-native";

// Cross-platform yes/no confirm (Alert buttons don't work on web).
export function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(`${title}\n\n${message}`) : true);
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Run anyway", onPress: () => resolve(true) },
    ]),
  );
}

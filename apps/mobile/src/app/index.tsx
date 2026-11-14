import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

const APP_NAME =
  (Constants.expoConfig?.extra?.appName as string | undefined) ?? "Reading Companion";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.body}>Point your glasses at a page to start reading.</Text>
      {/* TODO(Alex): build order step 3+. Capture page, show highlighted phrase. */}
      <StatusBar style="auto" />
    </View>
  );
}

// Spacing-first typography (CLAUDE.md section 8): clean sans, generous letter/line spacing.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: { fontSize: 28, fontWeight: "600", letterSpacing: 0.5, marginBottom: 16 },
  body: { fontSize: 18, lineHeight: 30, letterSpacing: 0.4, textAlign: "center" },
});

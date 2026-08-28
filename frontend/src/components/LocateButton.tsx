import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useToast } from "@/src/components/Toast";
import { detectLocation, type LocResult } from "@/src/services/location";

/** "Use my location" button — resolves GPS → home location, handling denials. */
export function LocateButton({ onLocated }: { onLocated: (d: LocResult) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const press = async () => {
    if (busy) return;
    Haptics.selectionAsync();
    setBusy(true);
    const res = await detectLocation();
    setBusy(false);
    if (res.ok) {
      onLocated(res.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(`Located you in ${res.data.city || "your area"}.`, "success");
    } else if (res.reason === "blocked") {
      Alert.alert(
        "Location is off",
        "Turn on location access for Aura in Settings to auto-fill your area.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
    } else if (res.reason === "denied") {
      toast.show("Location permission denied.", "info");
    } else {
      toast.show("Couldn't get your location.", "error");
    }
  };

  return (
    <Pressable
      onPress={press}
      disabled={busy}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <Ionicons name="navigate" size={16} color={colors.brand} />
      )}
      <Text style={styles.text}>{busy ? "Locating…" : "Use my location"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
  text: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.brand },
});

// Global floating action button to push all settings to the matrix.
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";

const TAB_BAR_HEIGHT = 64;

export default function SyncFab() {
  const { bleStatus, syncAll, bleSupported } = useMatrix();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const connected = bleStatus === "connected";

  const onPress = async () => {
    if (busy) return;
    if (!connected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show(
        bleSupported
          ? "Connect to your matrix first (Device tab)."
          : "BLE needs a real device build to sync.",
        "info",
      );
      return;
    }
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await syncAll();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(
        res.confirmed ? "Matrix synced & confirmed." : "Settings sent to matrix.",
        "success",
      );
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show(e?.message ?? "Sync failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: TAB_BAR_HEIGHT + insets.bottom + spacing.md }]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.fab,
          !connected && styles.fabIdle,
          pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onBrandPrimary} />
        ) : (
          <>
            <Ionicons
              name="sync"
              size={20}
              color={connected ? colors.onBrandPrimary : colors.onSurfaceSecondary}
            />
            <Text style={[styles.label, !connected && styles.labelIdle]}>SYNC</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: spacing.lg,
    alignItems: "flex-end",
  },
  fab: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabIdle: {
    backgroundColor: colors.surfaceTertiary,
    shadowOpacity: 0,
    elevation: 0,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    color: colors.onBrandPrimary,
    letterSpacing: 1,
  },
  labelIdle: { color: colors.onSurfaceSecondary },
});

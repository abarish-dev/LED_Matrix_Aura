// Global floating action button to push all settings to the matrix.
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix, ACK_FW } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";

const TAB_BAR_HEIGHT = 64;

export default function SyncFab() {
  const { bleStatus, syncAll, bleSupported, firmwareVersion, pendingSections } = useMatrix();
  const pendingCount = Object.keys(pendingSections).length;
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const connected = bleStatus === "connected";

  const onPress = async () => {
    if (busy) return;
    if (!connected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show(
        !bleSupported
          ? "BLE needs a real device build to sync."
          : pendingCount
            ? "Matrix offline. Your changes are saved and will send when it connects (Device tab)."
            : "Connect to your matrix first (Device tab).",
        "info",
      );
      return;
    }
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const r = await syncAll();
      if (r.dropped) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toast.show("The matrix disconnected during sync. Reconnect on the Device tab and try again.", "error");
      } else if (r.ackSupported && !r.confirmed) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        toast.show("Sent, but the matrix didn't confirm. Tap Sync again.", "info");
      } else if (!r.ackSupported) {
        // Older (or unidentified) firmware can't confirm, and can't show the
        // second location; say so instead of claiming success.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        toast.show(
          firmwareVersion
            ? `Sent, but matrix firmware ${firmwareVersion} is too old to confirm it or show a 2nd ZIP. Install ${ACK_FW}+ on the Device tab.`
            : `Sent, but the matrix didn't report its firmware version, so it can't confirm. It may need ${ACK_FW}+ (Device tab).`,
          "info",
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast.show("Synced ✓  The matrix confirmed your settings.", "success");
      }
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
            {pendingCount > 0 && <View style={styles.pendingDot} testID="sync-pending-dot" />}
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
  // Unsent changes (made while the matrix was offline).
  pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning, marginLeft: 2 },
});

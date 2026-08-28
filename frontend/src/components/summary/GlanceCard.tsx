import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import ReorderableList, {
  useReorderableDrag,
  useIsActive,
} from "react-native-reorderable-list";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

export function GlanceCard({
  icon,
  accent,
  label,
  onPress,
  onLongPress,
  onHide,
  loading,
  active,
  dragging,
  compact,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  onHide?: () => void;
  loading?: boolean;
  active?: boolean;
  dragging?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      onLongPress={onLongPress}
      delayLongPress={220}
      style={({ pressed }) => [
        styles.glance,
        compact && styles.glanceCompact,
        active && styles.glanceActive,
        dragging && styles.glanceDragging,
        pressed && !dragging && { opacity: 0.85 },
      ]}
    >
      {onLongPress && (
        <Ionicons name="reorder-two" size={18} color={colors.surfaceTertiary} style={styles.grip} />
      )}
      <View style={[styles.glanceIcon, { backgroundColor: accent + "22" }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.glanceLabel}>{label}</Text>
        {children}
      </View>
      <View style={styles.trailing}>
        {onHide && (
          <Pressable
            hitSlop={10}
            onPress={() => {
              Haptics.selectionAsync();
              onHide();
            }}
            style={styles.hideBtn}
          >
            <Ionicons name="eye-off-outline" size={18} color={colors.onSurfaceSecondary} />
          </Pressable>
        )}
        {loading ? (
          <ActivityIndicator size="small" color={colors.onSurfaceSecondary} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.surfaceTertiary} />
        )}
      </View>
    </Pressable>
  );
}

/** Wraps a glance renderer with the reorderable drag/active hooks. */
export function ReorderGlance({
  render,
}: {
  render: (drag: () => void, dragging: boolean) => React.ReactNode;
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  return <>{render(drag, isActive)}</>;
}

const styles = StyleSheet.create({
  glance: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  glanceActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  glanceCompact: { padding: spacing.md },
  glanceDragging: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceTertiary },
  grip: { marginRight: -spacing.sm },
  glanceIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  glanceLabel: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.xs,
    color: colors.onSurfaceSecondary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hideBtn: { padding: 2 },
});

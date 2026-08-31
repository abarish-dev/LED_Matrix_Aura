import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

export function GlanceCard({
  icon,
  accent,
  label,
  onPress,
  onMoveUp,
  onMoveDown,
  onHide,
  loading,
  active,
  compact,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  label: string;
  onPress: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onHide?: () => void;
  loading?: boolean;
  active?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  const reorderable = onMoveUp !== undefined || onMoveDown !== undefined;
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.glance,
        compact && styles.glanceCompact,
        active && styles.glanceActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      {reorderable && (
        <View style={styles.reorder}>
          <Pressable
            hitSlop={8}
            disabled={!onMoveUp}
            onPress={() => {
              Haptics.selectionAsync();
              onMoveUp?.();
            }}
            style={styles.reorderBtn}
          >
            <Ionicons name="chevron-up" size={16} color={onMoveUp ? colors.onSurfaceSecondary : colors.surfaceTertiary} />
          </Pressable>
          <Pressable
            hitSlop={8}
            disabled={!onMoveDown}
            onPress={() => {
              Haptics.selectionAsync();
              onMoveDown?.();
            }}
            style={styles.reorderBtn}
          >
            <Ionicons name="chevron-down" size={16} color={onMoveDown ? colors.onSurfaceSecondary : colors.surfaceTertiary} />
          </Pressable>
        </View>
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
  reorder: { justifyContent: "center", marginRight: -spacing.xs, marginLeft: -spacing.xs },
  reorderBtn: { width: 24, height: 22, alignItems: "center", justifyContent: "center" },
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

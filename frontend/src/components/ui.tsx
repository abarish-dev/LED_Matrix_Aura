// Shared UI primitives for Aura (Dark-First Utility).
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

export function Hero({
  image,
  title,
  subtitle,
  icon,
  height = 190,
}: {
  image: string;
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  height?: number;
}) {
  return (
    <View style={[styles.hero, { height }]}>
      <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <LinearGradient
        colors={["rgba(9,9,11,0.15)", "rgba(9,9,11,0.55)", colors.surface]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.heroContent}>
        {icon && (
          <View style={styles.heroIcon}>
            <Ionicons name={icon} size={18} color={colors.brand} />
          </View>
        )}
        <Text style={styles.heroTitle}>{title}</Text>
        {subtitle && <Text style={styles.heroSubtitle}>{subtitle}</Text>}
      </View>
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function MasterToggle({
  value,
  onValueChange,
  label,
  description,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <Card style={styles.masterToggle}>
      <View style={{ flex: 1 }}>
        <Text style={styles.masterLabel}>{label}</Text>
        {description && <Text style={styles.masterDesc}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onValueChange(v);
        }}
        trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
        thumbColor={value ? "#ffffff" : "#71717a"}
        ios_backgroundColor={colors.surfaceTertiary}
      />
    </Card>
  );
}

export function ToggleRow({
  value,
  onValueChange,
  label,
  icon,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.rowLeft}>
        {icon && <Ionicons name={icon} size={18} color={colors.onSurfaceSecondary} />}
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onValueChange(v);
        }}
        trackColor={{ false: colors.surfaceTertiary, true: colors.brand }}
        thumbColor={value ? "#ffffff" : "#71717a"}
        ios_backgroundColor={colors.surfaceTertiary}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  loading,
  disabled,
  variant = "solid",
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  variant?: "solid" | "outline";
}) {
  const isOutline = variant === "outline";
  return (
    <Pressable
      onPress={() => {
        if (disabled || loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        isOutline ? styles.btnOutline : styles.btnSolid,
        (disabled || loading) && styles.btnDisabled,
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isOutline ? colors.brand : colors.onBrandPrimary} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={isOutline ? colors.brand : colors.onBrandPrimary}
            />
          )}
          <Text style={[styles.btnLabel, isOutline && { color: colors.brand }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.surfaceTertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMsg}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: "100%",
    justifyContent: "flex-end",
    backgroundColor: colors.surfaceSecondary,
  },
  heroContent: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  heroIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    color: colors.onSurface,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  heroSubtitle: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionLabel: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  masterToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  masterLabel: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onSurface,
  },
  masterDesc: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginTop: 2,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowLabel: {
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  btnSolid: { backgroundColor: colors.brand },
  btnOutline: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.brand,
  },
  btnDisabled: { opacity: 0.5 },
  btnLabel: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    color: colors.onBrandPrimary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["2xl"],
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  emptyMsg: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
  },
});

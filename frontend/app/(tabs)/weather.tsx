import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix, type Severity } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";
import { Hero, Card, SectionLabel, MasterToggle, PrimaryButton, ToggleRow } from "@/src/components/ui";

const HERO =
  "https://images.unsplash.com/photo-1630260667842-830a17d12ec9?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA0MTJ8MHwxfHNlYXJjaHwxfHxkYXJrJTIwc3Rvcm15JTIwd2VhdGhlciUyMHJhZGFyJTIwYWJzdHJhY3QlMjBtYXB8ZW58MHx8fHwxNzg3NjE0Mjc2fDA&ixlib=rb-4.1.0&q=85";

const SEVERITIES: {
  id: Severity;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}[] = [
  { id: "minor", label: "Minor", desc: "Advisories & special statements", icon: "information-circle", color: colors.info },
  { id: "moderate", label: "Moderate", desc: "Watches — be prepared", icon: "alert-circle", color: colors.warning },
  { id: "severe", label: "Severe", desc: "Warnings — take action", icon: "warning", color: "#f97316" },
  { id: "extreme", label: "Extreme", desc: "Life-threatening events only", icon: "flash", color: colors.error },
];

export default function WeatherScreen() {
  const { settings, updateWeather, bleStatus, weatherTest } = useMatrix();
  const w = settings.weather;
  const f = settings.flights;
  const located = f.lat != null && f.lon != null;
  const toast = useToast();

  const onPreview = async () => {
    if (bleStatus !== "connected") {
      toast.show("Connect to the matrix first (Device tab).", "info");
      return;
    }
    try {
      await weatherTest();
      toast.show("Sample alert sent to the matrix.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to send preview.", "error");
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Hero image={HERO} title="Weather Alerts" subtitle="Local NWS warnings" icon="thunderstorm" />

      <View style={styles.body}>
        <MasterToggle
          label="Weather Alerts"
          description="Flash NWS alerts for your area"
          value={w.enabled}
          onValueChange={(v) => updateWeather({ enabled: v })}
        />

        <Card style={styles.locCard}>
          <Ionicons
            name={located ? "location" : "location-outline"}
            size={18}
            color={located ? colors.success : colors.warning}
          />
          <Text style={styles.locText}>
            {located
              ? `Alerts for ${f.city || "your area"}, ${f.state}`
              : "Set your ZIP on the Flights tab to enable alerts."}
          </Text>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <ToggleRow
            label="Time & Temperature"
            icon="time"
            value={w.showClock}
            onValueChange={(v) => updateWeather({ showClock: v })}
          />
          <Text style={styles.clockHint}>
            Show a clock and the current local temperature on the matrix between
            other cards. The matrix keeps time over Wi-Fi.
          </Text>
        </Card>

        <SectionLabel>Minimum Severity</SectionLabel>
        {SEVERITIES.map((sev) => {
          const active = w.severity === sev.id;
          return (
            <Pressable
              key={sev.id}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                updateWeather({ severity: sev.id });
              }}
              style={[styles.sevCard, active && styles.sevCardActive]}
            >
              <View style={[styles.sevIcon, { backgroundColor: sev.color + "22" }]}>
                <Ionicons name={sev.icon} size={20} color={sev.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sevLabel}>{sev.label}</Text>
                <Text style={styles.sevDesc}>{sev.desc}</Text>
              </View>
              <View style={[styles.radio, active && styles.radioActive]}>
                {active && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          );
        })}

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton
            label="Preview Alert on Matrix"
            icon="eye"
            variant="outline"
            onPress={onPreview}
          />
        </View>

        <Text style={styles.footer}>
          The matrix checks api.weather.gov (US National Weather Service) for
          your location and flashes any alert at or above this level.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 150 },
  body: { paddingHorizontal: spacing.lg },
  locCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  locText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
  },
  clockHint: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  sevCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  sevCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
  sevIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sevLabel: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onSurface,
  },
  sevDesc: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { borderColor: colors.brand },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.brand,
  },
  footer: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    lineHeight: 18,
    marginTop: spacing.xl,
    textAlign: "center",
  },
});

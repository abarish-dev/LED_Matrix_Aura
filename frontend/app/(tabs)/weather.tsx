import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAudioPlayer } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix, fwAtLeast, ACK_FW, type Severity } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";
import { Hero, Card, SectionLabel, MasterToggle, PrimaryButton, ToggleRow } from "@/src/components/ui";
import { geocodeZip } from "@/src/services/geocode";
import { LocateButton } from "@/src/components/LocateButton";
import { RadarCard } from "@/src/components/RadarCard";
import {
  activeAlerts,
  severityColorHex,
  expiresLabel,
  locationInfo,
  type Alert,
  type LocationInfo,
} from "@/src/services/weather";

function isQuietNow(enabled: boolean, startHour: number, endHour: number): boolean {
  if (!enabled) return false;
  const h = new Date().getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour; // wraps midnight
}

function fmtHour(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr} ${period}`;
}

function HourStepper({ label, hour, onChange }: { label: string; hour: number; onChange: (h: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable onPress={() => { Haptics.selectionAsync(); onChange((hour + 23) % 24); }} style={styles.stepBtn}>
          <Ionicons name="remove" size={18} color={colors.brand} />
        </Pressable>
        <Text style={styles.stepperValue}>{fmtHour(hour)}</Text>
        <Pressable onPress={() => { Haptics.selectionAsync(); onChange((hour + 1) % 24); }} style={styles.stepBtn}>
          <Ionicons name="add" size={18} color={colors.brand} />
        </Pressable>
      </View>
    </View>
  );
}

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
  const { settings, updateWeather, updateQuietHours, updateRainQuiet, updateSecondLocation, updateFlights, bleStatus, weatherTest, waitForAck, firmwareVersion } = useMatrix();
  const insets = useSafeAreaInsets();
  const w = settings.weather;
  const f = settings.flights;
  const located = f.lat != null && f.lon != null;
  const toast = useToast();

  const [zip1, setZip1] = useState(f.zip);
  const [looking1, setLooking1] = useState(false);
  useEffect(() => setZip1(f.zip), [f.zip]);

  const onZip1 = async (val: string) => {
    const clean = val.replace(/[^0-9]/g, "").slice(0, 5);
    setZip1(clean);
    updateFlights({ zip: clean });
    if (clean.length === 5) {
      setLooking1(true);
      const res = await geocodeZip(clean);
      setLooking1(false);
      if (res) updateFlights({ lat: res.lat, lon: res.lon, city: res.city, state: res.state });
      else toast.show("Couldn't find that ZIP code.", "error");
    } else if (clean.length === 0) {
      updateFlights({ lat: null, lon: null, city: "", state: "" });
    }
  };

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [locInfo, setLocInfo] = useState<LocationInfo | null>(null);
  const [detail, setDetail] = useState<Alert | null>(null);
  const [secondAlerts, setSecondAlerts] = useState<Alert[]>([]);
  const [zip2, setZip2] = useState(w.secondLocation.zip);
  const fetchIdRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const seen2Ref = useRef<Set<string>>(new Set());
  const first2Ref = useRef(true);

  const chime = useAudioPlayer(require("@/assets/sounds/alert.wav"));

  useEffect(() => setZip2(w.secondLocation.zip), [w.secondLocation.zip]);

  const chimeFor = useCallback(
    (list: Alert[], seenRef: React.MutableRefObject<Set<string>>, firstRef: React.MutableRefObject<boolean>, label?: string) => {
      const fresh = list.filter(
        (a) => !seenRef.current.has(a.id) && (a.severity === "Severe" || a.severity === "Extreme"),
      );
      list.forEach((a) => seenRef.current.add(a.id));
      const quiet = isQuietNow(w.quietHours.enabled, w.quietHours.startHour, w.quietHours.endHour);
      const allowed = fresh.filter((a) => !(quiet && a.severity === "Severe"));
      if (!firstRef.current && allowed.length > 0 && w.alertSound) {
        try { chime.seekTo(0); chime.play(); } catch { /* web */ }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        toast.show(`⚠️ ${allowed[0].event}${label ? ` · ${label}` : ""}`, "error");
      }
      firstRef.current = false;
    },
    [w.alertSound, w.quietHours.enabled, w.quietHours.startHour, w.quietHours.endHour, chime, toast],
  );

  const loadAlerts = useCallback(async () => {
    if (f.lat == null || f.lon == null) return;
    const id = ++fetchIdRef.current;
    setAlertsLoading(true);
    const list = await activeAlerts(f.lat, f.lon);
    if (id !== fetchIdRef.current) return;
    chimeFor(list, seenIdsRef, firstLoadRef);
    setAlerts(list);
    setChecked(true);
    setAlertsLoading(false);
  }, [f.lat, f.lon, chimeFor]);

  useEffect(() => {
    if (f.lat == null || f.lon == null) return;
    firstLoadRef.current = true;
    seenIdsRef.current = new Set();
    loadAlerts();
    const iv = setInterval(loadAlerts, 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.lat, f.lon]);

  useEffect(() => {
    if (f.lat == null || f.lon == null) return;
    locationInfo(f.lat, f.lon).then(setLocInfo);
  }, [f.lat, f.lon]);

  // Second location alerts
  const s2 = w.secondLocation;
  const loadSecond = useCallback(async () => {
    if (s2.lat == null || s2.lon == null) {
      setSecondAlerts([]);
      return;
    }
    const list = await activeAlerts(s2.lat, s2.lon);
    chimeFor(list, seen2Ref, first2Ref, s2.city || "2nd");
    setSecondAlerts(list);
  }, [s2.lat, s2.lon, s2.city, chimeFor]);

  useEffect(() => {
    if (s2.lat == null || s2.lon == null) {
      setSecondAlerts([]);
      return;
    }
    first2Ref.current = true;
    seen2Ref.current = new Set();
    loadSecond();
    const iv = setInterval(loadSecond, 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s2.lat, s2.lon]);

  const onZip2 = async (val: string) => {
    const clean = val.replace(/[^0-9]/g, "").slice(0, 5);
    setZip2(clean);
    updateSecondLocation({ zip: clean });
    if (clean.length === 5) {
      const res = await geocodeZip(clean);
      if (!res) {
        toast.show("Couldn't find that ZIP code.", "error");
        return;
      }
      const place = `${res.city}, ${res.state}`;
      // Start listening before the (debounced) BLE push goes out.
      const canAck = bleStatus === "connected" && fwAtLeast(firmwareVersion, ACK_FW);
      const ack = canAck ? waitForAck("weather", 15000) : null;
      updateSecondLocation({ lat: res.lat, lon: res.lon, city: res.city, state: res.state });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (bleStatus !== "connected") {
        toast.show(`Watching ${place} here. Connect and Sync to put its alerts on the matrix.`, "info");
      } else if (!canAck) {
        toast.show(`Watching ${place}. Sent to the matrix — update its firmware to ${ACK_FW} to show these alerts on the wall.`, "info");
      } else {
        toast.show(`Watching ${place}. Sending to the matrix…`, "info");
        const got = await ack;
        if (got?.loc2) toast.show(`Matrix confirmed: ${place} alerts will show on the wall.`, "success");
        else toast.show(`The matrix didn't confirm ${place}. Tap Sync to retry.`, "error");
      }
    } else if (clean.length === 0) {
      updateSecondLocation({ lat: null, lon: null, city: "", state: "" });
      toast.show("Second location removed.", "info");
    }
  };

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
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 190 }]}
      showsVerticalScrollIndicator={false}
    >
      <Hero image={HERO} title="Weather Alerts" subtitle="Local NWS warnings" icon="thunderstorm" />

      <View style={styles.body}>
        {located && (locInfo?.county || locInfo?.city) && (
          <View style={styles.countyRow}>
            <Ionicons name="navigate-circle" size={16} color={colors.brand} />
            <Text style={styles.countyText}>
              {locInfo?.county ? `${locInfo.county} County` : ""}
              {locInfo?.county && locInfo?.state ? ", " : ""}
              {locInfo?.state || ""}
              {locInfo?.city ? `  ·  ${locInfo.city}` : ""}
            </Text>
          </View>
        )}

        {located && alerts.length > 0 && (
          <>
            <View style={styles.alertHeaderRow}>
              <SectionLabel>Active Alerts</SectionLabel>
              {alertsLoading && <ActivityIndicator size="small" color={colors.brand} style={styles.alertSpin} />}
            </View>
            {alerts.slice(0, 5).map((a, i) => {
              const c = severityColorHex(a.severity);
              return (
                <Pressable
                  key={a.id + i}
                  onPress={() => { Haptics.selectionAsync(); setDetail(a); }}
                  style={[styles.alertCard, { borderLeftColor: c }]}
                >
                  <View style={styles.alertTop}>
                    <Ionicons name="warning" size={16} color={c} />
                    <Text style={styles.alertEvent} numberOfLines={1}>{a.event}</Text>
                    <View style={[styles.sevChip, { backgroundColor: c + "22" }]}>
                      <Text style={[styles.sevChipText, { color: c }]}>{a.severity}</Text>
                    </View>
                  </View>
                  {!!a.area && <Text style={styles.alertArea} numberOfLines={2}>{a.area}</Text>}
                  <View style={styles.alertFootRow}>
                    {!!a.expires && <Text style={styles.alertExpires}>{expiresLabel(a.expires)}</Text>}
                    <Text style={styles.tapHint}>Tap for details ›</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}
        {located && checked && alerts.length === 0 && (
          <View style={styles.allClear}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.allClearText}>No active alerts for your area.</Text>
          </View>
        )}

        <MasterToggle
          label="Weather Alerts"
          description="Flash NWS alerts for your area"
          value={w.enabled}
          onValueChange={(v) => updateWeather({ enabled: v })}
        />

        <SectionLabel>Your Location</SectionLabel>
        <Card>
          <Text style={styles.fieldLabel}>Home ZIP code</Text>
          <View style={styles.zipRow}>
            <TextInput
              value={zip1}
              onChangeText={onZip1}
              placeholder="e.g. 28677"
              placeholderTextColor={colors.onSurfaceSecondary}
              keyboardType="number-pad"
              maxLength={5}
              style={[styles.input, { flex: 1 }]}
            />
            {looking1 ? (
              <ActivityIndicator size="small" color={colors.brand} style={styles.zipIcon} />
            ) : (
              <Ionicons
                name={located ? "location" : "location-outline"}
                size={22}
                color={located ? colors.success : colors.warning}
                style={styles.zipIcon}
              />
            )}
          </View>
          <Text style={styles.locText}>
            {looking1
              ? "Looking up location…"
              : located
                ? `Alerts & temperature for ${f.city || "your area"}, ${f.state}`
                : "Enter a US ZIP to set your weather location."}
          </Text>
          <Text style={styles.sharedHint}>
            This is your home location, also used by the Flights radar.
          </Text>
          <LocateButton
            onLocated={(d) => {
              setZip1(d.zip);
              updateFlights({ zip: d.zip, lat: d.lat, lon: d.lon, city: d.city, state: d.state });
            }}
          />
        </Card>

        {located && <RadarCard lat={f.lat!} lon={f.lon!} />}

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
          {w.showClock && (
            <>
              <View style={styles.hiLoDivider} />
              <ToggleRow
                label="Today's high / low"
                icon="thermometer"
                value={w.showHiLo}
                onValueChange={(v) => updateWeather({ showHiLo: v })}
              />
              <Text style={styles.clockHint}>
                Add today&apos;s high and low under the temperature on the matrix.
              </Text>
              <View style={styles.hiLoDivider} />
              <ToggleRow
                label="Feels-like temp"
                icon="body"
                value={w.showFeels}
                onValueChange={(v) => updateWeather({ showFeels: v })}
              />
              <Text style={styles.clockHint}>
                Show the &quot;feels like&quot; temperature on the matrix too.
              </Text>
              <View style={styles.hiLoDivider} />
              <ToggleRow
                label="Weather icon"
                icon="partly-sunny"
                value={w.showWxIcon}
                onValueChange={(v) => updateWeather({ showWxIcon: v })}
              />
              <Text style={styles.clockHint}>
                Draw a small sun / cloud / rain / storm symbol on the clock card.
              </Text>
            </>
          )}
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <ToggleRow
            label="Alert Chime"
            icon="notifications"
            value={w.alertSound}
            onValueChange={(v) => updateWeather({ alertSound: v })}
          />
          <Text style={styles.clockHint}>
            Play a chime on your phone when a new severe or extreme alert appears
            for your area.
          </Text>
          {w.alertSound && (
            <>
              <View style={styles.divider} />
              <ToggleRow
                label="Quiet hours"
                icon="moon"
                value={w.quietHours.enabled}
                onValueChange={(v) => updateQuietHours({ enabled: v })}
              />
              {w.quietHours.enabled && (
                <>
                  <View style={styles.nightRow}>
                    <HourStepper label="From" hour={w.quietHours.startHour} onChange={(h) => updateQuietHours({ startHour: h })} />
                    <HourStepper label="To" hour={w.quietHours.endHour} onChange={(h) => updateQuietHours({ endHour: h })} />
                  </View>
                  <Text style={styles.clockHint}>
                    During these hours only extreme alerts chime — lower-severity
                    ones stay silent so they don&apos;t wake you.
                  </Text>
                </>
              )}
            </>
          )}
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <ToggleRow
            label="Rain Arriving Alert"
            icon="rainy"
            value={w.rainAlert}
            onValueChange={(v) => updateWeather({ rainAlert: v })}
          />
          <Text style={styles.clockHint}>
            Show a heads-up on the Summary tab when rain is heading your way
            within the next hour.
          </Text>
          {w.rainAlert && (
            <>
              <View style={styles.divider} />
              <ToggleRow
                label="Quiet hours"
                icon="moon"
                value={w.rainQuiet.enabled}
                onValueChange={(v) => updateRainQuiet({ enabled: v })}
              />
              {w.rainQuiet.enabled && (
                <>
                  <View style={styles.nightRow}>
                    <HourStepper label="From" hour={w.rainQuiet.startHour} onChange={(h) => updateRainQuiet({ startHour: h })} />
                    <HourStepper label="To" hour={w.rainQuiet.endHour} onChange={(h) => updateRainQuiet({ endHour: h })} />
                  </View>
                  <Text style={styles.clockHint}>
                    During these hours the rain-arriving banner stays hidden so it
                    won&apos;t disturb you overnight.
                  </Text>
                </>
              )}
            </>
          )}
        </Card>

        <SectionLabel>Second Location</SectionLabel>
        <Card>
          <Text style={styles.fieldLabel}>A family member&apos;s ZIP</Text>
          <TextInput
            value={zip2}
            onChangeText={onZip2}
            placeholder="e.g. 33101"
            placeholderTextColor={colors.onSurfaceSecondary}
            keyboardType="number-pad"
            maxLength={5}
            style={styles.input}
          />
          {s2.lat != null ? (
            <Text style={styles.locText}>
              Watching {s2.city}, {s2.state}
              {secondAlerts.length > 0 ? ` · ${secondAlerts.length} alert${secondAlerts.length === 1 ? "" : "s"}` : " · all clear"}
            </Text>
          ) : (
            <Text style={styles.locText}>Add a second town to see its alerts here too.</Text>
          )}
          {secondAlerts.slice(0, 4).map((a, i) => {
            const c = severityColorHex(a.severity);
            return (
              <Pressable
                key={a.id + i}
                onPress={() => { Haptics.selectionAsync(); setDetail(a); }}
                style={[styles.alertCard, { borderLeftColor: c, marginTop: spacing.sm }]}
              >
                <View style={styles.alertTop}>
                  <Ionicons name="warning" size={16} color={c} />
                  <Text style={styles.alertEvent} numberOfLines={1}>{a.event}</Text>
                  <View style={[styles.sevChip, { backgroundColor: c + "22" }]}>
                    <Text style={[styles.sevChipText, { color: c }]}>{a.severity}</Text>
                  </View>
                </View>
                <View style={styles.alertFootRow}>
                  {!!a.expires && <Text style={styles.alertExpires}>{expiresLabel(a.expires)}</Text>}
                  <Text style={styles.tapHint}>Tap for details ›</Text>
                </View>
              </Pressable>
            );
          })}
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
      <AlertDetailModal alert={detail} onClose={() => setDetail(null)} />
    </ScrollView>
  );
}

function AlertDetailModal({ alert, onClose }: { alert: Alert | null; onClose: () => void }) {
  const c = alert ? severityColorHex(alert.severity) : colors.brand;
  return (
    <Modal
      visible={!!alert}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={[styles.modalHandle]} />
          {alert && (
            <>
              <View style={styles.modalHeader}>
                <View style={[styles.modalSevBar, { backgroundColor: c }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{alert.event}</Text>
                  <Text style={[styles.modalSev, { color: c }]}>
                    {alert.severity}
                    {alert.expires ? `  ·  ${expiresLabel(alert.expires)}` : ""}
                  </Text>
                </View>
                <Pressable hitSlop={10} onPress={onClose} style={styles.modalClose}>
                  <Ionicons name="close" size={22} color={colors.onSurfaceSecondary} />
                </Pressable>
              </View>
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                {!!alert.area && <Text style={styles.modalArea}>{alert.area}</Text>}
                {!!alert.headline && <Text style={styles.modalHeadline}>{alert.headline}</Text>}
                {!!alert.description && (
                  <>
                    <Text style={styles.modalLabel}>DETAILS</Text>
                    <Text style={styles.modalPara}>{alert.description}</Text>
                  </>
                )}
                {!!alert.instruction && (
                  <>
                    <Text style={styles.modalLabel}>WHAT TO DO</Text>
                    <Text style={[styles.modalPara, { color: colors.onSurface }]}>{alert.instruction}</Text>
                  </>
                )}
                <View style={{ height: 24 }} />
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 150 },
  body: { paddingHorizontal: spacing.lg },
  countyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  countyText: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  alertFootRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  tapHint: { fontFamily: fonts.textMedium, fontSize: fontSize.xs, color: colors.brand },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: "82%",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  modalSevBar: { width: 4, height: 40, borderRadius: 2 },
  modalTitle: { fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface },
  modalSev: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, marginTop: 2 },
  modalClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  modalBody: { marginTop: spacing.md },
  modalArea: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  modalHeadline: { fontFamily: fonts.textMedium, fontSize: fontSize.base, color: colors.onSurface, marginBottom: spacing.sm, lineHeight: 20 },
  modalLabel: { fontFamily: fonts.displayMedium, fontSize: fontSize.xs, color: colors.brand, letterSpacing: 1.5, marginTop: spacing.md, marginBottom: spacing.xs },
  modalPara: { fontFamily: fonts.text, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 21 },
  alertHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  alertSpin: { marginTop: spacing.lg, marginBottom: spacing.sm },
  alertCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  alertTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  alertEvent: { flex: 1, fontFamily: fonts.displayMedium, fontSize: fontSize.lg, color: colors.onSurface },
  sevChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  sevChipText: { fontFamily: fonts.textMedium, fontSize: 10, letterSpacing: 0.5 },
  alertArea: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 4 },
  alertExpires: { fontFamily: fonts.text, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 2 },
  allClear: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  allClearText: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  locCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  zipRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  zipIcon: { width: 28, textAlign: "center" },
  sharedHint: {
    fontFamily: fonts.text,
    fontSize: fontSize.xs,
    color: colors.onSurfaceTertiary,
    marginTop: spacing.xs,
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
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  hiLoDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  nightRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  stepper: { flex: 1 },
  stepperLabel: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    height: 44,
  },
  stepBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  stepperValue: { fontFamily: fonts.display, fontSize: fontSize.lg, color: colors.onSurface },
  fieldLabel: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.onSurface,
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
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

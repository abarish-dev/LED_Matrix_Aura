import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix, type WifiStatus } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";
import { Hero, Card, SectionLabel, PrimaryButton, ToggleRow } from "@/src/components/ui";
import { currentHoliday } from "@/src/utils/holidays";

const HERO =
  "https://images.pexels.com/photos/30547576/pexels-photo-30547576.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

function rssiBars(rssi: number | null): number {
  if (rssi == null) return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -78) return 2;
  return 1;
}

function fmtHour(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr} ${period}`;
}

function HourStepper({
  label,
  hour,
  onChange,
}: {
  label: string;
  hour: number;
  onChange: (h: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            onChange((hour + 23) % 24);
          }}
          style={styles.stepBtn}
        >
          <Ionicons name="remove" size={18} color={colors.brand} />
        </Pressable>
        <Text style={styles.stepperValue}>{fmtHour(hour)}</Text>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            onChange((hour + 1) % 24);
          }}
          style={styles.stepBtn}
        >
          <Ionicons name="add" size={18} color={colors.brand} />
        </Pressable>
      </View>
    </View>
  );
}

export default function DeviceScreen() {
  const {
    bleStatus,
    deviceName,
    rssi,
    bleSupported,
    connect,
    disconnect,
    flashTest,
    wifiStatus,
    wifiIp,
    lastSsid,
    sendWifi,
    settings,
    updateBrightness,
    updateNightMode,
    updateWeekend,
    updateHolidayThemes,
  } = useMatrix();
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [sending, setSending] = useState(false);
  const [bright, setBright] = useState(settings.brightness);

  useEffect(() => {
    if (lastSsid) setSsid(lastSsid);
  }, [lastSsid]);

  useEffect(() => setBright(settings.brightness), [settings.brightness]);

  const connecting = bleStatus === "scanning" || bleStatus === "connecting";
  const connected = bleStatus === "connected";

  const onPressStatus = async () => {
    if (connecting) return;
    if (connected) {
      await disconnect();
      toast.show("Disconnected from matrix.", "info");
      return;
    }
    try {
      const { name } = await connect();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(`Connected to ${name}.`, "success");
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show(e?.message ?? "Could not connect.", "error");
    }
  };

  const onSendWifi = async () => {
    if (!ssid.trim()) {
      toast.show("Enter a Wi-Fi network name.", "info");
      return;
    }
    if (!connected) {
      toast.show("Connect to the matrix first.", "info");
      return;
    }
    setSending(true);
    try {
      await sendWifi(ssid.trim(), pass);
      toast.show("Wi-Fi credentials sent to matrix.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to send Wi-Fi.", "error");
    } finally {
      setSending(false);
    }
  };

  const statusMeta = getStatusMeta(bleStatus);
  const bars = rssiBars(rssi);

  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 190 }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={20}
    >
      <Hero image={HERO} title="Aura" subtitle="LED Matrix Control" height={210} />

      <View style={styles.body}>
        {/* Connection */}
        <SectionLabel>Connection</SectionLabel>
        <Pressable onPress={onPressStatus} disabled={connecting}>
          <Card style={styles.statusCard}>
            <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>{statusMeta.title}</Text>
              <Text style={styles.statusSub}>
                {connected
                  ? deviceName ?? "Aura Matrix"
                  : connecting
                    ? "Searching over Bluetooth…"
                    : "Tap to connect over Bluetooth"}
              </Text>
            </View>
            {connected ? (
              <View style={styles.signal}>
                {[1, 2, 3, 4].map((b) => (
                  <View
                    key={b}
                    style={[
                      styles.signalBar,
                      { height: 6 + b * 4 },
                      b <= bars
                        ? { backgroundColor: colors.success }
                        : { backgroundColor: colors.surfaceTertiary },
                    ]}
                  />
                ))}
              </View>
            ) : (
              <Ionicons
                name={connecting ? "sync" : "bluetooth"}
                size={22}
                color={colors.brand}
              />
            )}
          </Card>
        </Pressable>

        {!bleSupported && (
          <Card style={styles.hintCard}>
            <Ionicons name="information-circle" size={18} color={colors.info} />
            <Text style={styles.hintText}>
              Bluetooth runs only in a real device build — not in Expo Go or web
              preview. The rest of the app works so you can configure everything.
            </Text>
          </Card>
        )}

        {connected && (
          <Pressable
            onPress={async () => {
              try {
                await flashTest();
                toast.show("Sent flash test to matrix.", "success");
              } catch (e: any) {
                toast.show(e?.message ?? "Failed.", "error");
              }
            }}
            style={({ pressed }) => [styles.flashBtn, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="flash" size={16} color={colors.brand} />
            <Text style={styles.flashText}>Flash test pattern</Text>
          </Pressable>
        )}

        {/* Display */}
        <SectionLabel>Display</SectionLabel>
        <Card>
          <View style={styles.radiusHeader}>
            <View style={styles.rowLeft}>
              <Ionicons name="sunny" size={18} color={colors.brand} />
              <Text style={styles.brightLabel}>Brightness</Text>
            </View>
            <Text style={styles.brightValue}>{bright}%</Text>
          </View>
          <Slider
            style={{ width: "100%", height: 40 }}
            minimumValue={5}
            maximumValue={100}
            step={1}
            value={bright}
            minimumTrackTintColor={colors.brand}
            maximumTrackTintColor={colors.surfaceTertiary}
            thumbTintColor="#ffffff"
            onValueChange={(v) => {
              setBright(Math.round(v));
              Haptics.selectionAsync();
            }}
            onSlidingComplete={(v) => updateBrightness(Math.round(v))}
          />
          <Text style={styles.brightHint}>Dim the matrix at night or crank it for daylight.</Text>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <ToggleRow
            label="Night Dimming"
            icon="moon"
            value={settings.nightMode.enabled}
            onValueChange={(v) => updateNightMode({ enabled: v })}
          />
          {settings.nightMode.enabled && (
            <>
              <View style={styles.nightDivider} />
              <View style={styles.nightRow}>
                <HourStepper
                  label="From"
                  hour={settings.nightMode.startHour}
                  onChange={(h) => updateNightMode({ startHour: h })}
                />
                <HourStepper
                  label="To"
                  hour={settings.nightMode.endHour}
                  onChange={(h) => updateNightMode({ endHour: h })}
                />
              </View>
              <View style={[styles.radiusHeader, { marginTop: spacing.md }]}>
                <Text style={styles.brightLabel}>Dim to</Text>
                <Text style={styles.brightValue}>{settings.nightMode.dimLevel}%</Text>
              </View>
              <Slider
                style={{ width: "100%", height: 40 }}
                minimumValue={0}
                maximumValue={80}
                step={5}
                value={settings.nightMode.dimLevel}
                minimumTrackTintColor={colors.brand}
                maximumTrackTintColor={colors.surfaceTertiary}
                thumbTintColor="#ffffff"
                onValueChange={() => Haptics.selectionAsync()}
                onSlidingComplete={(v) => updateNightMode({ dimLevel: Math.round(v) })}
              />
              <Text style={styles.brightHint}>
                Between these hours the matrix dims to this level automatically.
              </Text>

              <View style={styles.nightDivider} />
              <ToggleRow
                label="Separate weekend schedule"
                icon="calendar"
                value={settings.nightMode.weekend.enabled}
                onValueChange={(v) => updateWeekend({ enabled: v })}
              />
              {settings.nightMode.weekend.enabled && (
                <>
                  <Text style={[styles.brightHint, { marginBottom: spacing.sm }]}>
                    Used on Saturdays &amp; Sundays.
                  </Text>
                  <View style={styles.nightRow}>
                    <HourStepper
                      label="From"
                      hour={settings.nightMode.weekend.startHour}
                      onChange={(h) => updateWeekend({ startHour: h })}
                    />
                    <HourStepper
                      label="To"
                      hour={settings.nightMode.weekend.endHour}
                      onChange={(h) => updateWeekend({ endHour: h })}
                    />
                  </View>
                  <View style={[styles.radiusHeader, { marginTop: spacing.md }]}>
                    <Text style={styles.brightLabel}>Dim to</Text>
                    <Text style={styles.brightValue}>
                      {settings.nightMode.weekend.dimLevel}%
                    </Text>
                  </View>
                  <Slider
                    style={{ width: "100%", height: 40 }}
                    minimumValue={0}
                    maximumValue={80}
                    step={5}
                    value={settings.nightMode.weekend.dimLevel}
                    minimumTrackTintColor={colors.brand}
                    maximumTrackTintColor={colors.surfaceTertiary}
                    thumbTintColor="#ffffff"
                    onValueChange={() => Haptics.selectionAsync()}
                    onSlidingComplete={(v) => updateWeekend({ dimLevel: Math.round(v) })}
                  />
                </>
              )}
            </>
          )}
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <ToggleRow
            label="Holiday Themes"
            icon="color-palette"
            value={settings.holidayThemes}
            onValueChange={(v) => updateHolidayThemes(v)}
          />
          {settings.holidayThemes &&
            (() => {
              const h = currentHoliday();
              return (
                <View style={styles.holidayRow}>
                  {h ? (
                    <>
                      <Text style={styles.holidayEmoji}>{h.emoji}</Text>
                      <Text style={styles.holidayText}>Today: {h.name}</Text>
                      <View style={styles.swatches}>
                        <View style={[styles.swatch, { backgroundColor: h.colors[0] }]} />
                        <View style={[styles.swatch, { backgroundColor: h.colors[1] }]} />
                      </View>
                    </>
                  ) : (
                    <Text style={styles.holidayText}>
                      No holiday today — the wall uses its normal amber accent.
                    </Text>
                  )}
                </View>
              );
            })()}
          <Text style={styles.brightHint}>
            The matrix shifts its accent colors on holidays (red/green in December, etc.).
          </Text>
        </Card>

        {/* Wi-Fi */}
        <SectionLabel>Wi-Fi Setup</SectionLabel>
        <Card>
          <Text style={styles.fieldLabel}>Network name (SSID)</Text>
          <TextInput
            value={ssid}
            onChangeText={setSsid}
            placeholder="MyHomeWiFi"
            placeholderTextColor={colors.onSurfaceSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Password</Text>
          <View style={styles.passRow}>
            <TextInput
              value={pass}
              onChangeText={setPass}
              placeholder="••••••••"
              placeholderTextColor={colors.onSurfaceSecondary}
              secureTextEntry={!showPass}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
            />
            <Pressable onPress={() => setShowPass((v) => !v)} style={styles.eye}>
              <Ionicons
                name={showPass ? "eye-off" : "eye"}
                size={20}
                color={colors.onSurfaceSecondary}
              />
            </Pressable>
          </View>

          {wifiStatus !== "idle" && (
            <View style={[styles.wifiBanner, wifiBannerStyle(wifiStatus)]}>
              <Ionicons
                name={wifiBannerIcon(wifiStatus)}
                size={16}
                color={wifiBannerColor(wifiStatus)}
              />
              <Text style={[styles.wifiBannerText, { color: wifiBannerColor(wifiStatus) }]}>
                {wifiStatusLabel(wifiStatus, wifiIp)}
              </Text>
            </View>
          )}

          <View style={{ marginTop: spacing.lg }}>
            <PrimaryButton
              label={wifiStatus === "failed" ? "Resend Wi-Fi" : "Send to Matrix"}
              icon="wifi"
              onPress={onSendWifi}
              loading={sending}
            />
          </View>
        </Card>

        <Text style={styles.footer}>
          Aura provisions your matrix over Bluetooth. Once it joins Wi-Fi, the
          display pulls live flights, scores and weather on its own.
        </Text>
      </View>
    </KeyboardAwareScrollView>
  );
}

function getStatusMeta(s: string) {
  switch (s) {
    case "connected":
      return { title: "Connected", color: colors.success };
    case "scanning":
      return { title: "Scanning…", color: colors.warning };
    case "connecting":
      return { title: "Connecting…", color: colors.warning };
    default:
      return { title: "Disconnected", color: colors.onSurfaceSecondary };
  }
}

function wifiStatusLabel(s: WifiStatus, ip: string | null): string {
  switch (s) {
    case "sending":
      return "Sending credentials…";
    case "waiting":
      return "Sent · waiting for matrix to join…";
    case "joined":
      return ip ? `Matrix joined Wi-Fi · ${ip}` : "Matrix joined Wi-Fi";
    case "failed":
      return "Matrix couldn't join — check password and resend.";
    default:
      return "";
  }
}
function wifiBannerColor(s: WifiStatus): string {
  if (s === "joined") return colors.success;
  if (s === "failed") return colors.error;
  return colors.info;
}
function wifiBannerIcon(s: WifiStatus): keyof typeof Ionicons.glyphMap {
  if (s === "joined") return "checkmark-circle";
  if (s === "failed") return "alert-circle";
  return "time";
}
function wifiBannerStyle(s: WifiStatus) {
  return { borderColor: wifiBannerColor(s) };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 150 },
  body: { paddingHorizontal: spacing.lg },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusTitle: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onSurface,
  },
  statusSub: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginTop: 1,
  },
  signal: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 24 },
  signalBar: { width: 4, borderRadius: 2 },
  hintCard: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    alignItems: "flex-start",
  },
  hintText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    lineHeight: 18,
  },
  flashBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  flashText: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.sm,
    color: colors.brand,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  radiusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  brightLabel: {
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  brightValue: {
    fontFamily: fonts.displayBold,
    fontSize: fontSize.xl,
    color: colors.brand,
  },
  brightHint: {
    fontFamily: fonts.text,
    fontSize: fontSize.xs,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.xs,
  },
  holidayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  holidayEmoji: { fontSize: 20 },
  holidayText: { flex: 1, fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurface },
  swatches: { flexDirection: "row", gap: 6 },
  swatch: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  nightDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  nightRow: { flexDirection: "row", gap: spacing.md },
  stepper: { flex: 1 },
  stepperLabel: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginBottom: spacing.xs,
  },
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
  stepBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    fontFamily: fonts.display,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  fieldLabel: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginBottom: spacing.xs,
  },
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
  passRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eye: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
  },
  wifiBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    backgroundColor: colors.surfaceTertiary,
  },
  wifiBannerText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
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

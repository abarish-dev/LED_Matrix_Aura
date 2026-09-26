import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
    connectToPicked,
    dismissPicker,
    pickerDevices,
    disconnect,
    flashTest,
    wifiStatus,
    wifiIp,
    lastSsid,
    sendWifi,
    settings,
    firmwareVersion,
    installOta,
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
  const [aboutTaps, setAboutTaps] = useState(0);
  const [showAbout, setShowAbout] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [fwLatest, setFwLatest] = useState<{ version: string; update: boolean } | null>(null);

  // When the hidden About panel opens, ask the backend what the latest firmware
  // is (so we can show "update available" against the connected board's version).
  useEffect(() => {
    if (!showAbout) return;
    const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
    if (!base) return;
    fetch(`${base}/api/firmware/latest?current=${encodeURIComponent(firmwareVersion ?? "")}`)
      .then((r) => r.json())
      .then((d) => setFwLatest({ version: d.version ?? "", update: !!d.update }))
      .catch(() => setFwLatest(null));
  }, [showAbout, firmwareVersion]);

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
      const { name, picker } = await connect();
      if (picker) return; // multiple displays found — the picker sheet handles the rest
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(`Connected to ${name}.`, "success");
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show(e?.message ?? "Could not connect.", "error");
    }
  };

  const onPickDevice = async (deviceId: string) => {
    setPickingId(deviceId);
    try {
      const { name } = await connectToPicked(deviceId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(`Connected to ${name}.`, "success");
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show(e?.message ?? "Could not connect.", "error");
    } finally {
      setPickingId(null);
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
    <>
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
              <ToggleRow
                label="Sunset to sunrise"
                icon="partly-sunny"
                value={settings.nightMode.useSunset}
                onValueChange={(v) => updateNightMode({ useSunset: v })}
              />
              {!settings.nightMode.useSunset && (
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
                </>
              )}
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
                {settings.nightMode.useSunset
                  ? "The matrix dims to this level from local sunset to sunrise, adjusting with the seasons."
                  : "Between these hours the matrix dims to this level automatically."}
              </Text>

              {!settings.nightMode.useSunset && (
                <>
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

        <Pressable
          onPress={() => {
            const n = aboutTaps + 1;
            setAboutTaps(n);
            if (n >= 7 && !showAbout) {
              setShowAbout(true);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          }}
        >
          <Text style={styles.footer}>
            Aura provisions your matrix over Bluetooth. Once it joins Wi-Fi, the
            display pulls live flights, scores and weather on its own.
          </Text>
        </Pressable>

        {showAbout && (
          <Card style={styles.aboutCard}>
            <View style={styles.aboutHeader}>
              <Ionicons name="hardware-chip" size={16} color={colors.brand} />
              <Text style={styles.aboutTitle}>Device Info</Text>
            </View>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutKey}>Firmware</Text>
              <Text style={styles.aboutVal}>
                {firmwareVersion
                  ? `v${firmwareVersion}`
                  : connected
                    ? "requesting…"
                    : "connect to read"}
              </Text>
            </View>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutKey}>Device</Text>
              <Text style={styles.aboutVal}>{deviceName ?? "—"}</Text>
            </View>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutKey}>Wi-Fi IP</Text>
              <Text style={styles.aboutVal}>{wifiIp ?? "—"}</Text>
            </View>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutKey}>Signal</Text>
              <Text style={styles.aboutVal}>{rssi != null ? `${rssi} dBm` : "—"}</Text>
            </View>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutKey}>Latest firmware</Text>
              <Text style={styles.aboutVal}>
                {fwLatest?.version ? `v${fwLatest.version}` : "none uploaded"}
              </Text>
            </View>
            {fwLatest?.update && connected && (
              <View style={{ marginTop: spacing.sm }}>
                <PrimaryButton
                  label="Install update over Wi-Fi"
                  onPress={async () => {
                    await installOta();
                    toast.show("Update sent — the matrix will install & reboot", "success");
                  }}
                />
              </View>
            )}
          </Card>
        )}
      </View>
    </KeyboardAwareScrollView>

    <Modal
      visible={!!pickerDevices && pickerDevices.length > 0}
      transparent
      animationType="fade"
      onRequestClose={dismissPicker}
    >
      <Pressable style={styles.modalBackdrop} onPress={dismissPicker}>
        <Pressable style={styles.pickerSheet} onPress={() => {}}>
          <View style={styles.modalHandle} />
          <Text style={styles.pickerTitle}>Multiple displays found</Text>
          <Text style={styles.pickerSubtitle}>
            Pick the one you want to connect to — each board shows its own ID on its
            screen while it&apos;s booting or waiting for Wi-Fi.
          </Text>
          {(pickerDevices ?? []).map((d) => {
            const isPicking = pickingId === d.id;
            return (
              <Pressable
                key={d.id}
                onPress={() => onPickDevice(d.id)}
                disabled={!!pickingId}
                style={({ pressed }) => [
                  styles.pickerRow,
                  pressed && { opacity: 0.85 },
                  isPicking && { opacity: 0.6 },
                ]}
              >
                <Ionicons name="hardware-chip" size={20} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerRowName}>{d.name}</Text>
                  <Text style={styles.pickerRowSignal}>
                    {d.rssi != null ? `${rssiBars(d.rssi)}/4 signal bars` : "signal unknown"}
                  </Text>
                </View>
                {isPicking ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
                )}
              </Pressable>
            );
          })}
          <Pressable style={styles.pickerCancel} onPress={dismissPicker}>
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    </>
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
  aboutCard: { marginTop: spacing.md },
  aboutHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  aboutTitle: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.sm,
    color: colors.onSurface,
    letterSpacing: 0.3,
  },
  aboutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  aboutKey: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
  },
  aboutVal: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.sm,
    color: colors.onSurface,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  pickerSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  pickerTitle: {
    fontFamily: fonts.textSemiBold,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    textAlign: "center",
  },
  pickerSubtitle: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 56,
  },
  pickerRowName: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.md,
    color: colors.onSurface,
  },
  pickerRowSignal: {
    fontFamily: fonts.text,
    fontSize: fontSize.xs,
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },
  pickerCancel: {
    alignItems: "center",
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  pickerCancelText: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.md,
    color: colors.onSurfaceSecondary,
  },
});

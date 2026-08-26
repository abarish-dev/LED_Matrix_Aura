import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";
import { nearbyPlanes, compass, airlineLogoUrl, type Plane } from "@/src/services/adsb";
import { getTeamScore, type ScoreLine } from "@/src/services/espn";
import {
  activeAlerts,
  currentConditions,
  severityColorHex,
  type Alert,
  type CurrentWx,
} from "@/src/services/weather";
import { findTeam, teamLogoUrl, readableOn } from "@/src/data/teams";

const CHEVRON = require("@/assets/images/splash-image.png");
const REFRESH_MS = 30000;

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** "3h 12m" / "2d 4h" / "12m" until an ISO timestamp, or null if past. */
function until(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return null;
  const mins = Math.floor(diff / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "under 1m";
}

function GlanceCard({
  icon,
  accent,
  label,
  onPress,
  loading,
  active,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  label: string;
  onPress: () => void;
  loading?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.glance,
        active && styles.glanceActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.glanceIcon, { backgroundColor: accent + "22" }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.glanceLabel}>{label}</Text>
        {children}
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={colors.onSurfaceSecondary} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.surfaceTertiary} />
      )}
    </Pressable>
  );
}

export default function SummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { settings, bleStatus, deviceName, connect, flashTest, updateFlights } = useMatrix();
  const f = settings.flights;
  const located = f.lat != null && f.lon != null;

  const favKey = settings.sports.favorite;
  const favTeam =
    (favKey ? settings.sports.teams.find((t) => `${t.league}:${t.abbr}` === favKey) : null) ??
    settings.sports.teams[0] ??
    null;

  const [plane, setPlane] = useState<Plane | null>(null);
  const [planeLoading, setPlaneLoading] = useState(false);
  const [score, setScore] = useState<ScoreLine | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [wx, setWx] = useState<CurrentWx | null>(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const reqRef = useRef(0);
  const nextRefreshRef = useRef(Date.now() + REFRESH_MS);
  const missRef = useRef(0);

  // Detect if a fetched list still contains the auto-pinned flight; auto-revert
  // to normal once it leaves range (only counts misses when other planes are
  // visible, so the web preview's empty ADS-B response won't false-trigger).
  const checkAutoTrack = useCallback(
    (list: Plane[]) => {
      if (!(f.trackFlight && f.autoTracked && f.flightIdent)) return;
      if (list.length === 0) return; // inconclusive
      const stillUp = list.some((p) => norm(p.callsign) === f.flightIdent);
      if (stillUp) {
        missRef.current = 0;
      } else if (++missRef.current >= 2) {
        missRef.current = 0;
        updateFlights({ trackFlight: false, flightIdent: "", autoTracked: false });
        toast.show(`${f.flightIdent} left range — back to normal.`, "info");
      }
    },
    [f.trackFlight, f.autoTracked, f.flightIdent, updateFlights, toast],
  );

  const loadAll = useCallback(async () => {
    const id = ++reqRef.current;
    nextRefreshRef.current = Date.now() + REFRESH_MS;

    if (located) {
      setWxLoading(true);
      currentConditions(f.lat!, f.lon!).then((w) => {
        if (id === reqRef.current) {
          setWx(w);
          setWxLoading(false);
        }
      });
      activeAlerts(f.lat!, f.lon!).then((list) => {
        if (id === reqRef.current) setAlert(list[0] ?? null);
      });
      setPlaneLoading(true);
      nearbyPlanes(f.lat!, f.lon!, f.radiusMi, 8).then((list) => {
        if (id === reqRef.current) {
          setPlane(list[0] ?? null);
          setPlaneLoading(false);
          checkAutoTrack(list);
        }
      });
    }

    if (favTeam) {
      setScoreLoading(true);
      getTeamScore(favTeam.league, favTeam.abbr).then((line) => {
        if (id === reqRef.current) {
          setScore(line);
          setScoreLoading(false);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, f.lat, f.lon, f.radiusMi, favTeam?.league, favTeam?.abbr, checkAutoTrack]);

  useEffect(() => {
    loadAll();
    const iv = setInterval(loadAll, REFRESH_MS);
    return () => clearInterval(iv);
  }, [loadAll]);

  // 1-second ticker drives the live countdowns.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setTimeout(() => setRefreshing(false), 700);
  }, [loadAll]);

  const connected = bleStatus === "connected";
  const connecting = bleStatus === "scanning" || bleStatus === "connecting";

  const onConnect = async () => {
    if (connecting || connected) {
      router.push("/device");
      return;
    }
    try {
      const { name } = await connect();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(`Connected to ${name}.`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not connect.", "error");
    }
  };

  const onFlash = async () => {
    if (!connected) {
      toast.show("Connect to the matrix first.", "info");
      return;
    }
    try {
      await flashTest();
      toast.show("Sent flash test to matrix.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed.", "error");
    }
  };

  const isTracked =
    plane != null && f.trackFlight && f.flightIdent === norm(plane.callsign);

  const onPlaneTap = () => {
    if (!located) {
      router.push("/flights");
      return;
    }
    if (!plane) {
      router.push("/flights");
      return;
    }
    if (isTracked) {
      updateFlights({ trackFlight: false, flightIdent: "", autoTracked: false });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(`Stopped tracking ${plane.callsign}.`, "info");
    } else {
      missRef.current = 0;
      updateFlights({ trackFlight: true, flightIdent: norm(plane.callsign), autoTracked: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(`Pinned ${plane.callsign} to the wall.`, "success");
    }
  };

  const favMeta = favTeam ? findTeam(favTeam.league, favTeam.abbr) : undefined;
  const secsToRefresh = Math.max(0, Math.ceil((nextRefreshRef.current - now) / 1000));
  const gameCountdown = score?.state === "pre" ? until(score.startTime, now) : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
      }
    >
      {/* Branded header */}
      <View style={styles.header}>
        <Image source={CHEVRON} style={styles.logo} contentFit="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.brandName}>AURA</Text>
          <Text style={styles.brandSub}>Live Summary</Text>
        </View>
        <View style={styles.livePill}>
          <View style={styles.livePulse} />
          <Text style={styles.liveText}>{secsToRefresh}s</Text>
        </View>
      </View>

      {/* Connection status */}
      <Pressable
        onPress={onConnect}
        style={({ pressed }) => [styles.statusPill, pressed && { opacity: 0.85 }]}
      >
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: connected
                ? colors.success
                : connecting
                  ? colors.warning
                  : colors.onSurfaceSecondary,
            },
          ]}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.statusTitle}>
            {connected ? "Matrix Connected" : connecting ? "Connecting…" : "Matrix Offline"}
          </Text>
          <Text style={styles.statusSub}>
            {connected
              ? deviceName ?? "Aura Matrix"
              : connecting
                ? "Searching over Bluetooth…"
                : "Tap to connect over Bluetooth"}
          </Text>
        </View>
        <Ionicons
          name={connected ? "bluetooth" : "bluetooth-outline"}
          size={20}
          color={connected ? colors.brand : colors.onSurfaceSecondary}
        />
      </Pressable>

      <Text style={styles.sectionLabel}>On The Wall Now</Text>

      {/* Overhead flight — tap to pin/unpin as tracked flight */}
      <GlanceCard
        icon="airplane"
        accent={isTracked ? colors.brand : colors.info}
        label="Overhead"
        loading={planeLoading}
        active={isTracked}
        onPress={onPlaneTap}
      >
        {!located ? (
          <Text style={styles.glanceHint}>Set your ZIP on the Flights tab</Text>
        ) : plane ? (
          <>
            <View style={styles.planeLine}>
              {plane.airlineIata ? (
                <Image
                  source={{ uri: airlineLogoUrl(plane.airlineIata) }}
                  style={styles.planeLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : null}
              <Text style={styles.glanceValue} numberOfLines={1}>
                {plane.callsign}
                {plane.airlineName ? ` · ${plane.airlineName}` : ""}
              </Text>
              {isTracked && (
                <View style={styles.trackTag}>
                  <Text style={styles.trackTagText}>TRACKING</Text>
                </View>
              )}
            </View>
            <Text style={styles.glanceMeta}>
              {plane.from && plane.to ? `${plane.from} → ${plane.to}  ·  ` : ""}
              {plane.altFt ? `${plane.altFt.toLocaleString()} ft  ·  ` : ""}
              {plane.distanceMi} mi{plane.headingDeg >= 0 ? ` ${compass(plane.headingDeg)}` : ""}
            </Text>
            <Text style={[styles.tapHint, isTracked && { color: colors.brand }]}>
              {isTracked ? "Pinned to the wall · tap to stop" : "Tap to pin this flight to the wall"}
            </Text>
          </>
        ) : (
          <Text style={styles.glanceHint}>
            {planeLoading
              ? "Scanning the sky…"
              : `No aircraft in range · rescanning in ${secsToRefresh}s`}
          </Text>
        )}
      </GlanceCard>

      {/* Favorite team */}
      <GlanceCard
        icon="trophy"
        accent={colors.brand}
        label={favTeam ? `${favTeam.league} · ${favMeta?.name ?? favTeam.abbr}` : "Sports"}
        loading={scoreLoading}
        onPress={() => router.push("/sports")}
      >
        {!favTeam ? (
          <Text style={styles.glanceHint}>Pick a team on the Sports tab</Text>
        ) : score ? (
          <>
            <View style={styles.scoreLine}>
              {favMeta && (
                <View style={[styles.teamBadge, { backgroundColor: favMeta.color }]}>
                  <Text style={[styles.teamBadgeText, { color: readableOn(favMeta.color) }]}>
                    {favTeam.abbr}
                  </Text>
                  <Image
                    source={{ uri: teamLogoUrl(favTeam.league, favTeam.abbr) }}
                    style={[StyleSheet.absoluteFill, { padding: 4 }]}
                    contentFit="contain"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                </View>
              )}
              <Text
                style={[styles.glanceValue, score.state === "in" && { color: colors.brand }]}
                numberOfLines={1}
              >
                {score.state === "pre"
                  ? `${score.atHome ? "vs" : "@"} ${score.oppAbbr}`
                  : `${favTeam.abbr} ${score.teamScore ?? 0}–${score.oppScore ?? 0} ${score.oppAbbr}`}
              </Text>
            </View>
            <Text
              style={[
                styles.glanceMeta,
                score.state === "in" && { color: colors.brand, fontFamily: fonts.textMedium },
              ]}
            >
              {score.state === "in"
                ? `🔴 LIVE · ${score.detail}`
                : score.state === "post"
                  ? score.detail
                  : gameCountdown
                    ? `Starts in ${gameCountdown} · ${score.detail}`
                    : score.detail}
            </Text>
          </>
        ) : (
          <Text style={styles.glanceHint}>
            {scoreLoading ? "Loading score…" : "No recent game · needs phone app"}
          </Text>
        )}
      </GlanceCard>

      {/* Weather / temperature */}
      <GlanceCard
        icon={(wx?.icon as keyof typeof Ionicons.glyphMap) ?? "partly-sunny"}
        accent={colors.warning}
        label="Weather"
        loading={wxLoading}
        onPress={() => router.push("/weather")}
      >
        {!located ? (
          <Text style={styles.glanceHint}>Set your ZIP on the Flights tab</Text>
        ) : wx ? (
          <>
            <Text style={styles.glanceValue}>
              {wx.tempF}°F · {wx.label}
            </Text>
            <Text style={styles.glanceMeta}>
              {wx.isRaining
                ? "🌧️ Raining now"
                : wx.rainChance != null && wx.rainChance >= 30
                  ? `☔ ${wx.rainChance}% chance of rain today`
                  : "No rain expected"}
              {f.city ? `  ·  ${f.city}` : ""}
            </Text>
          </>
        ) : (
          <Text style={styles.glanceHint}>{wxLoading ? "Checking conditions…" : "Unavailable"}</Text>
        )}
      </GlanceCard>

      {/* Weather alert (only when active) */}
      {alert && (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/weather");
          }}
          style={({ pressed }) => [
            styles.alertCard,
            { borderLeftColor: severityColorHex(alert.severity) },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="warning" size={18} color={severityColorHex(alert.severity)} />
          <View style={{ flex: 1 }}>
            <Text style={styles.alertEvent} numberOfLines={1}>
              {alert.event}
            </Text>
            <Text style={styles.alertArea} numberOfLines={1}>
              {alert.area || alert.severity}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.surfaceTertiary} />
        </Pressable>
      )}

      <Text style={styles.sectionLabel}>Quick Controls</Text>
      <View style={styles.quickRow}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/device");
          }}
          style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="options" size={22} color={colors.brand} />
          <Text style={styles.quickText}>Settings</Text>
        </Pressable>
        <Pressable
          onPress={onFlash}
          style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="flash" size={22} color={connected ? colors.brand : colors.surfaceTertiary} />
          <Text style={[styles.quickText, !connected && { color: colors.onSurfaceSecondary }]}>
            Flash Test
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/weather");
          }}
          style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="thunderstorm" size={22} color={colors.brand} />
          <Text style={styles.quickText}>Alerts</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>
        A live glance at everything on your matrix. Pull down to refresh. Flights and
        scores stream on the phone build; weather works everywhere.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 150 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl },
  logo: { width: 52, height: 52 },
  brandName: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.onSurface, letterSpacing: 2 },
  brandSub: { fontFamily: fonts.text, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: -2 },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  livePulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveText: {
    fontFamily: fonts.mono,
    fontSize: fontSize.xs,
    color: colors.onSurfaceSecondary,
    letterSpacing: 0.5,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusTitle: { fontFamily: fonts.display, fontSize: fontSize.xl, color: colors.onSurface },
  statusSub: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 1 },
  sectionLabel: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
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
  glanceIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  glanceLabel: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.xs,
    color: colors.onSurfaceSecondary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  glanceValue: { fontFamily: fonts.display, fontSize: fontSize.lg, color: colors.onSurface, flexShrink: 1 },
  glanceMeta: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  glanceHint: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  tapHint: { fontFamily: fonts.textMedium, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 4 },
  planeLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  planeLogo: { width: 22, height: 22 },
  trackTag: { backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  trackTagText: { fontFamily: fonts.textMedium, fontSize: 9, color: colors.onBrandPrimary, letterSpacing: 0.5 },
  scoreLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  teamBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  teamBadgeText: { fontFamily: fonts.displayBold, fontSize: 10 },
  alertCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  alertEvent: { fontFamily: fonts.displayMedium, fontSize: fontSize.lg, color: colors.onSurface },
  alertArea: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 1 },
  quickRow: { flexDirection: "row", gap: spacing.sm },
  quickBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
  },
  quickText: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.onSurface },
  footer: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    lineHeight: 18,
    marginTop: spacing.xl,
    textAlign: "center",
  },
});

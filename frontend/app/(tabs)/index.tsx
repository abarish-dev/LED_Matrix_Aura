import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useAudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";
import { storage } from "@/src/utils/storage";
import { nearbyPlanes, compass, airlineLogoUrl, type Plane } from "@/src/services/adsb";
import { getTeamScore, getTeamStreak, getNextUfc, type ScoreLine, type UfcEvent } from "@/src/services/espn";
import {
  activeAlerts,
  currentConditions,
  isQuietNow,
  rainArriving,
  severityColorHex,
  type Alert,
  type CurrentWx,
  type RainSoon,
} from "@/src/services/weather";
import { findTeam, teamLogoUrl, readableOn } from "@/src/data/teams";
import { GlanceCard } from "@/src/components/summary/GlanceCard";
import { RadarCard } from "@/src/components/RadarCard";
import {
  REFRESH_MS,
  ORDER_KEY,
  HIDDEN_KEY,
  COMPACT_KEY,
  DEFAULT_ORDER,
  CARD_ICON,
  CARD_LABEL,
  norm,
  accentFor,
  wxGlyph,
  wxAccent,
  until,
  type LandingInfo,
} from "@/src/components/summary/helpers";

const CHEVRON = require("@/assets/images/splash-image.png");

type CardMove = { onMoveUp?: () => void; onMoveDown?: () => void };

export default function SummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { settings, bleStatus, deviceName, connect, flashTest, updateFlights } = useMatrix();
  const f = settings.flights;
  const located = f.lat != null && f.lon != null;

  const teamByKey = (key?: string) =>
    key ? settings.sports.teams.find((t) => `${t.league}:${t.abbr}` === key) ?? null : null;
  const favTeam = teamByKey(settings.sports.favorites[0]) ?? settings.sports.teams[0] ?? null;
  const secondTeam = teamByKey(settings.sports.favorites[1]);
  const thirdTeam = teamByKey(settings.sports.favorites[2]);

  const [planes, setPlanes] = useState<Plane[]>([]);
  const [planeIdx, setPlaneIdx] = useState(0);
  const [planeLoading, setPlaneLoading] = useState(false);
  const [score, setScore] = useState<ScoreLine | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [score2, setScore2] = useState<ScoreLine | null>(null);
  const [streak2, setStreak2] = useState<string | null>(null);
  const [score3, setScore3] = useState<ScoreLine | null>(null);
  const [streak3, setStreak3] = useState<string | null>(null);
  const [ufc, setUfc] = useState<UfcEvent | null>(null);
  const [ufcLoading, setUfcLoading] = useState(false);
  const [wx, setWx] = useState<CurrentWx | null>(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [rainSoon, setRainSoon] = useState<RainSoon | null>(null);
  const [landing, setLanding] = useState<LandingInfo | null>(null);
  const [streak, setStreak] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<string[]>([]);
  const [compact, setCompact] = useState(false);

  const reqRef = useRef(0);
  const nextRefreshRef = useRef(Date.now() + REFRESH_MS);
  const missRef = useRef(0);
  const chime = useAudioPlayer(require("@/assets/sounds/alert.wav"));
  const prevLandingRef = useRef<string | null>(null);

  // Load persisted card order + hidden set.
  useEffect(() => {
    (async () => {
      const raw = await storage.getItem<string>(ORDER_KEY, "");
      const saved = raw ? raw.split(",").filter((k) => DEFAULT_ORDER.includes(k)) : [];
      const merged = [...saved, ...DEFAULT_ORDER.filter((k) => !saved.includes(k))];
      setOrder(merged);
      const rawH = await storage.getItem<string>(HIDDEN_KEY, "");
      setHidden(rawH ? rawH.split(",").filter((k) => DEFAULT_ORDER.includes(k)) : []);
      setCompact(await storage.getItem<boolean>(COMPACT_KEY, false));
    })();
  }, []);

  const toggleCompact = useCallback(() => {
    Haptics.selectionAsync();
    setCompact((prev) => {
      storage.setItem(COMPACT_KEY, !prev);
      return !prev;
    });
  }, []);

  const hideCard = useCallback((key: string) => {
    setHidden((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      storage.setItem(HIDDEN_KEY, next.join(","));
      return next;
    });
  }, []);

  const unhideCard = useCallback((key: string) => {
    Haptics.selectionAsync();
    setHidden((prev) => {
      const next = prev.filter((k) => k !== key);
      storage.setItem(HIDDEN_KEY, next.join(","));
      return next;
    });
  }, []);

  const checkAutoTrack = useCallback(
    (list: Plane[]) => {
      if (!(f.trackFlight && f.autoTracked && f.flightIdent)) return;
      if (list.length === 0) return; // inconclusive (e.g. web has no ADS-B)
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

  // Landing-alert detection for the pinned flight.
  const checkLanding = useCallback(
    (list: Plane[]) => {
      if (!(f.trackFlight && f.flightIdent)) {
        setLanding(null);
        return;
      }
      const pinned = list.find((p) => norm(p.callsign) === f.flightIdent);
      if (pinned && pinned.vertRateFpm <= -300 && pinned.altFt > 0) {
        const rate = Math.abs(pinned.vertRateFpm);
        const mins = rate > 0 ? Math.round(pinned.altFt / rate) : null;
        setLanding({
          callsign: pinned.callsign,
          altFt: pinned.altFt,
          distanceMi: pinned.distanceMi,
          state: pinned.altFt < 3000 ? "landing" : "descending",
          etaMin: mins != null && mins > 0 && mins <= 90 ? mins : null,
        });
      } else {
        setLanding(null);
      }
    },
    [f.trackFlight, f.flightIdent],
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
      rainArriving(f.lat!, f.lon!).then((r) => {
        if (id === reqRef.current) setRainSoon(r);
      });
      setPlaneLoading(true);
      nearbyPlanes(f.lat!, f.lon!, f.radiusMi, 8).then((list) => {
        if (id === reqRef.current) {
          setPlanes(list);
          setPlaneLoading(false);
          checkAutoTrack(list);
          checkLanding(list);
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
        if (line?.teamId) {
          getTeamStreak(favTeam.league, line.teamId).then((s) => {
            if (id === reqRef.current) setStreak(s);
          });
        } else if (id === reqRef.current) {
          setStreak(null);
        }
      });
    }

    if (secondTeam) {
      getTeamScore(secondTeam.league, secondTeam.abbr).then((line) => {
        if (id === reqRef.current) setScore2(line);
        if (line?.teamId) {
          getTeamStreak(secondTeam.league, line.teamId).then((s) => {
            if (id === reqRef.current) setStreak2(s);
          });
        } else if (id === reqRef.current) {
          setStreak2(null);
        }
      });
    } else if (id === reqRef.current) {
      setScore2(null);
      setStreak2(null);
    }

    if (thirdTeam) {
      getTeamScore(thirdTeam.league, thirdTeam.abbr).then((line) => {
        if (id === reqRef.current) setScore3(line);
        if (line?.teamId) {
          getTeamStreak(thirdTeam.league, line.teamId).then((s) => {
            if (id === reqRef.current) setStreak3(s);
          });
        } else if (id === reqRef.current) {
          setStreak3(null);
        }
      });
    } else if (id === reqRef.current) {
      setScore3(null);
      setStreak3(null);
    }

    if (settings.sports.ufc) {
      setUfcLoading(true);
      getNextUfc().then((e) => {
        if (id === reqRef.current) {
          setUfc(e);
          setUfcLoading(false);
        }
      });
    } else if (id === reqRef.current) {
      setUfc(null);
      setUfcLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, f.lat, f.lon, f.radiusMi, favTeam?.league, favTeam?.abbr, secondTeam?.league, secondTeam?.abbr, thirdTeam?.league, thirdTeam?.abbr, settings.sports.ufc, checkAutoTrack, checkLanding]);

  useEffect(() => {
    loadAll();
    const iv = setInterval(loadAll, REFRESH_MS);
    return () => clearInterval(iv);
  }, [loadAll]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Soft chime when a pinned flight first hits "landing soon".
  useEffect(() => {
    const key = landing && landing.state === "landing" ? landing.callsign : null;
    if (key && key !== prevLandingRef.current && settings.flights.landingChime) {
      try {
        chime.seekTo(0);
        chime.play();
      } catch {
        /* web / unsupported */
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevLandingRef.current = key;
  }, [landing, settings.flights.landingChime, chime]);

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
      const { name, picker } = await connect();
      if (picker) {
        // Multiple displays found — hand off to the Device tab's picker sheet.
        router.push("/device");
        return;
      }
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

  const trackedActive =
    f.trackFlight && !!f.flightIdent && planes.some((p) => norm(p.callsign) === f.flightIdent);
  const cycleIdx = planes.length ? planeIdx % planes.length : 0;
  const plane =
    (trackedActive ? planes.find((p) => norm(p.callsign) === f.flightIdent) ?? null : null) ??
    planes[cycleIdx] ??
    null;

  const isTracked = plane != null && f.trackFlight && f.flightIdent === norm(plane.callsign);

  // Cycle through nearby planes one at a time on the Overhead card (unless a
  // specific flight is pinned/tracked).
  useEffect(() => {
    if (trackedActive || planes.length < 2) return;
    const iv = setInterval(() => setPlaneIdx((i) => i + 1), 4000);
    return () => clearInterval(iv);
  }, [trackedActive, planes.length]);

  const onPlaneTap = () => {
    if (!located || !plane) {
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
  const visibleOrder = order.filter((k) => !hidden.includes(k));
  const extraCards =
    visibleOrder.includes("sports")
      ? (secondTeam ? 1 : 0) + (thirdTeam ? 1 : 0) + (settings.sports.ufc ? 1 : 0)
      : 0;
  const autoCompact = visibleOrder.length + extraCards > 3;
  const effCompact = compact || autoCompact;

  // ---- Glance renderers -----------------------------------------------------
  const renderOverhead = (move: CardMove) => (
    <GlanceCard
      icon="airplane"
      accent={isTracked ? colors.brand : colors.info}
      label="Overhead"
      loading={planeLoading}
      active={isTracked}
      onMoveUp={move.onMoveUp}
      onMoveDown={move.onMoveDown}
      onHide={() => hideCard("overhead")}
      onPress={onPlaneTap}
      compact={effCompact}
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
            {!isTracked && planes.length > 1 && (
              <View style={styles.countTag}>
                <Text style={styles.countTagText}>
                  {cycleIdx + 1}/{planes.length}
                </Text>
              </View>
            )}
          </View>
          {!effCompact && (
            <>
              <Text style={styles.glanceMeta}>
                {plane.from && plane.to ? `${plane.from} → ${plane.to}  ·  ` : ""}
                {plane.altFt ? `${plane.altFt.toLocaleString()} ft  ·  ` : ""}
                {plane.distanceMi} mi{plane.headingDeg >= 0 ? ` ${compass(plane.headingDeg)}` : ""}
              </Text>
              <Text style={[styles.tapHint, isTracked && { color: colors.brand }]}>
                {isTracked
                  ? "Pinned to the wall · tap to stop"
                  : planes.length > 1
                    ? "Cycling nearby flights · tap to pin this one"
                    : "Tap to pin this flight to the wall"}
              </Text>
            </>
          )}
        </>
      ) : (
        <Text style={styles.glanceHint}>
          {planeLoading ? "Scanning the sky…" : `No aircraft in range · rescanning in ${secsToRefresh}s`}
        </Text>
      )}
    </GlanceCard>
  );

  const renderSports = (move: CardMove) => {
    const secondMeta = secondTeam ? findTeam(secondTeam.league, secondTeam.abbr) : undefined;
    const s2live = score2?.state === "in";
    const thirdMeta = thirdTeam ? findTeam(thirdTeam.league, thirdTeam.abbr) : undefined;
    const s3live = score3?.state === "in";
    return (
    <>
    <GlanceCard
      icon="trophy"
      accent={accentFor(favMeta?.color)}
      label={favTeam ? `${favTeam.league} · ${favMeta?.name ?? favTeam.abbr}` : "Sports"}
      loading={scoreLoading}
      onMoveUp={move.onMoveUp}
      onMoveDown={move.onMoveDown}
      onHide={() => hideCard("sports")}
      onPress={() => router.push("/sports")}
      compact={effCompact}
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
            {score.record && (
              <View style={styles.recordChip}>
                <Text style={styles.recordChipText}>{score.record}</Text>
              </View>
            )}
            {streak && (
              <View
                style={[
                  styles.streakChip,
                  { backgroundColor: (streak.startsWith("W") ? colors.success : colors.error) + "22" },
                ]}
              >
                <Text
                  style={[
                    styles.streakChipText,
                    { color: streak.startsWith("W") ? colors.success : colors.error },
                  ]}
                >
                  {streak}
                </Text>
              </View>
            )}
          </View>
          {!effCompact && (
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
          )}
        </>
      ) : (
        <Text style={styles.glanceHint}>
          {scoreLoading ? "Loading score…" : "No recent or upcoming game"}
        </Text>
      )}
    </GlanceCard>
    {secondTeam && (
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/sports");
        }}
        style={({ pressed }) => [styles.miniRow, pressed && { opacity: 0.85 }]}
      >
        {secondMeta && (
          <View style={[styles.miniBadge, { backgroundColor: secondMeta.color }]}>
            <Text style={[styles.miniBadgeText, { color: readableOn(secondMeta.color) }]}>
              {secondTeam.abbr}
            </Text>
            <Image
              source={{ uri: teamLogoUrl(secondTeam.league, secondTeam.abbr) }}
              style={[StyleSheet.absoluteFill, { padding: 3 }]}
              contentFit="contain"
              transition={200}
              cachePolicy="memory-disk"
            />
          </View>
        )}
        <Text style={[styles.miniValue, s2live && { color: colors.brand }]} numberOfLines={1}>
          {score2
            ? score2.state === "pre"
              ? `${score2.atHome ? "vs" : "@"} ${score2.oppAbbr}`
              : `${secondTeam.abbr} ${score2.teamScore ?? 0}–${score2.oppScore ?? 0} ${score2.oppAbbr}`
            : `${secondTeam.league} · ${secondMeta?.name ?? secondTeam.abbr}`}
        </Text>
        {streak2 && (
          <View
            style={[
              styles.streakChip,
              { backgroundColor: (streak2.startsWith("W") ? colors.success : colors.error) + "22" },
            ]}
          >
            <Text
              style={[
                styles.streakChipText,
                { color: streak2.startsWith("W") ? colors.success : colors.error },
              ]}
            >
              {streak2}
            </Text>
          </View>
        )}
        <Text style={styles.miniStatus} numberOfLines={1}>
          {score2 ? (s2live ? "🔴 LIVE" : score2.detail) : "No game"}
        </Text>
      </Pressable>
    )}
    {thirdTeam && (
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/sports");
        }}
        style={({ pressed }) => [styles.miniRow, pressed && { opacity: 0.85 }]}
      >
        {thirdMeta && (
          <View style={[styles.miniBadge, { backgroundColor: thirdMeta.color }]}>
            <Text style={[styles.miniBadgeText, { color: readableOn(thirdMeta.color) }]}>
              {thirdTeam.abbr}
            </Text>
            <Image
              source={{ uri: teamLogoUrl(thirdTeam.league, thirdTeam.abbr) }}
              style={[StyleSheet.absoluteFill, { padding: 3 }]}
              contentFit="contain"
              transition={200}
              cachePolicy="memory-disk"
            />
          </View>
        )}
        <Text style={[styles.miniValue, s3live && { color: colors.brand }]} numberOfLines={1}>
          {score3
            ? score3.state === "pre"
              ? `${score3.atHome ? "vs" : "@"} ${score3.oppAbbr}`
              : `${thirdTeam.abbr} ${score3.teamScore ?? 0}–${score3.oppScore ?? 0} ${score3.oppAbbr}`
            : `${thirdTeam.league} · ${thirdMeta?.name ?? thirdTeam.abbr}`}
        </Text>
        {streak3 && (
          <View
            style={[
              styles.streakChip,
              { backgroundColor: (streak3.startsWith("W") ? colors.success : colors.error) + "22" },
            ]}
          >
            <Text
              style={[
                styles.streakChipText,
                { color: streak3.startsWith("W") ? colors.success : colors.error },
              ]}
            >
              {streak3}
            </Text>
          </View>
        )}
        <Text style={styles.miniStatus} numberOfLines={1}>
          {score3 ? (s3live ? "🔴 LIVE" : score3.detail) : "No game"}
        </Text>
      </Pressable>
    )}
    {settings.sports.ufc && (
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/sports");
        }}
        style={({ pressed }) => [styles.miniRow, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.miniBadge, { backgroundColor: colors.surfaceTertiary }]}>
          <Ionicons name="flame" size={14} color="#f97316" />
        </View>
        <Text style={styles.miniValue} numberOfLines={1}>
          {ufcLoading ? "Loading UFC…" : ufc ? (ufc.shortName || ufc.name) : "No upcoming event"}
        </Text>
        <Text style={styles.miniStatus} numberOfLines={1}>
          {ufc?.date || ""}
        </Text>
      </Pressable>
    )}
    </>
    );
  };

  const renderWeather = (move: CardMove) => (
    <GlanceCard
      icon={wx ? wxGlyph(wx.code, wx.isDay) : "partly-sunny"}
      accent={wx ? wxAccent(wx.code) : colors.warning}
      label="Weather"
      loading={wxLoading}
      onMoveUp={move.onMoveUp}
      onMoveDown={move.onMoveDown}
      onHide={() => hideCard("weather")}
      onPress={() => router.push("/weather")}
      compact={effCompact}
    >
      {!located ? (
        <Text style={styles.glanceHint}>Set your ZIP on the Weather tab</Text>
      ) : wx ? (
        <>
          <View style={styles.scoreLine}>
            <Text style={styles.glanceValue}>
              {wx.tempF}°F · {wx.label}
            </Text>
            {wx.hiF != null && wx.loF != null && (
              <View style={styles.hiLoChip}>
                <Text style={styles.hiLoText}>
                  H{wx.hiF}° L{wx.loF}°
                </Text>
              </View>
            )}
          </View>
          {!effCompact && (
            <Text style={styles.glanceMeta}>
              {wx.feelsF != null && Math.abs(wx.feelsF - wx.tempF) >= 3
                ? `Feels ${wx.feelsF}°  ·  `
                : ""}
              {wx.isRaining
                ? "🌧️ Raining now"
                : wx.rainChance != null && wx.rainChance >= 30
                  ? `☔ ${wx.rainChance}% chance of rain today`
                  : "No rain expected"}
              {f.city ? `  ·  ${f.city}` : ""}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.glanceHint}>{wxLoading ? "Checking conditions…" : "Unavailable"}</Text>
      )}
    </GlanceCard>
  );

  const moveCard = (key: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const vis = prev.filter((k) => !hidden.includes(k));
      const i = vis.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= vis.length) return prev;
      const swapped = [...vis];
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      const queue = [...swapped];
      const next = prev.map((k) => (hidden.includes(k) ? k : (queue.shift() as string)));
      storage.setItem(ORDER_KEY, next.join(","));
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const renderCard = (key: string, i: number) => {
    const move: CardMove = {
      onMoveUp: i > 0 ? () => moveCard(key, -1) : undefined,
      onMoveDown: i < visibleOrder.length - 1 ? () => moveCard(key, 1) : undefined,
    };
    const node =
      key === "overhead" ? renderOverhead(move) : key === "sports" ? renderSports(move) : renderWeather(move);
    return <View key={key}>{node}</View>;
  };

  const Header = (
    <View>
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

      {landing && (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/flights");
          }}
          style={({ pressed }) => [
            styles.landingCard,
            landing.state === "landing" && styles.landingCardHot,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="airplane" size={20} color={colors.brand} style={styles.landingIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.landingTitle}>
              {landing.callsign} · {landing.state === "landing" ? "Landing soon" : "Descending"}
            </Text>
            <Text style={styles.landingSub}>
              {landing.altFt.toLocaleString()} ft · {landing.distanceMi} mi away
              {landing.etaMin != null ? ` · lands in ~${landing.etaMin} min` : " · approaching"}
            </Text>
          </View>
          <Ionicons name="trending-down" size={18} color={colors.brand} />
        </Pressable>
      )}

      {rainSoon &&
        settings.weather.rainAlert &&
        !isQuietNow(
          settings.weather.rainQuiet.enabled,
          settings.weather.rainQuiet.startHour,
          settings.weather.rainQuiet.endHour,
        ) && (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/weather");
          }}
          style={({ pressed }) => [styles.rainCard, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="rainy" size={20} color={colors.info} style={styles.rainIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rainTitle}>Rain arriving in ~{rainSoon.minutes} min</Text>
            <Text style={styles.rainSub}>
              {rainSoon.label} moving in · tap to see it on radar
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.surfaceTertiary} />
        </Pressable>
      )}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>On The Wall Now</Text>
        <View style={styles.sectionActions}>
          <Text style={styles.reorderHint}>
            {autoCompact ? "Auto-compact · 4+ cards" : "Use arrows to reorder"}
          </Text>
          <Pressable
            onPress={toggleCompact}
            disabled={autoCompact}
            hitSlop={8}
            style={[styles.compactBtn, autoCompact && { opacity: 0.5 }]}
          >
            <Ionicons
              name={effCompact ? "expand-outline" : "contract-outline"}
              size={16}
              color={effCompact ? colors.brand : colors.onSurfaceSecondary}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const Footer = (
    <View>
      {visibleOrder.length === 0 && (
        <Text style={styles.emptyNote}>All cards hidden — restore them below.</Text>
      )}
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

      {hidden.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Hidden Cards</Text>
          <View style={styles.hiddenWrap}>
            {hidden.map((k) => (
              <Pressable key={k} onPress={() => unhideCard(k)} style={styles.hiddenChip}>
                <Ionicons name={CARD_ICON[k]} size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.hiddenChipText}>{CARD_LABEL[k]}</Text>
                <Ionicons name="eye-outline" size={16} color={colors.brand} />
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.footer}>
        A live glance at everything on your matrix. Pull down to refresh. Flights and
        scores stream on the phone build; weather works everywhere.
      </Text>
    </View>
  );

  return (
    <ScrollView
      style={styles.screen}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 190 },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
      }
    >
      {Header}
      {visibleOrder.map((key, i) => renderCard(key, i))}
      {located && (
        <>
          <Text style={styles.radarLabel}>Sky right now</Text>
          <RadarCard lat={f.lat!} lon={f.lon!} />
        </>
      )}
      {Footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  radarLabel: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.xl,
    marginBottom: -spacing.xs,
    letterSpacing: 0.3,
  },
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
  liveText: { fontFamily: fonts.mono, fontSize: fontSize.xs, color: colors.onSurfaceSecondary, letterSpacing: 0.5 },
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
  landingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  landingCardHot: { backgroundColor: "#3a2a05" },
  landingIcon: { transform: [{ rotate: "135deg" }] },
  rainCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    borderLeftWidth: 4,
    borderLeftColor: colors.info,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  rainIcon: {},
  rainTitle: { fontFamily: fonts.display, fontSize: fontSize.lg, color: colors.onSurface },
  rainSub: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 1 },
  landingTitle: { fontFamily: fonts.display, fontSize: fontSize.lg, color: colors.onSurface },
  landingSub: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 1 },
  sectionRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  sectionActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  compactBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  sectionLabel: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  reorderHint: { fontFamily: fonts.text, fontSize: fontSize.xs, color: colors.surfaceTertiary },
  glanceValue: { fontFamily: fonts.display, fontSize: fontSize.lg, color: colors.onSurface, flexShrink: 1 },
  glanceMeta: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  glanceHint: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  tapHint: { fontFamily: fonts.textMedium, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 4 },
  planeLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  planeLogo: { width: 22, height: 22 },
  trackTag: { backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  trackTagText: { fontFamily: fonts.textMedium, fontSize: 9, color: colors.onBrandPrimary, letterSpacing: 0.5 },
  countTag: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countTagText: { fontFamily: fonts.mono, fontSize: 10, color: colors.onSurfaceSecondary },
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
  miniRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    marginLeft: spacing.xl,
    marginTop: -spacing.xs,
  },
  miniBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  miniBadgeText: { fontFamily: fonts.displayBold, fontSize: 8 },
  miniValue: { flex: 1, fontFamily: fonts.displayMedium, fontSize: fontSize.base, color: colors.onSurface },
  miniStatus: { fontFamily: fonts.text, fontSize: fontSize.xs, color: colors.onSurfaceSecondary },
  recordChip: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  recordChipText: { fontFamily: fonts.mono, fontSize: fontSize.xs, color: colors.onSurfaceTertiary },
  hiLoChip: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  hiLoText: { fontFamily: fonts.mono, fontSize: fontSize.xs, color: colors.onSurfaceSecondary },
  streakChip: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  streakChipText: { fontFamily: fonts.textMedium, fontSize: 10, letterSpacing: 0.3 },


  emptyNote: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  hiddenWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  hiddenChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  hiddenChipText: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.onSurface },
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
    marginTop: spacing.sm,
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

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix, type SavedTeam } from "@/src/store/matrix";
import { Hero, Card, SectionLabel, MasterToggle, ToggleRow } from "@/src/components/ui";
import {
  TEAMS,
  findTeam,
  teamLogoUrl,
  readableOn,
  type League,
} from "@/src/data/teams";
import { getTeamScore, getTeamStreak, getNextUfc, type ScoreLine, type UfcEvent } from "@/src/services/espn";

const HERO =
  "https://images.pexels.com/photos/15779126/pexels-photo-15779126.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

type Segment = League | "UFC";
const SEGMENTS: Segment[] = ["NFL", "NBA", "MLB", "NHL", "UFC"];

function TeamBadge({
  league,
  abbr,
  color,
  size,
}: {
  league: League;
  abbr: string;
  color: string;
  size: number;
}) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.badgeText, { color: readableOn(color) }]}>{abbr}</Text>
      <Image
        source={{ uri: teamLogoUrl(league, abbr) }}
        style={[StyleSheet.absoluteFill, { padding: size * 0.15 }]}
        contentFit="contain"
        transition={200}
        cachePolicy="memory-disk"
      />
    </View>
  );
}

function scoreText(line: ScoreLine | null | undefined, abbr: string): string {
  if (!line) return "";
  if (line.state === "pre") {
    if (line.series) {
      if (line.seriesStatus === "Season over" || !line.oppAbbr) return line.series;
      return `${line.series} · ${line.seriesGame ? line.seriesGame + " " : ""}${line.atHome ? "vs" : "@"} ${line.oppAbbr}${line.detail ? " · " + line.detail : ""}`;
    }
    const rec = line.record ? ` · ${line.record}` : "";
    if (!line.oppAbbr) return line.record ? `Record ${line.record}` : "";
    return `${line.atHome ? "vs" : "@"} ${line.oppAbbr}${line.detail ? " · " + line.detail : ""}${rec}`;
  }
  const ts = line.teamScore ?? 0;
  const os = line.oppScore ?? 0;
  const ser = line.series ? ` · ${line.series}` : "";
  return `${abbr} ${ts}–${os} ${line.oppAbbr}${line.detail ? " · " + line.detail : ""}${ser}`;
}

type GameStatus = {
  kind: "live" | "next" | "final" | "over" | "none";
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  text: string;
};

// One status line per followed team (Info-Wall "Track your teams" style):
// live score, the next game, the last final, or the postseason series state.
function gameStatus(line: ScoreLine | null | undefined, abbr: string): GameStatus {
  if (!line) return { kind: "none", icon: "remove-circle-outline", color: colors.onSurfaceTertiary, text: "No game scheduled" };
  if (line.series && (line.seriesStatus === "Season over" || !line.oppAbbr) && line.state === "pre") {
    return { kind: "over", icon: "flag-outline", color: colors.onSurfaceTertiary, text: line.series };
  }
  const text = scoreText(line, abbr);
  if (line.state === "in") return { kind: "live", icon: "radio-button-on", color: LIVE_RED, text };
  if (line.state === "post") {
    const ts = line.teamScore ?? 0;
    const os = line.oppScore ?? 0;
    const res = ts > os ? "W" : ts < os ? "L" : "T";
    const color = res === "W" ? colors.success : res === "L" ? colors.error : colors.onSurfaceTertiary;
    return { kind: "final", icon: "checkmark-done", color, text: `${res} · ${text}` };
  }
  if (!text) return { kind: "none", icon: "remove-circle-outline", color: colors.onSurfaceTertiary, text: "No game scheduled" };
  return { kind: "next", icon: "time-outline", color: colors.brand, text: `Next: ${text}` };
}

const LIVE_RED = "#ef4444";

export default function SportsScreen() {
  const { settings, updateSports, toggleTeam, reorderTeams, toggleRival, toggleFavorite } = useMatrix();
  const insets = useSafeAreaInsets();
  const s = settings.sports;
  const [seg, setSeg] = useState<Segment>("NFL");
  const [scores, setScores] = useState<Record<string, ScoreLine | null>>({});
  const [streaks, setStreaks] = useState<Record<string, string | null>>({});
  const [tick, setTick] = useState(0);
  const [ufc, setUfc] = useState<UfcEvent | null>(null);
  const [ufcLoading, setUfcLoading] = useState(true);

  const teamKey = s.teams.map((t) => `${t.league}:${t.abbr}`).join(",");
  useEffect(() => {
    let active = true;
    (async () => {
      const entries = await Promise.all(
        s.teams.map(async (t) => {
          const line = await getTeamScore(t.league, t.abbr);
          return [`${t.league}:${t.abbr}`, line] as const;
        }),
      );
      if (active) setScores(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKey, tick]);

  // Keep the games list fresh while the screen is open (ESPN calls are cached 60s).
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // W/L streak chips (regular season only; postseason shows the series instead).
  const streakKey = s.showStreak
    ? s.teams.map((t) => `${t.league}:${t.abbr}:${scores[`${t.league}:${t.abbr}`]?.teamId ?? ""}`).join(",")
    : "";
  useEffect(() => {
    if (!s.showStreak) return; // chips are hidden when off; stale map is ignored
    let active = true;
    (async () => {
      const entries = await Promise.all(
        s.teams.map(async (t) => {
          const key = `${t.league}:${t.abbr}`;
          const line = scores[key];
          if (!line?.teamId || line.series) return [key, null] as const;
          return [key, await getTeamStreak(t.league, line.teamId)] as const;
        }),
      );
      if (active) setStreaks(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streakKey]);

  useEffect(() => {
    let active = true;
    setUfcLoading(true);
    getNextUfc().then((e) => {
      if (active) {
        setUfc(e);
        setUfcLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const countForLeague = (lg: League) =>
    s.teams.filter((t) => t.league === lg).length;

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= s.teams.length) return;
    const arr = [...s.teams];
    [arr[index], arr[j]] = [arr[j], arr[index]];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    reorderTeams(arr);
  };

  const isFollowed = (league: string, abbr: string) =>
    s.teams.some((t) => t.league === league && t.abbr === abbr);

  const renderRotationRow = (item: SavedTeam, index: number) => {
    const key = `${item.league}:${item.abbr}`;
    const t = findTeam(item.league, item.abbr);
    const line = scores[key];
    const scoreStr = scoreText(line, item.abbr);
    const scored =
      line &&
      (line.state === "in" || line.state === "post") &&
      line.teamScore != null &&
      line.oppScore != null;
    const outcome = scored
      ? line!.teamScore! > line!.oppScore!
        ? "win"
        : line!.teamScore! < line!.oppScore!
          ? "loss"
          : "tie"
      : null;
    const outcomeColor =
      outcome === "win" ? colors.success : outcome === "loss" ? colors.error : outcome === "tie" ? colors.onSurfaceTertiary : null;

    const isRival = s.rivals.includes(key);
    // Rivalry game: the live opponent is another team you follow in this league.
    const rivalryGame = !!line && isFollowed(item.league, line.oppAbbr);
    const highlight = isRival || rivalryGame;
    // Favorites (max 3): [0] leads the Summary glance, [1]/[2] show as mini rows.
    const favIndex = s.favorites.indexOf(key);
    const implicitPrimary = s.favorites.length === 0 && index === 0;
    const favActive = favIndex >= 0 || implicitPrimary;
    const favLabel =
      favIndex === 2 ? "3RD" : favIndex === 1 ? "2ND" : favIndex === 0 || implicitPrimary ? "SUMMARY" : null;

    return (
      <View
        key={key}
        style={[
          styles.rotRow,
          highlight && styles.rotRowRival,
          outcomeColor && !highlight ? { borderLeftColor: outcomeColor, borderLeftWidth: 4 } : null,
        ]}
      >
        <TeamBadge league={item.league} abbr={item.abbr} color={t?.color ?? "#555"} size={34} />
        <View style={{ flex: 1 }}>
          <View style={styles.rotNameRow}>
            <Text style={styles.rotName} numberOfLines={1}>{t?.name ?? item.abbr}</Text>
            {favLabel && (
              <View style={styles.favTag}>
                <Ionicons name="star" size={8} color={colors.brand} />
                <Text style={styles.favTagText}>{favLabel}</Text>
              </View>
            )}
            {rivalryGame && (
              <View style={styles.rivalryTag}>
                <Text style={styles.rivalryTagText}>RIVALRY</Text>
              </View>
            )}
          </View>
          {scoreStr ? (
            <Text style={[styles.rotScore, outcomeColor ? { color: outcomeColor } : null]} numberOfLines={1}>
              {scoreStr}
            </Text>
          ) : (
            <Text style={styles.rotLeague}>{item.league} · {item.abbr}</Text>
          )}
        </View>

        <Pressable
          hitSlop={8}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            toggleFavorite(key);
          }}
          style={styles.rowBtn}
        >
          <Ionicons name={favActive ? "star" : "star-outline"} size={20} color={favActive ? colors.brand : colors.onSurfaceSecondary} />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleRival(key); }} style={styles.rowBtn}>
          <Ionicons name={isRival ? "flame" : "flame-outline"} size={20} color={isRival ? "#f97316" : colors.onSurfaceSecondary} />
        </Pressable>
        <View style={styles.reorderCol}>
          <Pressable hitSlop={6} onPress={() => move(index, -1)} disabled={index === 0} style={styles.rowBtnSm}>
            <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.surfaceTertiary : colors.onSurfaceSecondary} />
          </Pressable>
          <Pressable hitSlop={6} onPress={() => move(index, 1)} disabled={index === s.teams.length - 1} style={styles.rowBtnSm}>
            <Ionicons name="chevron-down" size={18} color={index === s.teams.length - 1 ? colors.surfaceTertiary : colors.onSurfaceSecondary} />
          </Pressable>
        </View>
        <Pressable hitSlop={8} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleTeam(item); }} style={styles.rowBtn}>
          <Ionicons name="close-circle" size={22} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>
    );
  };

  // Live games first, then everything else in rotation order.
  const gameRows = s.teams
    .map((item, i) => ({ item, i, st: gameStatus(scores[`${item.league}:${item.abbr}`], item.abbr) }))
    .sort((x, y) => (x.st.kind === "live" ? 0 : 1) - (y.st.kind === "live" ? 0 : 1) || x.i - y.i);

  const renderGameRow = ({ item, st }: { item: SavedTeam; st: GameStatus }) => {
    const key = `${item.league}:${item.abbr}`;
    const t = findTeam(item.league, item.abbr);
    const streak = s.showStreak ? streaks[key] : null;
    const live = st.kind === "live";
    return (
      <View key={key} style={[styles.gameRow, live && styles.gameRowLive]}>
        <TeamBadge league={item.league} abbr={item.abbr} color={t?.color ?? "#555"} size={40} />
        <View style={{ flex: 1 }}>
          <View style={styles.rotNameRow}>
            <Text style={styles.gameName} numberOfLines={1}>
              {t ? `${t.city} ${t.name}` : item.abbr}
            </Text>
            {live && (
              <View style={styles.liveTag}>
                <View style={styles.liveDot} />
                <Text style={styles.liveTagText}>LIVE</Text>
              </View>
            )}
            {!!streak && (
              <Text style={[styles.streakChip, { color: streak.startsWith("W") ? colors.success : colors.error }]}>
                {streak}
              </Text>
            )}
          </View>
          <View style={styles.gameStatusRow}>
            <Ionicons name={st.icon} size={12} color={st.color} />
            <Text style={[styles.gameStatus, { color: st.color }]} numberOfLines={1}>
              {st.text}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 190 }]}
      showsVerticalScrollIndicator={false}
    >
      <Hero image={HERO} title="Scoreboard" subtitle="Your teams, live scores" icon="trophy" />
      <View style={styles.body}>
        <MasterToggle
          label="Sports Scores"
          description="Show your teams' games & scores"
          value={s.enabled}
          onValueChange={(v) => updateSports({ enabled: v })}
        />

        <Card style={{ marginTop: spacing.md }}>
          <ToggleRow
            label="Show W/L streak on wall"
            icon="flame"
            value={s.showStreak}
            onValueChange={(v) => updateSports({ showStreak: v })}
          />
        </Card>

        {s.teams.length > 0 && (
          <>
            <SectionLabel>Your Games</SectionLabel>
            {gameRows.map(renderGameRow)}
          </>
        )}

        <SectionLabel>League</SectionLabel>
        <View style={styles.segRow}>
          {SEGMENTS.map((sg) => {
            const active = seg === sg;
            const cnt = sg === "UFC" ? (s.ufc ? 1 : 0) : countForLeague(sg);
            return (
              <Pressable
                key={sg}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSeg(sg); }}
                style={[styles.segPill, active && styles.segPillActive]}
              >
                <Text style={[styles.segText, active && styles.segTextActive]}>{sg}</Text>
                {cnt > 0 && (
                  <View style={[styles.segBadge, active && styles.segBadgeActive]}>
                    <Text style={[styles.segBadgeText, active && { color: colors.onBrandPrimary }]}>{cnt}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {seg === "UFC" ? (
          <Card style={{ marginTop: spacing.md }}>
            <ToggleRow
              label="UFC Fight Night"
              icon="flame"
              value={s.ufc}
              onValueChange={(v) => updateSports({ ufc: v })}
            />
            <View style={styles.ufcDivider} />
            {ufcLoading ? (
              <View style={styles.ufcLoading}>
                <ActivityIndicator color={colors.brand} />
                <Text style={styles.ufcNote}>Loading next event…</Text>
              </View>
            ) : ufc ? (
              <View style={styles.ufcNext}>
                <View style={styles.ufcHeaderRow}>
                  <Ionicons name="calendar" size={14} color={colors.brand} />
                  <Text style={styles.ufcDate}>{ufc.date || "Upcoming"}</Text>
                </View>
                <Text style={styles.ufcName}>{ufc.shortName || ufc.name}</Text>
                {!!ufc.headline && <Text style={styles.ufcHeadline}>{ufc.headline}</Text>}
              </View>
            ) : (
              <Text style={styles.ufcNote}>No upcoming UFC event found right now.</Text>
            )}
          </Card>
        ) : (
          <View style={styles.grid}>
            {TEAMS[seg as League].map((team) => {
              const selected = isFollowed(seg, team.abbr);
              return (
                <Pressable
                  key={team.abbr}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleTeam({ league: seg as League, abbr: team.abbr }); }}
                  style={[styles.teamCard, selected && styles.teamCardActive]}
                >
                  {selected && (
                    <View style={styles.check}><Text style={styles.checkMark}>✓</Text></View>
                  )}
                  <TeamBadge league={seg as League} abbr={team.abbr} color={team.color} size={46} />
                  <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <SectionLabel>Rotation Order</SectionLabel>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <Ionicons name="star" size={14} color={colors.brand} />
            <Text style={styles.legendText}>Show on Summary (up to 3 — 1st leads, 2nd &amp; 3rd are mini rows)</Text>
          </View>
          <View style={styles.legendItem}>
            <Ionicons name="flame" size={14} color="#f97316" />
            <Text style={styles.legendText}>Flag a rivalry — highlights the game on the matrix</Text>
          </View>
        </View>
        {s.teams.length === 0 ? (
          <Text style={styles.rotEmpty}>
            Pick teams above — they appear here in the order they cycle on the
            matrix. Reorder with the arrows, tap ★ to show a team on the Summary,
            and 🔥 to flag a rivalry.
          </Text>
        ) : (
          s.teams.map((item, i) => renderRotationRow(item, i))
        )}

        <Text style={styles.footer}>
          {seg === "UFC"
            ? "The matrix pulls the next UFC card live from ESPN."
            : `Following ${s.teams.length} team${s.teams.length === 1 ? "" : "s"}. ★ star up to 3 for the Summary (1st leads, 2nd & 3rd show mini rows) · 🔥 flags a rivalry · rows tint green when winning, red when losing.`}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 150 },
  body: { paddingHorizontal: spacing.lg },
  segRow: { flexDirection: "row", gap: spacing.xs, paddingVertical: spacing.xs },
  segPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segPillActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brand },
  segText: { fontFamily: fonts.displayMedium, fontSize: fontSize.lg, color: colors.onSurfaceSecondary, letterSpacing: 0.5 },
  segTextActive: { color: colors.brand },
  segBadge: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  segBadgeActive: { backgroundColor: colors.brand },
  segBadgeText: { fontFamily: fonts.textMedium, fontSize: 10, color: colors.onSurfaceSecondary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  teamCard: {
    width: "31.5%",
    aspectRatio: 0.92,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
    gap: spacing.sm,
  },
  teamCardActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  check: { position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", zIndex: 2 },
  checkMark: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "900" },
  badge: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  badgeText: { fontFamily: fonts.displayBold, fontSize: fontSize.base, letterSpacing: 0.3 },
  teamName: { fontFamily: fonts.text, fontSize: fontSize.xs, color: colors.onSurface, textAlign: "center" },
  ufcNote: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm, lineHeight: 18 },
  ufcDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  ufcLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ufcNext: { gap: 4 },
  ufcHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  ufcDate: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.brand, letterSpacing: 0.3 },
  ufcName: { fontFamily: fonts.display, fontSize: fontSize.xl, color: colors.onSurface },
  ufcHeadline: { fontFamily: fonts.text, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  rotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rotRowRival: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  rotNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rotName: { fontFamily: fonts.text, fontSize: fontSize.lg, color: colors.onSurface, flexShrink: 1 },
  rivalryTag: { backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  rivalryTagText: { fontFamily: fonts.textMedium, fontSize: 9, color: colors.onBrandPrimary, letterSpacing: 0.5 },
  favTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  favTagText: { fontFamily: fonts.textMedium, fontSize: 9, color: colors.brand, letterSpacing: 0.5 },
  legend: {
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legendText: { flex: 1, fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gameRowLive: { borderColor: LIVE_RED, borderLeftWidth: 4 },
  gameName: { fontFamily: fonts.text, fontSize: fontSize.lg, color: colors.onSurface, flexShrink: 1 },
  gameStatusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  gameStatus: { flex: 1, fontFamily: fonts.textMedium, fontSize: fontSize.sm },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: LIVE_RED, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#ffffff" },
  liveTagText: { fontFamily: fonts.textMedium, fontSize: 9, color: "#ffffff", letterSpacing: 0.5 },
  streakChip: { fontFamily: fonts.mono, fontSize: fontSize.xs },
  rotLeague: { fontFamily: fonts.text, fontSize: fontSize.xs, color: colors.onSurfaceSecondary },
  rotScore: { fontFamily: fonts.textMedium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  rowBtn: { padding: 4 },
  rowBtnSm: { paddingHorizontal: 2, paddingVertical: 1 },
  reorderCol: { alignItems: "center" },
  rotEmpty: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 18 },
  footer: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 18, marginTop: spacing.lg, textAlign: "center" },
});

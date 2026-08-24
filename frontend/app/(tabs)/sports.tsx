import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix } from "@/src/store/matrix";
import { Hero, Card, SectionLabel, MasterToggle, ToggleRow } from "@/src/components/ui";
import { TEAMS, readableOn, type League } from "@/src/data/teams";

const HERO =
  "https://images.pexels.com/photos/15779126/pexels-photo-15779126.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

type Segment = League | "UFC";
const SEGMENTS: Segment[] = ["NFL", "NBA", "MLB", "NHL", "UFC"];

export default function SportsScreen() {
  const { settings, updateSports, toggleTeam } = useMatrix();
  const s = settings.sports;
  const [seg, setSeg] = useState<Segment>("NFL");

  const countForLeague = (lg: League) =>
    s.teams.filter((t) => t.league === lg).length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
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

        <SectionLabel>League</SectionLabel>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.segRow}
        >
          {SEGMENTS.map((sg) => {
            const active = seg === sg;
            const cnt = sg === "UFC" ? (s.ufc ? 1 : 0) : countForLeague(sg);
            return (
              <Pressable
                key={sg}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSeg(sg);
                }}
                style={[styles.segPill, active && styles.segPillActive]}
              >
                <Text style={[styles.segText, active && styles.segTextActive]}>
                  {sg}
                </Text>
                {cnt > 0 && (
                  <View style={[styles.segBadge, active && styles.segBadgeActive]}>
                    <Text style={[styles.segBadgeText, active && { color: colors.onBrandPrimary }]}>
                      {cnt}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {seg === "UFC" ? (
          <Card style={{ marginTop: spacing.md }}>
            <ToggleRow
              label="UFC Fight Night"
              icon="flame"
              value={s.ufc}
              onValueChange={(v) => updateSports({ ufc: v })}
            />
            <Text style={styles.ufcNote}>
              Shows the next UFC event, headline bout and live results on the
              matrix. No team selection needed.
            </Text>
          </Card>
        ) : (
          <View style={styles.grid}>
            {TEAMS[seg as League].map((team) => {
              const selected = s.teams.some(
                (t) => t.league === seg && t.abbr === team.abbr,
              );
              return (
                <Pressable
                  key={team.abbr}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    toggleTeam({ league: seg as League, abbr: team.abbr });
                  }}
                  style={[styles.teamCard, selected && styles.teamCardActive]}
                >
                  {selected && (
                    <View style={styles.check}>
                      <Text style={styles.checkMark}>✓</Text>
                    </View>
                  )}
                  <View style={[styles.badge, { backgroundColor: team.color }]}>
                    <Text style={[styles.badgeText, { color: readableOn(team.color) }]}>
                      {team.abbr}
                    </Text>
                  </View>
                  <Text style={styles.teamName} numberOfLines={1}>
                    {team.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={styles.footer}>
          {seg === "UFC"
            ? "The matrix pulls the next UFC card live from ESPN."
            : `Tap teams to follow them. Following ${s.teams.length} team${s.teams.length === 1 ? "" : "s"} across all leagues.`}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 150 },
  body: { paddingHorizontal: spacing.lg },
  segRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  segPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segPillActive: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brand,
  },
  segText: {
    fontFamily: fonts.displayMedium,
    fontSize: fontSize.lg,
    color: colors.onSurfaceSecondary,
    letterSpacing: 0.5,
  },
  segTextActive: { color: colors.brand },
  segBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  segBadgeActive: { backgroundColor: colors.brand },
  segBadgeText: {
    fontFamily: fonts.textMedium,
    fontSize: 10,
    color: colors.onSurfaceSecondary,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
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
  teamCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
  check: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  checkMark: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "900" },
  badge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: fonts.displayBold,
    fontSize: fontSize.base,
    letterSpacing: 0.3,
  },
  teamName: {
    fontFamily: fonts.text,
    fontSize: fontSize.xs,
    color: colors.onSurface,
    textAlign: "center",
  },
  ufcNote: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
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

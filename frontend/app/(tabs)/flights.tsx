import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";
import { Hero, Card, SectionLabel, MasterToggle, ToggleRow } from "@/src/components/ui";
import { geocodeZip } from "@/src/services/geocode";
import { nearbyPlanes, airlineLogoUrl, compass, type Plane } from "@/src/services/adsb";

const HERO =
  "https://images.pexels.com/photos/6861359/pexels-photo-6861359.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

export default function FlightsScreen() {
  const { settings, updateFlights } = useMatrix();
  const f = settings.flights;
  const toast = useToast();

  const [zip, setZip] = useState(f.zip);
  const [radius_, setRadius] = useState(f.radiusMi);
  const [ident, setIdent] = useState(f.flightIdent);
  const [looking, setLooking] = useState(false);

  // Re-sync local input state once store hydrates from AsyncStorage.
  useEffect(() => setZip(f.zip), [f.zip]);
  useEffect(() => setRadius(f.radiusMi), [f.radiusMi]);
  useEffect(() => setIdent(f.flightIdent), [f.flightIdent]);

  const onIdent = (val: string) => {
    const clean = val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    setIdent(clean);
    updateFlights({ flightIdent: clean });
  };

  const onZip = async (val: string) => {
    const clean = val.replace(/[^0-9]/g, "").slice(0, 5);
    setZip(clean);
    updateFlights({ zip: clean });
    if (clean.length === 5) {
      setLooking(true);
      const res = await geocodeZip(clean);
      setLooking(false);
      if (res) {
        updateFlights({
          lat: res.lat,
          lon: res.lon,
          city: res.city,
          state: res.state,
        });
      } else {
        toast.show("Couldn't find that ZIP code.", "error");
      }
    }
  };

  const located = f.lat != null && f.lon != null;

  const [planes, setPlanes] = useState<Plane[]>([]);
  const [planesLoading, setPlanesLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const loadPlanes = useCallback(async () => {
    if (f.lat == null || f.lon == null) return;
    const id = ++fetchIdRef.current;
    setPlanesLoading(true);
    try {
      const list = await nearbyPlanes(f.lat, f.lon, f.radiusMi, 4);
      if (id !== fetchIdRef.current) return;
      setPlanes(list);
    } finally {
      if (id === fetchIdRef.current) setPlanesLoading(false);
    }
  }, [f.lat, f.lon, f.radiusMi]);

  useEffect(() => {
    if (f.lat == null || f.lon == null) return;
    loadPlanes();
    const iv = setInterval(loadPlanes, 20000);
    return () => clearInterval(iv);
  }, [loadPlanes, f.lat, f.lon]);

  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      bottomOffset={20}
    >
      <Hero image={HERO} title="Flight Radar" subtitle="Overhead air traffic" icon="airplane" />

      <View style={styles.body}>
        <View style={styles.overheadHeader}>
          <SectionLabel>Overhead Now</SectionLabel>
          {located && (
            planesLoading ? (
              <ActivityIndicator size="small" color={colors.brand} style={styles.overheadSpin} />
            ) : (
              <Ionicons
                name="refresh"
                size={16}
                color={colors.onSurfaceSecondary}
                style={styles.overheadSpin}
                onPress={() => { Haptics.selectionAsync(); loadPlanes(); }}
              />
            )
          )}
        </View>
        <Card style={styles.overheadCard}>
          {!located ? (
            <View style={styles.overheadEmpty}>
              <Ionicons name="location-outline" size={22} color={colors.onSurfaceSecondary} />
              <Text style={styles.overheadEmptyText}>Set your ZIP below to see planes near you.</Text>
            </View>
          ) : planes.length === 0 ? (
            <View style={styles.overheadEmpty}>
              <Ionicons name={planesLoading ? "search" : "airplane-outline"} size={22} color={colors.onSurfaceSecondary} />
              <Text style={styles.overheadEmptyText}>
                {planesLoading ? "Scanning the sky…" : "No aircraft in range right now. (Live view needs the phone app.)"}
              </Text>
            </View>
          ) : (
            planes.map((p, i) => (
              <View key={p.callsign + i} style={[styles.planeRow, i > 0 && styles.planeRowBorder]}>
                <View style={styles.planeLogo}>
                  {p.airlineIata ? (
                    <Image source={{ uri: airlineLogoUrl(p.airlineIata) }} style={styles.planeLogoImg} contentFit="contain" transition={200} />
                  ) : (
                    <Ionicons name="airplane" size={20} color={colors.brand} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planeTitle} numberOfLines={1}>
                    {p.callsign}{p.airlineName ? ` · ${p.airlineName}` : ""}
                  </Text>
                  <Text style={styles.planeSub} numberOfLines={1}>
                    {p.from && p.to ? `${p.from} → ${p.to}` : p.type || "In flight"}
                  </Text>
                </View>
                <View style={styles.planeMeta}>
                  <Text style={styles.planeAlt}>{p.altFt ? `${p.altFt.toLocaleString()} ft` : "—"}</Text>
                  <Text style={styles.planeDist}>
                    {p.distanceMi} mi{p.headingDeg >= 0 ? ` ${compass(p.headingDeg)}` : ""}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>

        <MasterToggle
          label="Flight Tracking"
          description="Show planes flying near you"
          value={f.enabled}
          onValueChange={(v) => updateFlights({ enabled: v })}
        />

        <SectionLabel>Your Location</SectionLabel>
        <Card>
          <Text style={styles.fieldLabel}>ZIP code</Text>
          <View style={styles.zipRow}>
            <TextInput
              value={zip}
              onChangeText={onZip}
              placeholder="28117"
              placeholderTextColor={colors.onSurfaceSecondary}
              keyboardType="number-pad"
              maxLength={5}
              style={[styles.input, { flex: 1 }]}
            />
            <View style={styles.locBadge}>
              <Ionicons
                name={located ? "location" : "location-outline"}
                size={18}
                color={located ? colors.success : colors.onSurfaceSecondary}
              />
            </View>
          </View>
          <Text style={styles.locText}>
            {looking
              ? "Looking up location…"
              : located
                ? `${f.city}, ${f.state}  ·  ${f.lat?.toFixed(3)}, ${f.lon?.toFixed(3)}`
                : "Enter a US ZIP to center the radar."}
          </Text>
        </Card>

        <SectionLabel>Search Radius</SectionLabel>
        <Card>
          <View style={styles.radiusHeader}>
            <Text style={styles.radiusLabel}>Range around you</Text>
            <Text style={styles.radiusValue}>{radius_} mi</Text>
          </View>
          <Slider
            style={{ width: "100%", height: 40 }}
            minimumValue={1}
            maximumValue={100}
            step={1}
            value={radius_}
            minimumTrackTintColor={colors.brand}
            maximumTrackTintColor={colors.surfaceTertiary}
            thumbTintColor="#ffffff"
            onValueChange={(v) => {
              setRadius(Math.round(v));
              Haptics.selectionAsync();
            }}
            onSlidingComplete={(v) => updateFlights({ radiusMi: Math.round(v) })}
          />
          <View style={styles.scaleRow}>
            <Text style={styles.scaleText}>1 mi</Text>
            <Text style={styles.scaleText}>100 mi</Text>
          </View>
        </Card>

        <SectionLabel>Track a Specific Flight</SectionLabel>
        <Card>
          <ToggleRow
            label="Follow one flight"
            icon="navigate"
            value={f.trackFlight}
            onValueChange={(v) => updateFlights({ trackFlight: v })}
          />
          {f.trackFlight && (
            <>
              <View style={styles.trackDivider} />
              <Text style={styles.fieldLabel}>Flight number / callsign</Text>
              <TextInput
                value={ident}
                onChangeText={onIdent}
                placeholder="e.g. AA1234 or UAL123"
                placeholderTextColor={colors.onSurfaceSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.input}
              />
              <Text style={styles.locText}>
                Great for following a family member&apos;s trip — the matrix pins this
                flight and shows its altitude, heading and distance.
              </Text>
              <View style={styles.trackDivider} />
              <ToggleRow
                label="Landing alert"
                icon="alert-circle"
                value={f.landingAlert}
                onValueChange={(v) => updateFlights({ landingAlert: v })}
              />
              <Text style={styles.locText}>
                Flash the matrix when this flight starts descending or lands.
              </Text>
              <View style={styles.trackDivider} />
              <ToggleRow
                label="Landing chime"
                icon="notifications"
                value={f.landingChime}
                onValueChange={(v) => updateFlights({ landingChime: v })}
              />
              <Text style={styles.locText}>
                Play a soft chime on your phone when this flight is landing soon.
              </Text>
            </>
          )}
        </Card>

        <Text style={styles.footer}>
          The matrix fetches live ADS-B traffic from adsb.lol within this radius
          and shows the closest aircraft with its airline logo.
        </Text>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 150 },
  body: { paddingHorizontal: spacing.lg },
  overheadHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  overheadSpin: { marginTop: spacing.lg, marginBottom: spacing.sm },
  overheadCard: { padding: 0, overflow: "hidden" },
  overheadEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  overheadEmptyText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    lineHeight: 18,
  },
  planeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  planeRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  planeLogo: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  planeLogoImg: { width: 30, height: 30 },
  planeTitle: { fontFamily: fonts.textMedium, fontSize: fontSize.base, color: colors.onSurface },
  planeSub: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  planeMeta: { alignItems: "flex-end" },
  planeAlt: { fontFamily: fonts.displayMedium, fontSize: fontSize.base, color: colors.brand },
  planeDist: { fontFamily: fonts.text, fontSize: fontSize.xs, color: colors.onSurfaceSecondary },
  fieldLabel: {
    fontFamily: fonts.textMedium,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginBottom: spacing.xs,
  },
  zipRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
  locBadge: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
  },
  locText: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.sm,
  },
  radiusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: spacing.sm,
  },
  radiusLabel: {
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  radiusValue: {
    fontFamily: fonts.displayBold,
    fontSize: fontSize["2xl"],
    color: colors.brand,
  },
  scaleRow: { flexDirection: "row", justifyContent: "space-between" },
  trackDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  scaleText: {
    fontFamily: fonts.text,
    fontSize: fontSize.xs,
    color: colors.onSurfaceSecondary,
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

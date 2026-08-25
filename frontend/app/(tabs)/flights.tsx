import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useMatrix } from "@/src/store/matrix";
import { useToast } from "@/src/components/Toast";
import { Hero, Card, SectionLabel, MasterToggle, ToggleRow } from "@/src/components/ui";
import { geocodeZip } from "@/src/services/geocode";

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

  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      bottomOffset={20}
    >
      <Hero image={HERO} title="Flight Radar" subtitle="Overhead air traffic" icon="airplane" />

      <View style={styles.body}>
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
                Great for following a family member's trip — the matrix pins this
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

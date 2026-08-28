import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import {
  latestRadarFrame,
  lonToTileXf,
  latToTileYf,
  baseTileUrl,
  radarTileUrl,
} from "@/src/services/radar";

const ZOOM = 7;

/** A live precipitation-radar snapshot centered on the user, with a marker. */
export function RadarCard({ lat, lon }: { lat: number; lon: number }) {
  const [frame, setFrame] = useState<{ host: string; path: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => latestRadarFrame().then((f) => alive && setFrame(f));
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const xf = lonToTileXf(lon, ZOOM);
  const yf = latToTileYf(lat, ZOOM);
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  const leftPct = `${((xf - x) * 100).toFixed(1)}%` as const;
  const topPct = `${((yf - y) * 100).toFixed(1)}%` as const;

  return (
    <View style={styles.card}>
      <View style={styles.map}>
        <Image source={{ uri: baseTileUrl(x, y, ZOOM) }} style={StyleSheet.absoluteFill} contentFit="fill" />
        {frame && (
          <Image
            source={{ uri: radarTileUrl(frame, x, y, ZOOM) }}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            transition={250}
          />
        )}
        <View style={[styles.marker, { left: leftPct, top: topPct }]}>
          <View style={styles.markerDot} />
          <View style={styles.markerRing} />
        </View>
      </View>
      <Text style={styles.caption}>
        Live precipitation radar · {frame ? "Esri · RainViewer" : "loading…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
  },
  map: { width: "100%", aspectRatio: 1.6, backgroundColor: "#0b0e13" },
  marker: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  markerDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    marginTop: -5,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: "#fff",
  },
  markerRing: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: -11,
    marginTop: -11,
    borderWidth: 2,
    borderColor: colors.brand + "88",
  },
  caption: {
    fontFamily: fonts.text,
    fontSize: fontSize.xs,
    color: colors.onSurfaceTertiary,
    padding: spacing.sm,
    textAlign: "center",
  },
});

import React, { useEffect, useState } from "react";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import {
  latestRadar,
  lonToTileXf,
  latToTileYf,
  baseTileUrl,
  radarTileUrl,
  type RadarSet,
} from "@/src/services/radar";

const FRAME_MS = 550;
const RADAR_Z = 7; // RainViewer radar tiles only resolve up to zoom 7.

function frameLabel(unixSec: number): string {
  try {
    return new Date(unixSec * 1000).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function tileFor(lat: number, lon: number, z: number) {
  const xf = lonToTileXf(lon, z);
  const yf = latToTileYf(lat, z);
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, fracX: xf - x, fracY: yf - y };
}

/** Base + looping radar overlay for a single tile. */
function TileLayers({ x, y, z, set, idx }: { x: number; y: number; z: number; set: RadarSet | null; idx: number }) {
  const frame = set?.frames[idx];
  return (
    <>
      <Image source={{ uri: baseTileUrl(x, y, z) }} style={StyleSheet.absoluteFill} contentFit="fill" />
      {frame && (
        <Image
          source={{ uri: radarTileUrl(set!.host, frame.path, x, y, z) }}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          transition={0}
        />
      )}
    </>
  );
}

function Marker() {
  return (
    <View style={styles.marker}>
      <View style={styles.markerDot} />
      <View style={styles.markerRing} />
    </View>
  );
}

/** Loop the frame index for a set. */
function useLoop(set: RadarSet | null, playing: boolean, setIdx: (fn: (i: number) => number) => void) {
  useEffect(() => {
    if (!playing || !set || set.frames.length < 2) return;
    const iv = setInterval(() => setIdx((i) => (i + 1) % set.frames.length), FRAME_MS);
    return () => clearInterval(iv);
  }, [playing, set, setIdx]);
}

/** A live, animated precipitation-radar snapshot; tap to expand + pinch-zoom. */
export function RadarCard({ lat, lon }: { lat: number; lon: number }) {
  const [set, setSet] = useState<RadarSet | null>(null);
  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => latestRadar().then((s) => alive && setSet(s));
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Prefetch the center tile across all frames for a smooth loop.
  useEffect(() => {
    if (!set) return;
    const { x, y } = tileFor(lat, lon, RADAR_Z);
    Image.prefetch(set.frames.map((f) => radarTileUrl(set.host, f.path, x, y, RADAR_Z))).catch(() => {});
  }, [lat, lon, set]);

  useLoop(set, !full, setIdx);

  const { x, y, fracX, fracY } = tileFor(lat, lon, RADAR_Z);
  const frame = set?.frames[idx];

  return (
    <>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          setFull(true);
        }}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.map}>
          <TileLayers x={x} y={y} z={RADAR_Z} set={set} idx={idx} />
          <View style={[styles.markerWrap, { left: `${(fracX * 100).toFixed(1)}%`, top: `${(fracY * 100).toFixed(1)}%` }]}>
            <Marker />
          </View>
          <View style={styles.expandBadge}>
            <Ionicons name="scan-outline" size={14} color="#fff" />
            <Text style={styles.expandText}>Expand</Text>
          </View>
          {frame && (
            <View style={styles.timeBadge}>
              <Text style={styles.timeText}>{frameLabel(frame.time)}</Text>
            </View>
          )}
        </View>
        <Text style={styles.caption}>
          Live precipitation radar · {set ? "tap to expand & zoom" : "loading…"}
        </Text>
      </Pressable>

      <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)} transparent={false}>
        <RadarFullScreen lat={lat} lon={lon} set={set} onClose={() => setFull(false)} />
      </Modal>
    </>
  );
}

function RadarFullScreen({ lat, lon, set, onClose }: { lat: number; lon: number; set: RadarSet | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  useLoop(set, playing, setIdx);

  const win = Dimensions.get("window");
  const size = Math.min(win.width, win.height - 210);
  const T = size; // each tile fills the viewport square at scale 1

  const { x, y, fracX, fracY } = tileFor(lat, lon, RADAR_Z);

  // Prefetch the 3x3 neighborhood (latest frame) so panning is smooth.
  useEffect(() => {
    if (!set) return;
    const f = set.frames[set.frames.length - 1];
    const urls: string[] = [];
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) urls.push(radarTileUrl(set.host, f.path, x + dc, y + dr, RADAR_Z));
    Image.prefetch(urls).catch(() => {});
  }, [set, x, y]);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sScale = useSharedValue(1);
  const sTx = useSharedValue(0);
  const sTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart(() => { sScale.value = scale.value; })
    .onUpdate((e) => { scale.value = Math.min(Math.max(sScale.value * e.scale, 1), 6); });
  const pan = Gesture.Pan()
    .onStart(() => { sTx.value = tx.value; sTy.value = ty.value; })
    .onUpdate((e) => { tx.value = sTx.value + e.translationX; ty.value = sTy.value + e.translationY; });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      sScale.value = 1; sTx.value = 0; sTy.value = 0;
    });
  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const mosaicStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const cells: { col: number; row: number }[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) cells.push({ col, row });

  const frame = set?.frames[idx];

  return (
    <View style={[styles.fsRoot, { paddingTop: insets.top }]}>
      <View style={styles.fsHeader}>
        <View>
          <Text style={styles.fsTitle}>Live Radar</Text>
          <Text style={styles.fsSub}>{frame ? `Frame · ${frameLabel(frame.time)}` : "Loading…"}</Text>
        </View>
        <Pressable hitSlop={12} onPress={onClose} style={styles.fsClose}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.fsMapWrap}>
        <View style={[styles.fsMap, { width: size, height: size }]}>
          <GestureDetector gesture={gesture}>
            <Animated.View style={[{ position: "absolute", left: -T, top: -T, width: 3 * T, height: 3 * T }, mosaicStyle]}>
              {cells.map(({ col, row }) => (
                <View key={`${col}-${row}`} style={{ position: "absolute", left: col * T, top: row * T, width: T, height: T }}>
                  <TileLayers x={x + col - 1} y={y + row - 1} z={RADAR_Z} set={set} idx={idx} />
                </View>
              ))}
              <View style={[styles.markerWrap, { left: (1 + fracX) * T, top: (1 + fracY) * T }]}>
                <Marker />
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
        <Text style={styles.fsHint}>Pinch to zoom · drag to pan · double-tap to reset</Text>
      </View>

      <View style={styles.fsControls}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0);
            sScale.value = 1; sTx.value = 0; sTy.value = 0;
          }}
          style={styles.resetBtn}
        >
          <Ionicons name="contract-outline" size={18} color={colors.onSurface} />
          <Text style={styles.resetText}>Reset view</Text>
        </Pressable>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); setPlaying((p) => !p); }}
          style={[styles.ctrlBtn, styles.playBtn]}
        >
          <Ionicons name={playing ? "pause" : "play"} size={22} color={colors.brand} />
        </Pressable>
      </View>
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
  markerWrap: { position: "absolute", width: 0, height: 0 },
  marker: { position: "absolute", width: 0, height: 0 },
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
  expandBadge: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  expandText: { fontFamily: fonts.textMedium, fontSize: 11, color: "#fff" },
  timeBadge: {
    position: "absolute",
    bottom: spacing.sm,
    left: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  timeText: { fontFamily: fonts.mono, fontSize: 11, color: "#fff" },
  caption: {
    fontFamily: fonts.text,
    fontSize: fontSize.xs,
    color: colors.onSurfaceTertiary,
    padding: spacing.sm,
    textAlign: "center",
  },
  // Fullscreen
  fsRoot: { flex: 1, backgroundColor: colors.surface },
  fsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  fsTitle: { fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface },
  fsSub: { fontFamily: fonts.text, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  fsClose: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
  },
  fsMapWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  fsMap: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    backgroundColor: "#0b0e13",
  },
  fsHint: { fontFamily: fonts.text, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: spacing.md },
  fsControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  resetText: { fontFamily: fonts.textMedium, fontSize: fontSize.base, color: colors.onSurface },
  ctrlBtn: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26, backgroundColor: colors.surfaceTertiary },
  playBtn: { borderWidth: 1, borderColor: colors.brand },
});

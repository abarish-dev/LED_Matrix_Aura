import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";

export const REFRESH_MS = 30000;
export const ORDER_KEY = "aura_summary_order_v1";
export const HIDDEN_KEY = "aura_summary_hidden_v1";
export const COMPACT_KEY = "aura_summary_compact_v1";
export const DEFAULT_ORDER = ["overhead", "sports", "weather"];

export const CARD_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  overhead: "airplane",
  sports: "trophy",
  weather: "partly-sunny",
};

export const CARD_LABEL: Record<string, string> = {
  overhead: "Overhead",
  sports: "Sports",
  weather: "Weather",
};

export type LandingInfo = {
  callsign: string;
  altFt: number;
  distanceMi: number;
  state: "descending" | "landing";
  etaMin: number | null;
};

export const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();

// Ionicons glyph that matches live weather conditions (day/night aware).
export function wxGlyph(code: number, isDay: boolean): keyof typeof Ionicons.glyphMap {
  if (code === 0) return isDay ? "sunny" : "moon";
  if (code === 1 || code === 2) return isDay ? "partly-sunny" : "cloudy-night";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "cloud";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunderstorm";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  return "partly-sunny";
}

// Accent color tuned to the condition.
export function wxAccent(code: number): string {
  if (code === 0 || code === 1 || code === 2) return colors.warning; // sun
  if (code >= 95) return "#8b5cf6"; // storm
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return colors.info; // rain
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "#93c5fd"; // snow
  return colors.onSurfaceSecondary; // clouds / fog
}

/** "3h 12m" / "2d 4h" / "12m" until an ISO timestamp, or null if past. */
export function until(iso: string | null, now: number): string | null {
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

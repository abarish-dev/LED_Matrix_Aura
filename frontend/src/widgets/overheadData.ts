// Data for the Android "Overhead" home-screen widget. Runs in a headless JS
// context, so it reads the saved location straight from AsyncStorage and hits
// adsb.lol directly (no app state / store available here).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { nearbyPlanes } from "@/src/services/adsb";

export type OverheadData = {
  ok: boolean; // a flight was found
  located: boolean; // the user has set a home location
  callsign: string;
  airline: string;
  altFt: number;
  distanceMi: number;
  heading: number; // degrees, -1 if unknown
  updated: string; // "9:41 PM"
};

const SETTINGS_KEY = "aura_settings_v1";

function nowLabel(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function emptyOverhead(located: boolean): OverheadData {
  return {
    ok: false,
    located,
    callsign: "",
    airline: "",
    altFt: 0,
    distanceMi: 0,
    heading: -1,
    updated: nowLabel(),
  };
}

export async function loadOverhead(): Promise<OverheadData> {
  let lat: number | null = null;
  let lon: number | null = null;
  let radius = 25;
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      lat = typeof s?.flights?.lat === "number" ? s.flights.lat : null;
      lon = typeof s?.flights?.lon === "number" ? s.flights.lon : null;
      if (typeof s?.flights?.radiusMi === "number") radius = s.flights.radiusMi;
    }
  } catch {
    /* ignore */
  }

  if (lat == null || lon == null) return emptyOverhead(false);

  try {
    const list = await nearbyPlanes(lat, lon, radius, 1);
    const p = list[0];
    if (p) {
      return {
        ok: true,
        located: true,
        callsign: p.callsign,
        airline: p.airlineName || "",
        altFt: p.altFt,
        distanceMi: p.distanceMi,
        heading: p.headingDeg,
        updated: nowLabel(),
      };
    }
  } catch {
    /* ignore */
  }
  return emptyOverhead(true);
}

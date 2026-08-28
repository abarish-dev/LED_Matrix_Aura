// Device GPS → home location, reusing the ZIP pipeline for consistent
// city/state labels. Follows the permission contract (handles denied/blocked).
import * as Location from "expo-location";
import { geocodeZip, type Coords } from "@/src/services/geocode";

export type LocResult = Coords & { zip: string };

export type DetectResult =
  | { ok: true; data: LocResult }
  | { ok: false; reason: "denied" | "blocked" | "error" };

export async function detectLocation(): Promise<DetectResult> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      if (!perm.canAskAgain) return { ok: false, reason: "blocked" };
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (perm.status !== "granted") {
      return { ok: false, reason: perm.canAskAgain ? "denied" : "blocked" };
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    let city = "";
    let state = "";
    let zip = "";
    try {
      const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      const g = geo[0];
      if (g) {
        city = g.city || g.subregion || "";
        state = g.region || "";
        zip = (g.postalCode || "").replace(/[^0-9]/g, "").slice(0, 5);
      }
    } catch {
      /* reverse geocode unavailable — fall back to raw GPS */
    }

    // Prefer the ZIP pipeline so labels match manual entry (city + abbr).
    if (zip.length === 5) {
      const z = await geocodeZip(zip);
      if (z) return { ok: true, data: { lat, lon, city: z.city, state: z.state, zip } };
    }
    return { ok: true, data: { lat, lon, city, state, zip } };
  } catch {
    return { ok: false, reason: "error" };
  }
}

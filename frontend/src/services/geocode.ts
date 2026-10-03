// Zip -> lat/lon lookup using the free, key-less Zippopotam.us public API.
// https://api.zippopotam.us/us/28117 -> { places: [{ latitude, longitude }] }
// Results are cached locally so a sync can still proceed if the lookup
// service is briefly unreachable.

import { storage } from "@/src/utils/storage";

export type Coords = {
  lat: number;
  lon: number;
  city: string;
  state: string;
};

export type GeoResult = Coords & { cached: boolean };

const CACHE_KEY = "geocode_cache_v1";

async function readCache(): Promise<Record<string, Coords>> {
  const raw = (await storage.getItem<any>(CACHE_KEY, null)) as
    | Record<string, Coords>
    | null;
  return raw ?? {};
}

async function writeCache(zip: string, coords: Coords): Promise<void> {
  const cache = await readCache();
  cache[zip] = coords;
  await storage.setItem(CACHE_KEY, cache as any);
}

export async function getCachedZip(zip: string): Promise<Coords | null> {
  const cache = await readCache();
  return cache[zip] ?? null;
}

export const ZIP_LOOKUP_TIMEOUT_MS = 8000;

export type ZipLookup =
  | ({ ok: true } & GeoResult)
  | { ok: false; reason: "notfound" | "timeout" | "network" };

/**
 * Look up a ZIP with a hard timeout (8 s by default) so the UI can never wait
 * forever on a hung request. Falls back to the local cache when the service is
 * slow or unreachable, and says why when there is no answer at all.
 */
export async function lookupZip(zip: string, timeoutMs = ZIP_LOOKUP_TIMEOUT_MS): Promise<ZipLookup> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  let failure: "notfound" | "timeout" | "network" = "notfound";
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json();
      const place = data?.places?.[0];
      if (place) {
        const lat = parseFloat(place.latitude);
        const lon = parseFloat(place.longitude);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          const coords: Coords = {
            lat,
            lon,
            city: place["place name"] ?? "",
            state: place["state abbreviation"] ?? place.state ?? "",
          };
          await writeCache(zip, coords);
          return { ok: true, ...coords, cached: false };
        }
      }
    } else if (res.status >= 500) {
      failure = "network";
    }
  } catch {
    // aborted (timeout) or network error -> try the cache below
    failure = timedOut ? "timeout" : "network";
  } finally {
    clearTimeout(timer);
  }
  const cached = await getCachedZip(zip);
  if (cached) return { ok: true, ...cached, cached: true };
  return { ok: false, reason: failure };
}

export async function geocodeZip(zip: string): Promise<GeoResult | null> {
  const r = await lookupZip(zip);
  if (!r.ok) return null;
  const { ok: _ok, ...geo } = r;
  return geo;
}

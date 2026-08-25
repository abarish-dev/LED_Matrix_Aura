// Live "overhead now" flights for the app.
// Positions: adsb.lol (keyless; note: no CORS header, so this only resolves on
// the native device build, not the web preview). Route/airline enrichment:
// adsbdb.com (keyless, CORS-enabled) → airline name/IATA + origin/destination.

export type Plane = {
  callsign: string;
  airlineName: string;
  airlineIata: string | null; // for logo
  from: string | null; // origin IATA
  to: string | null; // destination IATA
  altFt: number;
  distanceMi: number;
  headingDeg: number;
  type: string; // aircraft type code
};

function haversineMi(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 3958.8;
  const dLa = ((la2 - la1) * Math.PI) / 180;
  const dLo = ((lo2 - lo1) * Math.PI) / 180;
  const a =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function compass(deg: number): string {
  if (deg < 0) return "";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

const routeCache = new Map<string, { at: number; data: any }>();

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

async function enrichRoute(callsign: string): Promise<{
  airlineName: string;
  airlineIata: string | null;
  from: string | null;
  to: string | null;
} | null> {
  const cs = callsign.trim();
  if (!cs) return null;
  const cached = routeCache.get(cs);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.data;
  const res = await fetchWithTimeout(`https://api.adsbdb.com/v0/callsign/${cs}`);
  if (!res || !res.ok) return null;
  try {
    const j = await res.json();
    const fr = j?.response?.flightroute;
    if (!fr) return null;
    const data = {
      airlineName: fr.airline?.name ?? "",
      airlineIata: fr.airline?.iata ?? null,
      from: fr.origin?.iata_code ?? null,
      to: fr.destination?.iata_code ?? null,
    };
    routeCache.set(cs, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

export function airlineLogoUrl(iata: string): string {
  return `https://www.gstatic.com/flights/airline_logos/70px/${iata}.png`;
}

export async function nearbyPlanes(
  lat: number,
  lon: number,
  radiusMi: number,
  limit = 4,
): Promise<Plane[]> {
  const nm = Math.max(1, Math.round(radiusMi / 1.15078));
  const res = await fetchWithTimeout(
    `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
  );
  if (!res || !res.ok) return [];
  let data: any;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  const ac: any[] = Array.isArray(data?.ac) ? data.ac : [];
  const planes: Plane[] = ac
    .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
    .map((a) => {
      const callsign = String(a.flight ?? "").trim();
      return {
        callsign,
        airlineName: "",
        airlineIata: null,
        from: null,
        to: null,
        altFt: typeof a.alt_baro === "number" ? a.alt_baro : 0,
        distanceMi: Math.round(haversineMi(lat, lon, a.lat, a.lon)),
        headingDeg: typeof a.track === "number" ? Math.round(a.track) : -1,
        type: String(a.t ?? ""),
      } as Plane;
    })
    .filter((p) => p.callsign.length > 0)
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, limit);

  // Enrich the closest few with airline + route (best-effort, parallel).
  await Promise.all(
    planes.map(async (p) => {
      const r = await enrichRoute(p.callsign);
      if (r) {
        p.airlineName = r.airlineName;
        p.airlineIata = r.airlineIata;
        p.from = r.from;
        p.to = r.to;
      }
    }),
  );
  return planes;
}

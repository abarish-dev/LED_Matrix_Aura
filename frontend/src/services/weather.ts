// Live NWS weather alerts for the app (api.weather.gov, keyless, CORS-enabled).

export type Alert = {
  id: string;
  event: string; // "Tornado Warning"
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  area: string; // short area description
  headline: string;
  description: string;
  instruction: string;
  expires: string | null; // ISO
};

const SEV_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

export function severityColorHex(sev: Alert["severity"]): string {
  switch (sev) {
    case "Extreme":
      return "#ef4444";
    case "Severe":
      return "#f97316";
    case "Moderate":
      return "#eab308";
    case "Minor":
      return "#0ea5e9";
    default:
      return "#a1a1aa";
  }
}

function shortArea(areaDesc: string): string {
  if (!areaDesc) return "";
  const parts = areaDesc.split(";").map((s) => s.trim());
  if (parts.length <= 2) return parts.join(", ");
  return `${parts[0]}, ${parts[1]} +${parts.length - 2} more`;
}

export async function activeAlerts(lat: number, lon: number): Promise<Alert[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        signal: ctrl.signal,
        headers: { Accept: "application/geo+json" },
      },
    );
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    const feats: any[] = Array.isArray(data?.features) ? data.features : [];
    const alerts: Alert[] = feats.map((f) => {
      const p = f.properties ?? {};
      const sev = (p.severity ?? "Unknown") as Alert["severity"];
      return {
        id: f.id ?? p.id ?? `${p.event}-${p.effective}`,
        event: p.event ?? "Weather Alert",
        severity: SEV_RANK[sev] != null ? sev : "Unknown",
        area: shortArea(p.areaDesc ?? ""),
        headline: p.headline ?? "",
        description: p.description ?? "",
        instruction: p.instruction ?? "",
        expires: p.expires ?? null,
      };
    });
    // De-dupe by event+area, then sort most severe first.
    const seen = new Set<string>();
    const unique = alerts.filter((a) => {
      const k = a.event + "|" + a.area;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    unique.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
    return unique;
  } catch {
    return [];
  }
}

// ---- Current conditions (Open-Meteo, keyless + CORS-enabled) --------------

export type CurrentWx = {
  tempF: number;
  code: number;
  label: string; // "Clear", "Light rain", …
  icon: string; // Ionicons glyph name
  isRaining: boolean; // precipitating right now
  rainChance: number | null; // today's max precip probability (%)
  hiF: number | null; // today's high (°F)
  loF: number | null; // today's low (°F)
  feelsF: number | null; // apparent ("feels like") temperature (°F)
  isDay: boolean; // daylight now (for sun/moon icon choice)
};

// WMO weather-code → friendly label + icon (Ionicons) + rain flag.
function describeCode(code: number): { label: string; icon: string; rain: boolean } {
  if (code === 0) return { label: "Clear", icon: "sunny", rain: false };
  if (code === 1 || code === 2) return { label: "Partly cloudy", icon: "partly-sunny", rain: false };
  if (code === 3) return { label: "Overcast", icon: "cloud", rain: false };
  if (code === 45 || code === 48) return { label: "Fog", icon: "cloudy", rain: false };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "rainy", rain: true };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "rainy", rain: true };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "snow", rain: false };
  if (code >= 80 && code <= 82) return { label: "Rain showers", icon: "rainy", rain: true };
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "snow", rain: false };
  if (code >= 95) return { label: "Thunderstorm", icon: "thunderstorm", rain: true };
  return { label: "—", icon: "partly-sunny", rain: false };
}

export async function currentConditions(lat: number, lon: number): Promise<CurrentWx | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
      `&longitude=${lon.toFixed(4)}` +
      `&current=temperature_2m,precipitation,weather_code,apparent_temperature,is_day` +
      `&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data?.current;
    if (!cur || typeof cur.temperature_2m !== "number") return null;
    const code = typeof cur.weather_code === "number" ? cur.weather_code : 0;
    const d = describeCode(code);
    const precipNow = typeof cur.precipitation === "number" ? cur.precipitation : 0;
    const chanceArr = data?.daily?.precipitation_probability_max;
    const rainChance =
      Array.isArray(chanceArr) && typeof chanceArr[0] === "number" ? chanceArr[0] : null;
    const hiArr = data?.daily?.temperature_2m_max;
    const loArr = data?.daily?.temperature_2m_min;
    const hiF = Array.isArray(hiArr) && typeof hiArr[0] === "number" ? Math.round(hiArr[0]) : null;
    const loF = Array.isArray(loArr) && typeof loArr[0] === "number" ? Math.round(loArr[0]) : null;
    const feelsF =
      typeof cur.apparent_temperature === "number" ? Math.round(cur.apparent_temperature) : null;
    return {
      tempF: Math.round(cur.temperature_2m),
      code,
      label: d.label,
      icon: d.icon,
      isRaining: d.rain || precipNow > 0,
      rainChance,
      hiF,
      loF,
      feelsF,
      isDay: cur.is_day == null ? true : cur.is_day === 1,
    };
  } catch {
    return null;
  }
}

// ---- Short-term rain nowcast (Open-Meteo minutely_15, keyless) -------------

export type RainSoon = { minutes: number; mmPerHr: number; label: string };

/** True when the current local hour falls inside a quiet-hours window. */
export function isQuietNow(enabled: boolean, startHour: number, endHour: number): boolean {
  if (!enabled) return false;
  const h = new Date().getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour; // wraps midnight
}

/**
 * Detects rain arriving at the point within the next hour while it's not
 * currently raining. Uses Open-Meteo's 15-minute precipitation nowcast (the
 * same radar-derived data RainViewer draws), returning minutes-until + a
 * light/moderate/heavy label, or null if nothing is on the way.
 */
export async function rainArriving(lat: number, lon: number): Promise<RainSoon | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
      `&longitude=${lon.toFixed(4)}` +
      `&current=precipitation` +
      `&minutely_15=precipitation` +
      `&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const nowPrecip =
      typeof data?.current?.precipitation === "number" ? data.current.precipitation : 0;
    if (nowPrecip > 0.05) return null; // already raining — not an "arriving" alert
    const times: string[] = Array.isArray(data?.minutely_15?.time) ? data.minutely_15.time : [];
    const precs: number[] = Array.isArray(data?.minutely_15?.precipitation)
      ? data.minutely_15.precipitation
      : [];
    if (!times.length || times.length !== precs.length) return null;
    const now = Date.now();
    for (let i = 0; i < times.length; i++) {
      const ts = new Date(times[i]).getTime();
      const dtMin = (ts - now) / 60000;
      if (dtMin < 0 || dtMin > 60) continue;
      const mm = precs[i];
      if (typeof mm === "number" && mm >= 0.1) {
        const mmPerHr = mm * 4; // 15-min accumulation → hourly rate
        const label = mmPerHr < 2.5 ? "Light rain" : mmPerHr < 7.6 ? "Moderate rain" : "Heavy rain";
        return {
          minutes: Math.max(1, Math.round(dtMin)),
          mmPerHr: Math.round(mmPerHr * 10) / 10,
          label,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function expiresLabel(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `until ${d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  } catch {
    return "";
  }
}

const locCache = new Map<string, { at: number; data: LocationInfo }>();

export type LocationInfo = { city: string; state: string; county: string };

/** Resolve the NWS city/state + county name for a point. */
export async function locationInfo(lat: number, lon: number): Promise<LocationInfo | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = locCache.get(key);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return cached.data;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/geo+json" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const rel = data?.properties?.relativeLocation?.properties ?? {};
    const info: LocationInfo = {
      city: rel.city ?? "",
      state: rel.state ?? "",
      county: "",
    };
    // county property is a zone URL; fetch its name (best-effort).
    const countyUrl = data?.properties?.county;
    if (typeof countyUrl === "string") {
      try {
        const cr = await fetch(countyUrl, { headers: { Accept: "application/geo+json" } });
        if (cr.ok) {
          const cj = await cr.json();
          info.county = cj?.properties?.name ?? "";
        }
      } catch {
        /* ignore */
      }
    }
    locCache.set(key, { at: Date.now(), data: info });
    return info;
  } catch {
    return null;
  }
}

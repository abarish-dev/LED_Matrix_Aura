// Live NWS weather alerts for the app (api.weather.gov, keyless, CORS-enabled).

export type Alert = {
  event: string; // "Tornado Warning"
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  area: string; // short area description
  headline: string;
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
        event: p.event ?? "Weather Alert",
        severity: SEV_RANK[sev] != null ? sev : "Unknown",
        area: shortArea(p.areaDesc ?? ""),
        headline: p.headline ?? "",
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

export function expiresLabel(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `until ${d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  } catch {
    return "";
  }
}

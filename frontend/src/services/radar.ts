// Live precipitation radar tiles (RainViewer, keyless) over a dark base map
// (CartoDB). Both are plain image endpoints — work in the web preview too.

type RadarFrame = { time: number; path: string };
export type RadarSet = { host: string; frames: RadarFrame[] };

let cache: { at: number; set: RadarSet } | null = null;

/** Recent radar frames (~last hour) from RainViewer, cached 5 min. */
export async function latestRadar(): Promise<RadarSet | null> {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.set;
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    if (!res.ok) return null;
    const d = await res.json();
    const host: string | undefined = d?.host;
    const past = Array.isArray(d?.radar?.past) ? d.radar.past : [];
    if (host && past.length) {
      // Keep the last ~7 frames (RainViewer past frames are ~10 min apart).
      const frames: RadarFrame[] = past
        .slice(-7)
        .filter((f: any) => f?.path && typeof f.time === "number")
        .map((f: any) => ({ time: f.time as number, path: f.path as string }));
      if (frames.length) {
        const set = { host, frames };
        cache = { at: Date.now(), set };
        return set;
      }
    }
  } catch {
    /* offline */
  }
  return null;
}

// Web-Mercator tile math (fractional so we can place the location marker).
export function lonToTileXf(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
export function latToTileYf(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}

export function baseTileUrl(x: number, y: number, z: number): string {
  // ESRI Dark Gray Canvas — keyless, no watermark, matches the dark theme.
  // ESRI uses /{level}/{row}/{col} = /{z}/{y}/{x}.
  return `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
}

export function radarTileUrl(host: string, path: string, x: number, y: number, z: number): string {
  // size(512 supports deeper zoom) / z / x / y / color(4) / options(1_1 smooth+snow)
  return `${host}${path}/512/${z}/${x}/${y}/4/1_1.png`;
}

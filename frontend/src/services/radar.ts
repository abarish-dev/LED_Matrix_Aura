// Live precipitation radar tiles (RainViewer, keyless) over a dark base map
// (CartoDB). Both are plain image endpoints — work in the web preview too.

type RadarFrame = { host: string; path: string };

let cache: { at: number; frame: RadarFrame } | null = null;

/** Latest available radar frame path from RainViewer (cached 5 min). */
export async function latestRadarFrame(): Promise<RadarFrame | null> {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.frame;
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    if (!res.ok) return null;
    const d = await res.json();
    const host: string | undefined = d?.host;
    const past = Array.isArray(d?.radar?.past) ? d.radar.past : [];
    const nowcast = Array.isArray(d?.radar?.nowcast) ? d.radar.nowcast : [];
    const frames = [...past, ...nowcast];
    const last = frames[frames.length - 1];
    if (host && last?.path) {
      const frame = { host, path: last.path as string };
      cache = { at: Date.now(), frame };
      return frame;
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

export function radarTileUrl(frame: RadarFrame, x: number, y: number, z: number): string {
  // size / z / x / y / color(4 = "The Weather Channel") / options(1_1 smooth+snow)
  return `${frame.host}${frame.path}/256/${z}/${x}/${y}/4/1_1.png`;
}

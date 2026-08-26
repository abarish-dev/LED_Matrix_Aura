// ESPN public JSON — live scores for followed teams + next UFC event.
// Keyless. Cached in-memory with a short TTL so re-renders don't refetch.

import type { League } from "@/src/data/teams";

const PATHS: Record<League, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
};

export type ScoreLine = {
  state: "pre" | "in" | "post";
  detail: string; // "Final", "Q3 5:20", "Sun 1:00 PM"
  teamScore: number | null;
  oppScore: number | null;
  oppAbbr: string;
  atHome: boolean;
  startTime: string | null; // ISO kickoff/first-pitch time
};

type CacheEntry = { at: number; data: any };
const cache = new Map<string, CacheEntry>();
const TTL = 60_000;

async function fetchJson(url: string, timeoutMs = 8000): Promise<any | null> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < TTL) return cached.data;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    cache.set(url, { at: Date.now(), data });
    return data;
  } catch {
    return cached?.data ?? null;
  }
}

function shortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Latest / upcoming game score for a specific team. */
export async function getTeamScore(
  league: League,
  abbr: string,
): Promise<ScoreLine | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${PATHS[league]}/scoreboard`;
  const data = await fetchJson(url);
  if (!data?.events) return null;

  for (const ev of data.events) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    const competitors = comp.competitors ?? [];
    const mine = competitors.find(
      (c: any) => (c?.team?.abbreviation ?? "").toUpperCase() === abbr.toUpperCase(),
    );
    if (!mine) continue;
    const opp = competitors.find((c: any) => c !== mine);
    const st = comp?.status?.type ?? {};
    const state: ScoreLine["state"] =
      st.state === "in" ? "in" : st.state === "post" ? "post" : "pre";
    const detail =
      state === "pre" ? shortTime(ev.date) : st.shortDetail ?? st.description ?? "";
    return {
      state,
      detail,
      teamScore: mine.score != null ? parseInt(mine.score, 10) : null,
      oppScore: opp?.score != null ? parseInt(opp.score, 10) : null,
      oppAbbr: (opp?.team?.abbreviation ?? "").toUpperCase(),
      atHome: mine.homeAway === "home",
      startTime: ev.date ?? null,
    };
  }
  return null;
}

export type UfcEvent = {
  name: string;
  shortName: string;
  date: string; // pretty
  headline: string; // "Fighter A vs Fighter B"
};

/** Next (or in-progress) UFC event summary. */
export async function getNextUfc(): Promise<UfcEvent | null> {
  const url =
    "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";
  const data = await fetchJson(url);
  const events = data?.events;
  if (!events || events.length === 0) return null;

  // Prefer an in-progress/upcoming event; else the first listed.
  const ev =
    events.find((e: any) => e?.competitions?.[0]?.status?.type?.state !== "post") ??
    events[0];

  const comp = ev?.competitions?.[0];
  let headline = "";
  if (comp?.competitors?.length >= 2) {
    const a = comp.competitors[0]?.athlete?.displayName ?? comp.competitors[0]?.team?.displayName ?? "TBD";
    const b = comp.competitors[1]?.athlete?.displayName ?? comp.competitors[1]?.team?.displayName ?? "TBD";
    headline = `${a} vs ${b}`;
  }
  let dateStr = "";
  try {
    dateStr = new Date(ev.date).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    dateStr = "";
  }

  return {
    name: ev?.name ?? "UFC Event",
    shortName: ev?.shortName ?? "UFC",
    date: dateStr,
    headline,
  };
}

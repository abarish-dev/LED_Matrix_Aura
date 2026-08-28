// Central store for the Aura matrix companion.
// Holds all display settings + BLE connection state, persists to AsyncStorage,
// and pushes live commands / full-sync payloads to the matrix over BLE.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { storage } from "@/src/utils/storage";
import {
  connectToMatrix,
  disconnect as bleDisconnect,
  syncSettings,
  writeLive,
  flashTest as bleFlashTest,
  monitorMatrix,
  isBleSupported,
  readRssi,
  BleError,
  type BleStatus,
} from "@/src/services/ble";
import type { League } from "@/src/data/teams";

const SETTINGS_KEY = "aura_settings_v1";

export type Severity = "minor" | "moderate" | "severe" | "extreme";
export type SavedTeam = { league: League; abbr: string };

export type Settings = {
  flights: {
    enabled: boolean;
    zip: string;
    lat: number | null;
    lon: number | null;
    city: string;
    state: string;
    radiusMi: number;
    trackFlight: boolean;
    flightIdent: string;
    landingAlert: boolean;
    landingChime: boolean; // soft chime when a pinned flight is landing soon
    autoTracked: boolean; // pinned via Summary tap; auto-clears when out of range
  };
  sports: { enabled: boolean; teams: SavedTeam[]; ufc: boolean; rivals: string[]; favorites: string[]; showStreak: boolean };
  weather: {
    enabled: boolean;
    severity: Severity;
    showClock: boolean;
    showHiLo: boolean;
    showFeels: boolean;
    showWxIcon: boolean;
    alertSound: boolean;
    quietHours: { enabled: boolean; startHour: number; endHour: number };
    secondLocation: { zip: string; lat: number | null; lon: number | null; city: string; state: string };
  };
  brightness: number; // 0-100 matrix brightness
  holidayThemes: boolean; // shift accent colors on holidays
  nightMode: {
    enabled: boolean;
    useSunset: boolean; // dim from local sunset to sunrise instead of fixed hours
    startHour: number; // 0-23
    endHour: number; // 0-23
    dimLevel: number; // 0-100
    weekend: {
      enabled: boolean; // use a separate schedule Sat/Sun
      startHour: number;
      endHour: number;
      dimLevel: number;
    };
  };
};

export const DEFAULT_SETTINGS: Settings = {
  flights: {
    enabled: true,
    zip: "",
    lat: null,
    lon: null,
    city: "",
    state: "",
    radiusMi: 25,
    trackFlight: false,
    flightIdent: "",
    landingAlert: true,
    landingChime: true,
    autoTracked: false,
  },
  sports: { enabled: true, teams: [], ufc: false, rivals: [], favorites: [], showStreak: false },
  weather: {
    enabled: true,
    severity: "severe",
    showClock: false,
    showHiLo: false,
    showFeels: false,
    showWxIcon: false,
    alertSound: false,
    quietHours: { enabled: false, startHour: 22, endHour: 7 },
    secondLocation: { zip: "", lat: null, lon: null, city: "", state: "" },
  },
  brightness: 80,
  holidayThemes: true,
  nightMode: {
    enabled: false,
    useSunset: false,
    startHour: 22,
    endHour: 7,
    dimLevel: 20,
    weekend: { enabled: false, startHour: 23, endHour: 8, dimLevel: 20 },
  },
};

export type WifiStatus = "idle" | "sending" | "waiting" | "joined" | "failed";

type MatrixContextValue = {
  settings: Settings;
  hydrated: boolean;

  // BLE
  bleStatus: BleStatus;
  deviceName: string | null;
  rssi: number | null;
  bleSupported: boolean;

  // Wi-Fi provisioning status (read-back from matrix)
  wifiStatus: WifiStatus;
  wifiIp: string | null;
  lastSsid: string;

  // mutations
  updateFlights: (patch: Partial<Settings["flights"]>) => void;
  updateSports: (patch: Partial<Settings["sports"]>) => void;
  updateWeather: (patch: Partial<Settings["weather"]>) => void;
  updateQuietHours: (patch: Partial<Settings["weather"]["quietHours"]>) => void;
  updateSecondLocation: (patch: Partial<Settings["weather"]["secondLocation"]>) => void;
  toggleTeam: (team: SavedTeam) => void;
  reorderTeams: (teams: SavedTeam[]) => void;
  toggleRival: (key: string) => void;
  toggleFavorite: (key: string) => void;
  updateBrightness: (value: number) => void;
  updateHolidayThemes: (value: boolean) => void;
  updateNightMode: (patch: Partial<Omit<Settings["nightMode"], "weekend">>) => void;
  updateWeekend: (patch: Partial<Settings["nightMode"]["weekend"]>) => void;

  // BLE actions (throw BleError on failure)
  connect: () => Promise<{ name: string }>;
  disconnect: () => Promise<void>;
  syncAll: () => Promise<{ confirmed: boolean }>;
  sendWifi: (ssid: string, pass: string) => Promise<void>;
  flashTest: () => Promise<void>;
  weatherTest: () => Promise<void>;
};

const MatrixContext = createContext<MatrixContextValue | null>(null);

export function useMatrix(): MatrixContextValue {
  const ctx = useContext(MatrixContext);
  if (!ctx) throw new Error("useMatrix must be used within MatrixProvider");
  return ctx;
}

export function buildFullPayload(s: Settings) {
  return {
    flights: {
      enabled: s.flights.enabled,
      lat: s.flights.lat,
      lon: s.flights.lon,
      radiusMi: s.flights.radiusMi,
      trackFlight: s.flights.trackFlight,
      flightIdent: s.flights.flightIdent,
      landingAlert: s.flights.landingAlert,
    },
    sports: {
      enabled: s.sports.enabled,
      ufc: s.sports.ufc,
      teams: s.sports.teams.map((t) => `${t.league}:${t.abbr}`),
      rivals: s.sports.rivals,
      showStreak: s.sports.showStreak,
    },
    weather: {
      enabled: s.weather.enabled,
      severity: s.weather.severity,
      showClock: s.weather.showClock,
      showHiLo: s.weather.showHiLo,
      showFeels: s.weather.showFeels,
      showWxIcon: s.weather.showWxIcon,
    },
    brightness: s.brightness,
    holidayThemes: s.holidayThemes,
    nightMode: {
      enabled: s.nightMode.enabled,
      useSunset: s.nightMode.useSunset,
      startHour: s.nightMode.startHour,
      endHour: s.nightMode.endHour,
      dimLevel: s.nightMode.dimLevel,
      weekend: {
        enabled: s.nightMode.weekend.enabled,
        startHour: s.nightMode.weekend.startHour,
        endHour: s.nightMode.weekend.endHour,
        dimLevel: s.nightMode.weekend.dimLevel,
      },
    },
    syncedAt: Date.now(),
  };
}

function buildNightPayload(n: Settings["nightMode"]) {
  return {
    enabled: n.enabled,
    useSunset: n.useSunset,
    startHour: n.startHour,
    endHour: n.endHour,
    dimLevel: n.dimLevel,
    weekend: {
      enabled: n.weekend.enabled,
      startHour: n.weekend.startHour,
      endHour: n.weekend.endHour,
      dimLevel: n.weekend.dimLevel,
    },
  };
}

export function MatrixProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  const [bleStatus, setBleStatus] = useState<BleStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [rssi, setRssi] = useState<number | null>(null);
  const bleSupported = isBleSupported();

  const [wifiStatus, setWifiStatus] = useState<WifiStatus>("idle");
  const [wifiIp, setWifiIp] = useState<string | null>(null);
  const [lastSsid, setLastSsid] = useState("");

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pushTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ---- Hydration ------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<any>(SETTINGS_KEY, null);
      if (saved) {
        const sports = { ...DEFAULT_SETTINGS.sports, ...(saved.sports ?? {}) };
        // Migrate legacy single `favorite` -> `favorites[]`.
        if (!Array.isArray(sports.favorites)) sports.favorites = [];
        if (typeof (saved.sports?.favorite) === "string" && sports.favorites.length === 0) {
          sports.favorites = [saved.sports.favorite];
        }
        setSettings({
          flights: { ...DEFAULT_SETTINGS.flights, ...(saved.flights ?? {}) },
          sports,
          weather: { ...DEFAULT_SETTINGS.weather, ...(saved.weather ?? {}) },
          brightness:
            typeof saved.brightness === "number"
              ? saved.brightness
              : DEFAULT_SETTINGS.brightness,
          nightMode: { ...DEFAULT_SETTINGS.nightMode, ...(saved.nightMode ?? {}) },
          holidayThemes:
            typeof saved.holidayThemes === "boolean"
              ? saved.holidayThemes
              : DEFAULT_SETTINGS.holidayThemes,
        });
      }
      const ssid = await storage.getItem<string>("aura_last_ssid", "");
      if (ssid) setLastSsid(ssid);
      setHydrated(true);
    })();
  }, []);

  const persist = useCallback((next: Settings) => {
    storage.setItem(SETTINGS_KEY, next as any);
  }, []);

  // ---- Live push (debounced per command) ------------------------------------
  const livePush = useCallback((command: string, obj: Record<string, unknown>) => {
    if (bleStatus !== "connected") return;
    const key = command;
    if (pushTimers.current[key]) clearTimeout(pushTimers.current[key]);
    pushTimers.current[key] = setTimeout(() => {
      writeLive({ command, ...obj }).catch(() => {});
    }, 350);
  }, [bleStatus]);

  const updateFlights = useCallback(
    (patch: Partial<Settings["flights"]>) => {
      setSettings((prev) => {
        const next = { ...prev, flights: { ...prev.flights, ...patch } };
        persist(next);
        livePush("flights", {
          enabled: next.flights.enabled,
          lat: next.flights.lat,
          lon: next.flights.lon,
          radiusMi: next.flights.radiusMi,
          trackFlight: next.flights.trackFlight,
          flightIdent: next.flights.flightIdent,
          landingAlert: next.flights.landingAlert,
        });
        return next;
      });
    },
    [persist, livePush],
  );

  const updateSports = useCallback(
    (patch: Partial<Settings["sports"]>) => {
      setSettings((prev) => {
        const next = { ...prev, sports: { ...prev.sports, ...patch } };
        persist(next);
        livePush("sports", {
          enabled: next.sports.enabled,
          ufc: next.sports.ufc,
          teams: next.sports.teams.map((t) => `${t.league}:${t.abbr}`),
          rivals: next.sports.rivals,
          showStreak: next.sports.showStreak,
        });
        return next;
      });
    },
    [persist, livePush],
  );

  const updateWeather = useCallback(
    (patch: Partial<Settings["weather"]>) => {
      setSettings((prev) => {
        const next = { ...prev, weather: { ...prev.weather, ...patch } };
        persist(next);
        livePush("weather", {
          enabled: next.weather.enabled,
          severity: next.weather.severity,
          showClock: next.weather.showClock,
          showHiLo: next.weather.showHiLo,
          showFeels: next.weather.showFeels,
          showWxIcon: next.weather.showWxIcon,
        });
        return next;
      });
    },
    [persist, livePush],
  );

  const updateQuietHours = useCallback(
    (patch: Partial<Settings["weather"]["quietHours"]>) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          weather: { ...prev.weather, quietHours: { ...prev.weather.quietHours, ...patch } },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateSecondLocation = useCallback(
    (patch: Partial<Settings["weather"]["secondLocation"]>) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          weather: { ...prev.weather, secondLocation: { ...prev.weather.secondLocation, ...patch } },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );


  const toggleTeam = useCallback(
    (team: SavedTeam) => {
      setSettings((prev) => {
        const exists = prev.sports.teams.some(
          (t) => t.league === team.league && t.abbr === team.abbr,
        );
        const teams = exists
          ? prev.sports.teams.filter(
              (t) => !(t.league === team.league && t.abbr === team.abbr),
            )
          : [...prev.sports.teams, team];
        const key = `${team.league}:${team.abbr}`;
        const rivals = exists
          ? prev.sports.rivals.filter((r) => r !== key)
          : prev.sports.rivals;
        const favorites =
          exists ? prev.sports.favorites.filter((k) => k !== key) : prev.sports.favorites;
        const next = { ...prev, sports: { ...prev.sports, teams, rivals, favorites } };
        persist(next);
        livePush("sports", {
          enabled: next.sports.enabled,
          ufc: next.sports.ufc,
          teams: teams.map((t) => `${t.league}:${t.abbr}`),
          rivals: next.sports.rivals,
        });
        return next;
      });
    },
    [persist, livePush],
  );

  const reorderTeams = useCallback(
    (teams: SavedTeam[]) => {
      setSettings((prev) => {
        const next = { ...prev, sports: { ...prev.sports, teams } };
        persist(next);
        livePush("sports", {
          enabled: next.sports.enabled,
          ufc: next.sports.ufc,
          teams: teams.map((t) => `${t.league}:${t.abbr}`),
          rivals: next.sports.rivals,
        });
        return next;
      });
    },
    [persist, livePush],
  );

  const toggleRival = useCallback(
    (key: string) => {
      setSettings((prev) => {
        const has = prev.sports.rivals.includes(key);
        const rivals = has
          ? prev.sports.rivals.filter((r) => r !== key)
          : [...prev.sports.rivals, key];
        const next = { ...prev, sports: { ...prev.sports, rivals } };
        persist(next);
        livePush("sports", {
          enabled: next.sports.enabled,
          ufc: next.sports.ufc,
          teams: next.sports.teams.map((t) => `${t.league}:${t.abbr}`),
          rivals,
        });
        return next;
      });
    },
    [persist, livePush],
  );

  // Toggle a team into the Summary favorites (max 2). favorites[0] leads the
  // main Sports glance; favorites[1] shows as a second mini score row.
  const toggleFavorite = useCallback(
    (key: string) => {
      setSettings((prev) => {
        const cur = prev.sports.favorites;
        let favorites: string[];
        if (cur.includes(key)) favorites = cur.filter((k) => k !== key);
        else if (cur.length === 0) favorites = [key];
        else if (cur.length === 1) favorites = [cur[0], key];
        else favorites = [cur[0], key]; // replace the second slot
        const next = { ...prev, sports: { ...prev.sports, favorites } };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateBrightness = useCallback(
    (value: number) => {
      setSettings((prev) => {
        const next = { ...prev, brightness: value };
        persist(next);
        livePush("brightness", { value });
        return next;
      });
    },
    [persist, livePush],
  );

  const updateHolidayThemes = useCallback(
    (value: boolean) => {
      setSettings((prev) => {
        const next = { ...prev, holidayThemes: value };
        persist(next);
        livePush("holiday", { enabled: value });
        return next;
      });
    },
    [persist, livePush],
  );

  const updateNightMode = useCallback(
    (patch: Partial<Omit<Settings["nightMode"], "weekend">>) => {
      setSettings((prev) => {
        const next = { ...prev, nightMode: { ...prev.nightMode, ...patch } };
        persist(next);
        livePush("night", buildNightPayload(next.nightMode));
        return next;
      });
    },
    [persist, livePush],
  );

  const updateWeekend = useCallback(
    (patch: Partial<Settings["nightMode"]["weekend"]>) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          nightMode: {
            ...prev.nightMode,
            weekend: { ...prev.nightMode.weekend, ...patch },
          },
        };
        persist(next);
        livePush("night", buildNightPayload(next.nightMode));
        return next;
      });
    },
    [persist, livePush],
  );

  // ---- BLE actions ----------------------------------------------------------
  const connect = useCallback(async () => {
    const info = await connectToMatrix(
      (s) => setBleStatus(s),
      () => {
        setBleStatus("disconnected");
        setDeviceName(null);
        setRssi(null);
        setWifiStatus("idle");
      },
    );
    setDeviceName(info.name);
    setRssi(info.rssi);
    // Listen for async status pushes (Wi-Fi join result).
    monitorMatrix((obj) => {
      if (obj?.wifiStatus === "connected") {
        setWifiStatus("joined");
        setWifiIp(obj.ip ?? null);
      } else if (obj?.wifiStatus === "failed") {
        setWifiStatus("failed");
      }
    });
    // Auto-push the full config so a freshly connected matrix is in sync.
    syncSettings(buildFullPayload(settingsRef.current)).catch(() => {});
    return { name: info.name };
  }, []);

  const disconnect = useCallback(async () => {
    await bleDisconnect();
    setBleStatus("disconnected");
    setDeviceName(null);
    setRssi(null);
    setWifiStatus("idle");
  }, []);

  const syncAll = useCallback(async () => {
    const res = await syncSettings(buildFullPayload(settingsRef.current));
    return { confirmed: res.confirmed };
  }, []);

  const sendWifi = useCallback(async (ssid: string, pass: string) => {
    setLastSsid(ssid);
    storage.setItem("aura_last_ssid", ssid);
    setWifiStatus("sending");
    setWifiIp(null);
    await writeLive({ command: "wifi", ssid, pass });
    setWifiStatus("waiting");
  }, []);

  const flashTest = useCallback(async () => {
    await bleFlashTest();
  }, []);

  const weatherTest = useCallback(async () => {
    await writeLive({ command: "weather_test", ts: Date.now() });
  }, []);

  // ---- RSSI refresh while connected ----------------------------------------
  useEffect(() => {
    if (bleStatus !== "connected") return;
    const id = setInterval(async () => {
      const r = await readRssi();
      if (r != null) setRssi(r);
    }, 5000);
    return () => clearInterval(id);
  }, [bleStatus]);

  const value: MatrixContextValue = {
    settings,
    hydrated,
    bleStatus,
    deviceName,
    rssi,
    bleSupported,
    wifiStatus,
    wifiIp,
    lastSsid,
    updateFlights,
    updateSports,
    updateWeather,
    updateQuietHours,
    updateSecondLocation,
    toggleTeam,
    reorderTeams,
    toggleRival,
    toggleFavorite,
    updateBrightness,
    updateHolidayThemes,
    updateNightMode,
    updateWeekend,
    connect,
    disconnect,
    syncAll,
    sendWifi,
    flashTest,
    weatherTest,
  };

  return (
    <MatrixContext.Provider value={value}>{children}</MatrixContext.Provider>
  );
}

export { BleError };

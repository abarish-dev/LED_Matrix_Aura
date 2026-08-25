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
  };
  sports: { enabled: boolean; teams: SavedTeam[]; ufc: boolean };
  weather: { enabled: boolean; severity: Severity };
  brightness: number; // 0-100 matrix brightness
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
  },
  sports: { enabled: true, teams: [], ufc: false },
  weather: { enabled: true, severity: "severe" },
  brightness: 80,
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
  toggleTeam: (team: SavedTeam) => void;
  reorderTeams: (teams: SavedTeam[]) => void;
  updateBrightness: (value: number) => void;

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
    },
    sports: {
      enabled: s.sports.enabled,
      ufc: s.sports.ufc,
      teams: s.sports.teams.map((t) => `${t.league}:${t.abbr}`),
    },
    weather: {
      enabled: s.weather.enabled,
      severity: s.weather.severity,
    },
    brightness: s.brightness,
    syncedAt: Date.now(),
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
        setSettings({
          flights: { ...DEFAULT_SETTINGS.flights, ...(saved.flights ?? {}) },
          sports: { ...DEFAULT_SETTINGS.sports, ...(saved.sports ?? {}) },
          weather: { ...DEFAULT_SETTINGS.weather, ...(saved.weather ?? {}) },
          brightness:
            typeof saved.brightness === "number"
              ? saved.brightness
              : DEFAULT_SETTINGS.brightness,
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
        });
        return next;
      });
    },
    [persist, livePush],
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
        const next = { ...prev, sports: { ...prev.sports, teams } };
        persist(next);
        livePush("sports", {
          enabled: next.sports.enabled,
          ufc: next.sports.ufc,
          teams: teams.map((t) => `${t.league}:${t.abbr}`),
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
        });
        return next;
      });
    },
    [persist, livePush],
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
    toggleTeam,
    reorderTeams,
    updateBrightness,
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

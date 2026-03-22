/**
 * store.ts — JSON state management, usage tracking, atomic writes
 */

export interface Child {
  id: string;
  name: string;
  pin: string;
  daily_limit_seconds: number;
}

export interface PlaybackState {
  file: string;     // relative path from music root, e.g. "Hoerbucher/Folge1/track.mp3"
  position: number; // seconds (rounded to nearest second)
  folder: string;   // folder portion, e.g. "Hoerbucher/Folge1"
}

export interface AppData {
  site_token: string;
  parent_pin: string;
  daily_limit_seconds: number;
  music_dir: string;
  timezone: string;
  session_secret: string;
  children: Child[];
  usage: Record<string, Record<string, number>>;
  playback?: Record<string, PlaybackState>;
}

let dataPath = "";
let data: AppData | null = null;

function randomToken(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

function randomPin(len = 6): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => String(b % 10)).join("");
}

export async function loadStore(path: string): Promise<AppData> {
  dataPath = path;
  try {
    const raw = await Deno.readTextFile(path);
    data = JSON.parse(raw) as AppData;
    if (!data.session_secret) {
      data.session_secret = randomToken(32);
      await saveStore();
    }
    return data;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      const siteToken = randomToken(8);
      const parentPin = randomPin(4);
      data = {
        site_token: siteToken,
        parent_pin: parentPin,
        daily_limit_seconds: 3600,
        music_dir: "/data/music",
        timezone: "Europe/Zurich",
        session_secret: randomToken(32),
        children: [],
        usage: {},
      };
      await saveStore();
      console.log("=== BOOTSTRAPPED NEW DATA FILE ===");
      console.log(`Site token: ${siteToken}`);
      console.log(`Parent PIN: ${parentPin}`);
      console.log("==================================");
      return data;
    }
    throw e;
  }
}

export async function saveStore(): Promise<void> {
  if (!data || !dataPath) throw new Error("Store not initialized");
  const tmpPath = dataPath + ".tmp";
  await Deno.writeTextFile(tmpPath, JSON.stringify(data, null, 2));
  await Deno.rename(tmpPath, dataPath);
}

export function getData(): AppData {
  if (!data) throw new Error("Store not initialized");
  return data;
}

export function getChild(id: string): Child | undefined {
  return data?.children.find((c) => c.id === id);
}

export function getChildByPin(pin: string): Child | undefined {
  return data?.children.find((c) => c.pin === pin);
}

export function getTodayKey(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function getUsageToday(childId: string): number {
  if (!data) return 0;
  const today = getTodayKey(data.timezone);
  return data.usage[childId]?.[today] ?? 0;
}

export function getDailyLimit(childId: string): number {
  if (!data) return 0;
  const child = getChild(childId);
  return child?.daily_limit_seconds ?? data.daily_limit_seconds;
}

export function getRemainingSeconds(childId: string): number {
  const used = getUsageToday(childId);
  const limit = getDailyLimit(childId);
  return Math.max(0, limit - used);
}

export function addUsage(childId: string, seconds: number): void {
  if (!data) return;
  const today = getTodayKey(data.timezone);
  if (!data.usage[childId]) data.usage[childId] = {};
  data.usage[childId][today] = (data.usage[childId][today] ?? 0) + seconds;
}

export function setUsage(childId: string, seconds: number): void {
  if (!data) return;
  const today = getTodayKey(data.timezone);
  if (!data.usage[childId]) data.usage[childId] = {};
  data.usage[childId][today] = seconds;
}

export function resetUsageToday(childId: string): void {
  if (!data) return;
  const today = getTodayKey(data.timezone);
  if (!data.usage[childId]) data.usage[childId] = {};
  data.usage[childId][today] = 0;
}

export function getUsageWeek(childId: string): Record<string, number> {
  if (!data) return {};
  const result: Record<string, number> = {};
  const tz = data.timezone;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    result[key] = data.usage[childId]?.[key] ?? 0;
  }
  return result;
}

export function getPlayback(childId: string): PlaybackState | null {
  return data?.playback?.[childId] ?? null;
}

export function setPlayback(childId: string, state: PlaybackState): void {
  if (!data) return;
  if (!data.playback) data.playback = {};
  data.playback[childId] = state;
}

/** Returns Unix ms for next midnight in the configured timezone */
export function getNextMidnightMs(timezone: string): number {
  const today = getTodayKey(timezone);
  const [y, m, d] = today.split("-").map(Number);
  // Search near UTC midnight of tomorrow for exact local midnight
  const approx = Date.UTC(y, m - 1, d + 1); // UTC 00:00 of tomorrow
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // Scan ±14h in 1-minute steps around the approximation
  for (let deltaMs = -14 * 3600_000; deltaMs <= 14 * 3600_000; deltaMs += 60_000) {
    const candidate = approx + deltaMs;
    const parts = fmt.formatToParts(new Date(candidate));
    const hh = parts.find((p) => p.type === "hour")?.value;
    const mm = parts.find((p) => p.type === "minute")?.value;
    const ss = parts.find((p) => p.type === "second")?.value;
    if (hh === "00" && mm === "00" && ss === "00") return candidate;
  }
  return approx; // fallback
}

export function addChild(child: Child): void {
  if (!data) return;
  const existing = data.children.findIndex((c) => c.id === child.id);
  if (existing >= 0) {
    data.children[existing] = child;
  } else {
    data.children.push(child);
  }
}

export function removeChild(id: string): boolean {
  if (!data) return false;
  const before = data.children.length;
  data.children = data.children.filter((c) => c.id !== id);
  return data.children.length < before;
}

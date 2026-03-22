/**
 * auth.ts — Site token middleware, PIN auth, HMAC session cookies
 */

import { getData, getChild, getChildByPin } from "./store.ts";

const CHILD_COOKIE = "lp_session";
const ADMIN_COOKIE = "lp_admin";

export interface SessionPayload {
  child_id: string;
  issued_at: number;
}

// Derive HMAC key from session_secret string
async function getHMACKey(): Promise<CryptoKey> {
  const secret = getData().session_secret;
  const keyData = new TextEncoder().encode(secret);
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payload: object): Promise<string> {
  const key = await getHMACKey();
  const data = JSON.stringify(payload);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const dataB64 = btoa(data);
  return `${dataB64}.${sigB64}`;
}

async function verifyPayload<T>(token: string): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [dataB64, sigB64] = parts;
  try {
    const data = atob(dataB64);
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const key = await getHMACKey();
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
  }
  return cookies;
}

function cookieExpiry(timezone: string): string {
  // Set cookie to expire at next local midnight
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  const [y, m, d] = today.split("-").map(Number);
  // Tomorrow midnight UTC - we want it to expire around local midnight
  // Use a simple approach: expire in (seconds until midnight + buffer)
  const tomorrowUTC = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0)); // noon UTC next day (safe for all TZ)
  return tomorrowUTC.toUTCString();
}

export async function createChildSession(childId: string, timezone: string): Promise<string> {
  const payload: SessionPayload = { child_id: childId, issued_at: Date.now() };
  const token = await signPayload(payload);
  const expires = cookieExpiry(timezone);
  return `${CHILD_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Expires=${expires}`;
}

export async function getChildSession(req: Request): Promise<SessionPayload | null> {
  const cookies = parseCookies(req);
  const token = cookies[CHILD_COOKIE];
  if (!token) return null;
  const payload = await verifyPayload<SessionPayload>(token);
  if (!payload) return null;
  // Verify child still exists
  const child = getChild(payload.child_id);
  if (!child) return null;
  return payload;
}

export async function createAdminSession(timezone: string): Promise<string> {
  const payload = { admin: true, issued_at: Date.now() };
  const token = await signPayload(payload);
  const expires = cookieExpiry(timezone);
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Expires=${expires}`;
}

export async function getAdminSession(req: Request): Promise<boolean> {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE];
  if (!token) return false;
  const payload = await verifyPayload<{ admin: boolean }>(token);
  return payload?.admin === true;
}

export function clearChildSession(): string {
  return `${CHILD_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function clearAdminSession(): string {
  return `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function checkSiteToken(req: Request): boolean {
  const url = new URL(req.url);
  const s = url.searchParams.get("s");
  return s === getData().site_token;
}

export function validateChildPin(pin: string): string | null {
  const child = getChildByPin(pin);
  return child ? child.id : null;
}

export function validateParentPin(pin: string): boolean {
  return pin === getData().parent_pin;
}

export function sanitizeFilename(name: string): string | null {
  if (name.includes("..") || name.includes("\\")) return null;
  // Each segment must be safe
  const segments = name.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return null;
  }
  // Last segment must be a valid audio file
  const last = segments[segments.length - 1];
  if (!/\.(mp3|flac)$/i.test(last)) return null;
  return name;
}

export function sanitizeDirPath(relPath: string): string | null {
  if (relPath.includes("..") || relPath.includes("\\")) return null;
  const segments = relPath.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg === "." || seg === "..") return null;
  }
  return segments.join("/");
}

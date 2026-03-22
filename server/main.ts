/**
 * main.ts — Deno HTTP server, router, startup scan
 */

import { loadStore, getData, getRemainingSeconds, getDailyLimit, getUsageToday, getTodayKey, getPlayback, setPlayback, getNextMidnightMs, saveStore } from "./store.ts";
import { scanDirectory, parseMeta, listDirectory } from "./meta.ts";
import {
  checkSiteToken,
  getChildSession,
  getAdminSession,
  createChildSession,
  createAdminSession,
  clearChildSession,
  clearAdminSession,
  validateChildPin,
  validateParentPin,
  sanitizeFilename,
  sanitizeDirPath,
} from "./auth.ts";
import { streamAudio } from "./stream.ts";
import { setPauseState } from "./stream.ts";
import {
  handleAdminStats,
  handleCreateChild,
  handleDeleteChild,
  handleResetQuota,
} from "./admin.ts";

const DATA_PATH = Deno.env.get("DATA_PATH") || "./data.json";
const PORT = parseInt(Deno.env.get("PORT") || "8080");
const PUBLIC_DIR = Deno.env.get("PUBLIC_DIR") || "./public";

// Serve a static file from PUBLIC_DIR
async function serveStatic(path: string): Promise<Response> {
  const filePath = `${PUBLIC_DIR}/${path}`;
  try {
    const content = await Deno.readFile(filePath);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mimes: Record<string, string> = {
      html: "text/html; charset=utf-8",
      js: "application/javascript",
      json: "application/json",
      css: "text/css",
      png: "image/png",
      ico: "image/x-icon",
    };
    return new Response(content, {
      headers: { "Content-Type": mimes[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function requireSiteToken(req: Request): Response | null {
  if (!checkSiteToken(req)) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ── Static: child app shell ────────────────────────────────
  if (method === "GET" && path === "/") {
    const err = requireSiteToken(req);
    if (err) return err;
    return serveStatic("index.html");
  }

  // ── Static: admin shell ────────────────────────────────────
  if (method === "GET" && path === "/admin") {
    const err = requireSiteToken(req);
    if (err) return err;
    return serveStatic("admin.html");
  }

  // ── Manifest: inject real site token into start_url ───────
  if (method === "GET" && path === "/manifest.json") {
    const raw = await Deno.readTextFile(`${PUBLIC_DIR}/manifest.json`);
    const siteToken = getData().site_token;
    const patched = raw.replace("REPLACE_WITH_SITE_TOKEN", siteToken);
    return new Response(patched, { headers: { "Content-Type": "application/json" } });
  }

  // ── Static files ───────────────────────────────────────────
  if (method === "GET" && (path.startsWith("/sw.js") || path.startsWith("/icons"))) {
    return serveStatic(path.slice(1));
  }

  // ── API: session check ─────────────────────────────────────
  if (method === "GET" && path === "/api/session") {
    const session = await getChildSession(req);
    if (!session) return json({ authenticated: false }, 401);
    const data = getData();
    const child = data.children.find((c) => c.id === session.child_id);
    if (!child) return json({ authenticated: false }, 401);
    const used = getUsageToday(child.id);
    const limit = getDailyLimit(child.id);
    const remaining = Math.max(0, limit - used);
    const today = getTodayKey(data.timezone);
    const resetAtMs = getNextMidnightMs(data.timezone);
    const playback = getPlayback(child.id);
    return json({
      authenticated: true,
      child_id: child.id,
      name: child.name,
      quota: { used, limit, remaining, reset_at: today, reset_at_ms: resetAtMs },
      playback,
    });
  }

  // ── API: login ─────────────────────────────────────────────
  if (method === "POST" && path === "/api/login") {
    let body: { pin?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const childId = validateChildPin(String(body.pin ?? ""));
    if (!childId) {
      return json({ error: "Invalid PIN" }, 401);
    }
    const data = getData();
    const child = data.children.find((c) => c.id === childId)!;
    const cookieHeader = await createChildSession(childId, data.timezone);
    return json({ ok: true, name: child.name }, 200, { "Set-Cookie": cookieHeader });
  }

  // ── API: logout ────────────────────────────────────────────
  if (method === "POST" && path === "/api/logout") {
    return json({ ok: true }, 200, { "Set-Cookie": clearChildSession() });
  }

  // ── API: files list (with optional ?path= for subfolder) ──
  if (method === "GET" && path === "/api/files") {
    const session = await getChildSession(req);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const data = getData();
    const rawRelPath = url.searchParams.get("path") ?? "";
    const relPath = sanitizeDirPath(rawRelPath);
    if (relPath === null) return json({ error: "Invalid path" }, 400);
    const entries = await listDirectory(data.music_dir, relPath);
    return json({ path: relPath, entries });
  }

  // ── API: quota ─────────────────────────────────────────────
  if (method === "GET" && path === "/api/quota") {
    const session = await getChildSession(req);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const data = getData();
    const childId = session.child_id;
    const used = getUsageToday(childId);
    const limit = getDailyLimit(childId);
    const remaining = Math.max(0, limit - used);
    const today = getTodayKey(data.timezone);
    const resetAtMs = getNextMidnightMs(data.timezone);
    return json({ used, limit, remaining, reset_at: today, reset_at_ms: resetAtMs });
  }

  // ── API: save playback position ────────────────────────────
  if (method === "POST" && path === "/api/playback") {
    const session = await getChildSession(req);
    if (!session) return json({ error: "Unauthorized" }, 401);
    let body: { file?: string; position_seconds?: number; folder?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const file = String(body.file ?? "");
    const position = Math.max(0, Math.round(Number(body.position_seconds ?? 0)));
    const folder = String(body.folder ?? "");
    if (!file) return json({ error: "file required" }, 400);
    setPlayback(session.child_id, { file, position, folder });
    // Piggyback save onto the existing 5s flush cycle — don't save to disk here
    // (stream.ts flushes every 5s; for pure UI events, we save immediately)
    try { await saveStore(); } catch { /* non-fatal */ }
    return json({ ok: true });
  }

  // ── API: events (play/pause/stop) ──────────────────────────
  if (method === "POST" && path === "/api/event") {
    const session = await getChildSession(req);
    if (!session) return json({ error: "Unauthorized" }, 401);
    let body: { type?: string; file?: string; position_seconds?: number };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const { type } = body;
    if (type === "pause") {
      setPauseState(session.child_id, true);
    } else if (type === "play") {
      setPauseState(session.child_id, false);
    } else if (type === "stop") {
      setPauseState(session.child_id, true);
    }
    return json({ ok: true });
  }

  // ── Stream audio ───────────────────────────────────────────
  if (method === "GET" && path.startsWith("/stream/")) {
    const session = await getChildSession(req);
    if (!session) return new Response("Unauthorized", { status: 401 });

    // relative path may include subfolder segments: /stream/folder/subfolder/file.mp3
    const rawRelPath = decodeURIComponent(path.slice("/stream/".length));
    const relPath = sanitizeFilename(rawRelPath);
    if (!relPath) return new Response("Invalid filename", { status: 400 });

    const data = getData();
    const filePath = `${data.music_dir}/${relPath}`;
    const filename = relPath.split("/").pop()!;

    // Ensure metadata is loaded
    try {
      await parseMeta(filePath, filename);
    } catch {
      return new Response("File not found", { status: 404 });
    }

    return streamAudio(req, session.child_id, filePath, filename);
  }

  // ── Admin: login ───────────────────────────────────────────
  if (method === "POST" && path === "/admin/login") {
    let body: { pin?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!validateParentPin(String(body.pin ?? ""))) {
      return json({ error: "Invalid PIN" }, 401);
    }
    const data = getData();
    const cookieHeader = await createAdminSession(data.timezone);
    return json({ ok: true }, 200, { "Set-Cookie": cookieHeader });
  }

  // ── Admin: logout ──────────────────────────────────────────
  if (method === "POST" && path === "/admin/logout") {
    return json({ ok: true }, 200, { "Set-Cookie": clearAdminSession() });
  }

  // ── Admin: stats ───────────────────────────────────────────
  if (method === "GET" && path === "/admin/api/stats") {
    if (!(await getAdminSession(req))) return json({ error: "Unauthorized" }, 401);
    return handleAdminStats();
  }

  // ── Admin: create/update child ─────────────────────────────
  if (method === "POST" && path === "/admin/api/child") {
    if (!(await getAdminSession(req))) return json({ error: "Unauthorized" }, 401);
    return handleCreateChild(req);
  }

  // ── Admin: delete child ────────────────────────────────────
  if (method === "DELETE" && path.startsWith("/admin/api/child/")) {
    if (!(await getAdminSession(req))) return json({ error: "Unauthorized" }, 401);
    const id = path.slice("/admin/api/child/".length);
    return handleDeleteChild(id);
  }

  // ── Admin: reset quota ─────────────────────────────────────
  if (method === "GET" && path.startsWith("/admin/api/reset/")) {
    if (!(await getAdminSession(req))) return json({ error: "Unauthorized" }, 401);
    const id = path.slice("/admin/api/reset/".length);
    return handleResetQuota(id);
  }

  return new Response("Not Found", { status: 404 });
}

// Startup
await loadStore(DATA_PATH);
const data = getData();
console.log(`Scanning music directory: ${data.music_dir}`);
const tracks = await scanDirectory(data.music_dir);
console.log(`Found ${tracks.length} tracks`);
for (const t of tracks) {
  console.log(`  ${t.filename} — ${t.duration_seconds}s @ ${Math.round(t.bitrate_bps / 1000)}kbps`);
}

console.log(`Starting server on port ${PORT}`);
Deno.serve({ port: PORT }, handler);

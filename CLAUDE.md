# lil-play

A self-hosted audio streaming server designed to give children on iPhone controlled access to audiobooks and music. Parents set a daily listening quota (in seconds); the server enforces it server-side and streams audio directly to the iOS native player via HTTP range requests. The app is a PWA installable on the home screen.

## Running locally

```sh
deno task start
```

Then open: `http://localhost:8080/?s=<site_token>`

The site token is required on every page load — it gates access to the app shell itself.

## First-run bootstrap

If `data.json` (or `$DATA_PATH`) does not exist on startup, the server creates it with a random `site_token` and `parent_pin` and prints them to stdout:

```
=== BOOTSTRAPPED NEW DATA FILE ===
Site token: abc12345
Parent PIN: 7391
==================================
```

Save these. The site token goes in every URL you bookmark; the parent PIN unlocks the admin panel.

## Project structure

```
server/
  main.ts       — HTTP router, startup scan
  store.ts      — JSON state, usage tracking, atomic writes
  auth.ts       — Site token, PIN auth, HMAC session cookies
  stream.ts     — Range-aware audio streaming, quota deduction
  meta.ts       — Audio metadata scanning (mp3/flac)
  admin.ts      — Admin API handlers (stats, create/delete child, reset quota)
tests/
  store.test.ts
  auth.test.ts
  stream.test.ts
  meta.test.ts
  api.test.ts   — Integration tests (spawns real server)
  e2e/          — Playwright end-to-end tests
fixtures/
  data.test.json   — Dummy credentials used by tests (safe to commit)
  test.mp3 / test.flac
public/           — Static frontend (PWA shell, admin UI)
data/             — Runtime volume mount (NOT committed — contains real data.json)
```

## Key architecture decisions

**Server closes the stream, not client JS.**
iOS suspends background tabs, so JavaScript timers are unreliable for enforcing quotas. The server tracks bytes served, converts to seconds via bitrate, and simply stops sending data when the quota is exhausted. The stream `Content-Length` is clamped to the quota-allowed byte count so the native player receives a clean EOF.

**Atomic writes for data.json.**
`store.ts` writes to `data.json.tmp` then renames it over `data.json`. This prevents a corrupt file if the process is killed mid-write. Never write `data.json` directly; always go through `saveStore()`.

**HMAC session cookies (stateless).**
Sessions are signed JSON payloads (`base64(payload).base64(hmac-sha256)`) stored in `HttpOnly` cookies. No session store — the server can restart without invalidating sessions. The signing key is `session_secret` in `data.json`. Child sessions expire at next local midnight (timezone-aware); admin sessions do too.

**Subfolder support in `music_dir`.**
`listDirectory(music_dir, relPath)` returns both files and subdirectories. The client navigates into folders via `GET /api/files?path=Subfolder/Nested`. Streaming uses `GET /stream/Subfolder/Nested/file.mp3`. Path sanitization (`sanitizeFilename`, `sanitizeDirPath` in `auth.ts`) blocks `..` traversal and backslashes; every path segment is validated, and only `.mp3`/`.flac` extensions are allowed for stream requests.

**Timezone-aware "today" key.**
Usage is keyed by date string (`"2026-03-22"`) computed in `data.timezone` (e.g. `"Europe/Zurich"`), not server TZ. `getTodayKey(timezone)` uses `Intl.DateTimeFormat` so the quota resets at local midnight regardless of where the server runs.

## Running tests

```sh
# Unit + integration (Deno only, fast)
deno task test

# All including api.test.ts (spawns a real server subprocess)
deno task test:all

# End-to-end (requires Playwright install: npm install)
npx playwright test
```

## data.json format

```jsonc
{
  "site_token": "abc12345",        // required in every URL: /?s=abc12345
  "parent_pin": "7391",            // 4-digit PIN for admin panel
  "daily_limit_seconds": 3600,     // default quota (1 hour); per-child overrides this
  "music_dir": "/data/music",      // path to audio files (supports subfolders)
  "timezone": "Europe/Zurich",     // IANA tz string; controls quota reset time
  "session_secret": "...",         // 32-char random string; rotate to invalidate all sessions
  "children": [
    {
      "id": "child_1",             // stable identifier; used as usage key
      "name": "Emma",              // displayed in the UI
      "pin": "1234",               // 4-digit login PIN
      "daily_limit_seconds": 3600  // optional per-child override
    }
  ],
  "usage": {
    "child_1": {
      "2026-03-22": 1234.5         // seconds listened today (float, accumulated from bytes)
    }
  },
  "playback": {
    "child_1": {
      "file": "Hoerbucher/Folge1/track.mp3",  // relative path from music_dir
      "position": 312,                          // seconds (integer)
      "folder": "Hoerbucher/Folge1"            // folder portion for UI navigation
    }
  }
}
```

## Deployment

```sh
docker compose up -d
```

The `docker-compose.yml` mounts `./data` into the container at `/data`. The server reads/writes `/data/data.json`.

**What to back up:** only `./data/data.json`. It contains all state: credentials, children, usage history, playback positions.

**Environment variables** (all optional, have defaults):
- `DATA_PATH` — path to data file (default: `./data.json`)
- `PORT` — listen port (default: `8080`)
- `PUBLIC_DIR` — path to static files (default: `./public`)

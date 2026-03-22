# lil-play

A self-hosted web audio player (MP3/FLAC) with server-enforced daily listening time limits. Designed for family use — give children a PIN and they get a fixed daily quota of listening time, enforced by the server, not the browser.

Built with Deno, Alpine.js, and Pico CSS. Deploys as a single Docker container. Works as an iOS PWA.

---

## Quick Start (Docker)

```bash
git clone https://github.com/felixbade/lil-play
cd lil-play
mkdir -p data/music
docker compose up -d
```

On first run, the server bootstraps a new `data.json` and prints the site token and parent PIN to the logs:

```
=== BOOTSTRAPPED NEW DATA FILE ===
Site token: ab3f9x2q
Parent PIN: 4821
==================================
```

Access the player at:

```
http://your-server:8080/?s=ab3f9x2q
```

Access the admin dashboard at:

```
http://your-server:8080/admin?s=ab3f9x2q
```

---

## First-Run Setup

1. Start the server — it creates `data/data.json` automatically.
2. Note the **site token** from the logs — share this URL with your children.
3. Note the **parent PIN** — use this to access the admin dashboard.
4. In the admin dashboard, add children with their PINs and daily limits.
5. Put your music files in `data/music/` (supports subfolders).

---

## How It Works

### Time Limiting

Instead of relying on JavaScript timers (which iOS suspends in background), lil-play streams audio **throttled to real-time playback speed**. The server controls the clock:

- 1 minute of music takes 1 minute to stream
- When the daily quota is hit, the server closes the connection
- No bytes sent = no time charged (pausing is free)

### Site Token

Access requires a site token in the URL (`?s=TOKEN`). This token is printed on first run and stored in `data.json`. Share the full URL (with token) and add it to the iOS home screen — the token is baked into the launch URL.

### Child PINs

Each child has a 4–6 digit PIN. On the player screen, they enter their PIN to log in and access their personal quota and music.

### Admin Dashboard

The parent PIN unlocks the admin dashboard at `/admin?s=TOKEN`. From there you can:
- See each child's usage today and a 7-day chart
- Reset any child's daily quota
- Add, edit, or delete children

---

## data.json Format

The data file is created automatically on first run. You can edit it directly if needed:

```json
{
  "site_token": "ab3f9x2q",
  "parent_pin": "4821",
  "daily_limit_seconds": 3600,
  "music_dir": "/data/music",
  "timezone": "Europe/Zurich",
  "session_secret": "...(auto-generated)...",
  "children": [
    {
      "id": "child_emma",
      "name": "Emma",
      "pin": "1234",
      "daily_limit_seconds": 3600
    },
    {
      "id": "child_max",
      "name": "Max",
      "pin": "5678",
      "daily_limit_seconds": 5400
    }
  ],
  "usage": {
    "child_emma": {
      "2026-03-22": 1823
    }
  },
  "playback": {
    "child_emma": {
      "file": "Hoerbucher/Folge1/track01.mp3",
      "position": 142,
      "folder": "Hoerbucher/Folge1"
    }
  }
}
```

Fields:
- `site_token` — URL token for accessing the player
- `parent_pin` — PIN for admin dashboard
- `daily_limit_seconds` — default daily limit for children without an individual limit
- `music_dir` — path to the music directory (inside the container: `/data/music`)
- `timezone` — IANA timezone for quota resets (e.g. `"Europe/Zurich"`, `"America/New_York"`)
- `session_secret` — auto-generated secret for signing session cookies
- `children` — array of child accounts
- `usage` — daily usage records per child (managed automatically)
- `playback` — last playback position per child (managed automatically)

---

## Music Directory Structure

lil-play supports subfolders. All audio files (MP3 and FLAC) anywhere under `music_dir` are accessible. The player shows a folder browser with breadcrumb navigation.

```
music/
├── Audiobooks/
│   ├── Story1/
│   │   ├── chapter01.mp3
│   │   └── chapter02.mp3
│   └── Story2/
│       └── story.flac
├── Songs/
│   ├── song1.mp3
│   └── song2.mp3
└── top-level-track.mp3
```

Metadata (title, duration, bitrate) is scanned from ID3/FLAC tags on startup and cached in memory.

---

## Features

- Server-enforced daily time limits (not breakable via browser DevTools)
- MP3 and FLAC support with metadata parsing
- Subfolder navigation with breadcrumbs
- Play folder (plays all files in current folder in order)
- Playback position saved every 5 seconds and on pause — resumes where you left off
- iOS PWA — add to home screen, works offline shell
- Animated "Time's Up" screen with countdown to midnight reset
- Admin dashboard with 7-day usage charts
- Daily quota resets at midnight in the configured timezone

---

## Development Setup

Requirements: [Deno](https://deno.com) 2.x

```bash
# Run the server locally
DATA_PATH=./data.json PORT=8080 PUBLIC_DIR=./public deno task start

# Or use the task shorthand
deno task start
```

---

## Running Tests

### Unit and integration tests (Deno)

```bash
# Unit tests only (fast, no server needed)
deno task test

# API integration tests (starts a real server subprocess)
deno task test:api

# All tests
deno task test:all
```

### End-to-end tests (Playwright)

```bash
# Install dependencies first (one-time)
npm install
npx playwright install chromium

# Run e2e tests
deno task test:e2e
# or
npx playwright test
```

Playwright starts the server automatically on port 18082 using the test fixture data.

### Docker test service

```bash
docker compose --profile test run test
```

---

## Deployment Notes

### docker-compose.yml (production)

```yaml
services:
  lil-play:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data        # data.json and music/ live here
    environment:
      - DATA_PATH=/data/data.json
      - PORT=8080
    restart: unless-stopped
```

Put music files in `./data/music/` locally — they map to `/data/music` inside the container, which is the default `music_dir`.

### HTTPS / Reverse Proxy

iOS PWA requires HTTPS. Put lil-play behind nginx or Caddy:

```
# Caddy example
music.example.com {
    reverse_proxy localhost:8080
}
```

### iOS Home Screen

1. Open `https://music.example.com/?s=YOUR_TOKEN` in Safari
2. Tap Share → Add to Home Screen
3. The token is baked into the launch URL — no re-entry needed

### Backup

The entire state is in one file: `data/data.json`. Back it up regularly. Usage history and playback positions are stored there.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATA_PATH` | `./data.json` | Path to the data file |
| `PORT` | `8080` | HTTP port to listen on |
| `PUBLIC_DIR` | `./public` | Path to static HTML/JS files |

---

## Project Structure

```
lil-play/
├── server/
│   ├── main.ts        — HTTP router, startup
│   ├── store.ts       — JSON state management, quota tracking
│   ├── auth.ts        — session cookies, PIN validation
│   ├── stream.ts      — throttled audio streaming
│   ├── meta.ts        — MP3/FLAC metadata parsing
│   └── admin.ts       — admin API handlers
├── public/
│   ├── index.html     — player PWA (Alpine.js)
│   ├── admin.html     — admin dashboard (Alpine.js)
│   └── manifest.json  — PWA manifest
├── tests/
│   ├── store.test.ts  — store unit tests
│   ├── auth.test.ts   — auth unit tests
│   ├── meta.test.ts   — metadata parsing tests
│   ├── stream.test.ts — streaming tests
│   ├── api.test.ts    — HTTP integration tests
│   └── e2e/
│       ├── player.spec.ts — Playwright player tests
│       └── admin.spec.ts  — Playwright admin tests
├── fixtures/
│   ├── data.test.json — test fixture data
│   ├── test.mp3       — test audio file
│   └── test.flac      — test audio file
├── deno.json          — tasks and import map
├── docker-compose.yml
├── Dockerfile
└── playwright.config.ts
```

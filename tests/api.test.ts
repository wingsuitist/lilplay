/**
 * Integration tests — spin up a real server subprocess with test config
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

const BASE = "http://localhost:18080";
const SITE_TOKEN = "testtoken";

// Use a temp copy of the test data so we don't corrupt the fixture file
const API_TEST_DATA_PATH = "./fixtures/data.api-test.json";
await Deno.copyFile("./fixtures/data.test.json", API_TEST_DATA_PATH);

// Start server once at module level
const serverProc = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "server/main.ts",
  ],
  env: {
    DATA_PATH: API_TEST_DATA_PATH,
    PORT: "18080",
    PUBLIC_DIR: "./public",
  },
  stdout: "piped",
  stderr: "piped",
}).spawn();

// Wait for startup
await new Promise((r) => setTimeout(r, 800));

// Register cleanup
addEventListener("unload", () => {
  try {
    serverProc.kill();
  } catch {
    // ignore
  }
  try {
    Deno.removeSync(API_TEST_DATA_PATH);
  } catch {
    // ignore
  }
});

// Helper to extract set-cookie header
function extractCookie(res: Response, name: string): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : "";
}

Deno.test({
  name: "GET / without site token → 403",
  async fn() {
    const res = await fetch(`${BASE}/`);
    assertEquals(res.status, 403);
    await res.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET / with site token → 200",
  async fn() {
    const res = await fetch(`${BASE}/?s=${SITE_TOKEN}`);
    assertEquals(res.status, 200);
    const text = await res.text();
    assertStringIncludes(text, "Music Player");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /api/session without cookie → 401",
  async fn() {
    const res = await fetch(`${BASE}/api/session`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /api/login with wrong PIN → 401",
  async fn() {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "9876" }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /api/login with valid PIN → 200 + cookie",
  async fn() {
    const res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.name, "Test");
    const cookie = res.headers.get("set-cookie");
    assertStringIncludes(cookie ?? "", "lp_session");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /api/session after login → authenticated",
  async fn() {
    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    const cookie = extractCookie(loginRes, "lp_session");
    await loginRes.body?.cancel();

    const sessionRes = await fetch(`${BASE}/api/session`, {
      headers: { cookie },
    });
    assertEquals(sessionRes.status, 200);
    const sessionData = await sessionRes.json();
    assertEquals(sessionData.authenticated, true);
    assertEquals(sessionData.name, "Test");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /api/files → {path, entries} format",
  async fn() {
    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    const cookie = extractCookie(loginRes, "lp_session");
    await loginRes.body?.cancel();

    const filesRes = await fetch(`${BASE}/api/files`, { headers: { cookie } });
    assertEquals(filesRes.status, 200);
    const data = await filesRes.json();
    assertEquals(typeof data.path, "string");
    assertEquals(Array.isArray(data.entries), true);
    assertEquals(data.entries.length > 0, true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /api/quota → has reset_at_ms",
  async fn() {
    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    const cookie = extractCookie(loginRes, "lp_session");
    await loginRes.body?.cancel();

    const quotaRes = await fetch(`${BASE}/api/quota`, { headers: { cookie } });
    assertEquals(quotaRes.status, 200);
    const quota = await quotaRes.json();
    assertEquals(typeof quota.used, "number");
    assertEquals(typeof quota.limit, "number");
    assertEquals(typeof quota.remaining, "number");
    assertEquals(typeof quota.reset_at_ms, "number");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /stream/test.mp3 → 200 or 206 audio",
  async fn() {
    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    const cookie = extractCookie(loginRes, "lp_session");
    await loginRes.body?.cancel();

    const streamRes = await fetch(`${BASE}/stream/test.mp3`, {
      headers: { cookie },
    });
    assertEquals([200, 206].includes(streamRes.status), true);
    assertStringIncludes(streamRes.headers.get("content-type") ?? "", "audio");
    await streamRes.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /stream/../etc/passwd → 400",
  async fn() {
    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    const cookie = extractCookie(loginRes, "lp_session");
    await loginRes.body?.cancel();

    const res = await fetch(`${BASE}/stream/..%2Fetc%2Fpasswd`, { headers: { cookie } });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /api/playback → saves and returns {ok:true}",
  async fn() {
    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    const cookie = extractCookie(loginRes, "lp_session");
    await loginRes.body?.cancel();

    const pbRes = await fetch(`${BASE}/api/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ file: "test.mp3", position_seconds: 42, folder: "" }),
    });
    assertEquals(pbRes.status, 200);
    const data = await pbRes.json();
    assertEquals(data.ok, true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /api/session after playback save → includes playback data",
  async fn() {
    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    const cookie = extractCookie(loginRes, "lp_session");
    await loginRes.body?.cancel();

    // Save playback
    await fetch(`${BASE}/api/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ file: "test.mp3", position_seconds: 99, folder: "" }),
    });

    // Check session includes playback
    const sessionRes = await fetch(`${BASE}/api/session`, { headers: { cookie } });
    const sessionData = await sessionRes.json();
    assertEquals(sessionData.playback?.file, "test.mp3");
    assertEquals(sessionData.playback?.position, 99);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /admin/login wrong PIN → 401",
  async fn() {
    const res = await fetch(`${BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /admin/login correct PIN → 200",
  async fn() {
    const res = await fetch(`${BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "9999" }),
    });
    assertEquals(res.status, 200);
    const cookie = res.headers.get("set-cookie");
    assertStringIncludes(cookie ?? "", "lp_admin");
    await res.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /admin/api/stats → children array",
  async fn() {
    const loginRes = await fetch(`${BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "9999" }),
    });
    const cookie = extractCookie(loginRes, "lp_admin");
    await loginRes.body?.cancel();

    const statsRes = await fetch(`${BASE}/admin/api/stats`, { headers: { cookie } });
    assertEquals(statsRes.status, 200);
    const data = await statsRes.json();
    assertEquals(Array.isArray(data.children), true);
    assertEquals(data.children.length, 3);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "POST /admin/api/child → creates child, then DELETE removes it",
  async fn() {
    const loginRes = await fetch(`${BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "9999" }),
    });
    const cookie = extractCookie(loginRes, "lp_admin");
    await loginRes.body?.cancel();

    const createRes = await fetch(`${BASE}/admin/api/child`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "TestKid", pin: "7777", daily_limit_seconds: 900 }),
    });
    assertEquals(createRes.status, 200);
    const data = await createRes.json();
    assertEquals(data.ok, true);

    // Delete it
    const deleteRes = await fetch(`${BASE}/admin/api/child/${data.child.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assertEquals(deleteRes.status, 200);
    await deleteRes.body?.cancel();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GET /admin/api/reset/:id → 200",
  async fn() {
    const loginRes = await fetch(`${BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "9999" }),
    });
    const cookie = extractCookie(loginRes, "lp_admin");
    await loginRes.body?.cancel();

    const resetRes = await fetch(`${BASE}/admin/api/reset/child_1`, { headers: { cookie } });
    assertEquals(resetRes.status, 200);
    const data = await resetRes.json();
    assertEquals(data.ok, true);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

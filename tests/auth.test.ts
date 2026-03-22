import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { loadStore } from "../server/store.ts";
import {
  createChildSession,
  getChildSession,
  createAdminSession,
  getAdminSession,
  clearChildSession,
  clearAdminSession,
  validateChildPin,
  validateParentPin,
  sanitizeFilename,
  sanitizeDirPath,
  parseCookies,
} from "../server/auth.ts";

async function setup() {
  await loadStore("./fixtures/data.test.json");
}

function makeCookieRequest(cookieStr: string): Request {
  return new Request("http://localhost/", {
    headers: { cookie: cookieStr },
  });
}

Deno.test("validateChildPin: correct pin returns child id", async () => {
  await setup();
  const id = validateChildPin("1111");
  assertEquals(id, "child_1");
});

Deno.test("validateChildPin: wrong pin returns null", async () => {
  await setup();
  const id = validateChildPin("9999");
  assertEquals(id, null);
});

Deno.test("validateChildPin: parent pin is rejected", async () => {
  await setup();
  const id = validateChildPin("9999");
  assertEquals(id, null);
});

Deno.test("validateParentPin: correct pin", async () => {
  await setup();
  assertEquals(validateParentPin("9999"), true);
});

Deno.test("validateParentPin: wrong pin", async () => {
  await setup();
  assertEquals(validateParentPin("1111"), false);
});

Deno.test("createChildSession + getChildSession: round-trip", async () => {
  await setup();
  const cookieHeader = await createChildSession("child_1", "Europe/Zurich");
  // Extract cookie value
  const cookieName = "lp_session";
  const match = cookieHeader.match(`${cookieName}=([^;]+)`);
  const cookieValue = match ? match[1] : "";
  const req = makeCookieRequest(`${cookieName}=${cookieValue}`);
  const session = await getChildSession(req);
  assertEquals(session?.child_id, "child_1");
});

Deno.test("getChildSession: returns null without cookie", async () => {
  await setup();
  const req = new Request("http://localhost/");
  const session = await getChildSession(req);
  assertEquals(session, null);
});

Deno.test("getChildSession: returns null with tampered cookie", async () => {
  await setup();
  const req = makeCookieRequest("lp_session=tampered.invalidsig");
  const session = await getChildSession(req);
  assertEquals(session, null);
});

Deno.test("createAdminSession + getAdminSession: round-trip", async () => {
  await setup();
  const cookieHeader = await createAdminSession("Europe/Zurich");
  const match = cookieHeader.match("lp_admin=([^;]+)");
  const cookieValue = match ? match[1] : "";
  const req = makeCookieRequest(`lp_admin=${cookieValue}`);
  const isAdmin = await getAdminSession(req);
  assertEquals(isAdmin, true);
});

Deno.test("getAdminSession: returns false without cookie", async () => {
  await setup();
  const req = new Request("http://localhost/");
  assertEquals(await getAdminSession(req), false);
});

Deno.test("clearChildSession: produces expired cookie", () => {
  const header = clearChildSession();
  assertEquals(header.includes("1970"), true);
});

Deno.test("parseCookies: parses multiple cookies", () => {
  const req = makeCookieRequest("a=1; b=hello; c=world%20test");
  const cookies = parseCookies(req);
  assertEquals(cookies["a"], "1");
  assertEquals(cookies["b"], "hello");
  assertEquals(cookies["c"], "world test");
});

Deno.test("sanitizeFilename: accepts valid names", () => {
  assertEquals(sanitizeFilename("song.mp3"), "song.mp3");
  assertEquals(sanitizeFilename("My Song (2024).flac"), "My Song (2024).flac");
  assertEquals(sanitizeFilename("track-01.mp3"), "track-01.mp3");
});

Deno.test("sanitizeFilename: accepts subfolder paths", () => {
  assertEquals(sanitizeFilename("Hoerbucher/Folge1/track.mp3"), "Hoerbucher/Folge1/track.mp3");
  assertEquals(sanitizeFilename("folder/song.flac"), "folder/song.flac");
});

Deno.test("sanitizeFilename: rejects path traversal", () => {
  assertEquals(sanitizeFilename("../etc/passwd"), null);
  assertEquals(sanitizeFilename("../../secret.mp3"), null);
  assertEquals(sanitizeFilename("foo\\bar.mp3"), null);
  assertEquals(sanitizeFilename("foo/../bar.mp3"), null);
});

Deno.test("sanitizeFilename: rejects non-audio extensions", () => {
  assertEquals(sanitizeFilename("script.js"), null);
  assertEquals(sanitizeFilename("config.json"), null);
  assertEquals(sanitizeFilename("song.wav"), null);
});

Deno.test("sanitizeDirPath: accepts valid paths", () => {
  assertEquals(sanitizeDirPath(""), "");
  assertEquals(sanitizeDirPath("Hoerbucher"), "Hoerbucher");
  assertEquals(sanitizeDirPath("Hoerbucher/Folge1"), "Hoerbucher/Folge1");
});

Deno.test("sanitizeDirPath: rejects traversal", () => {
  assertEquals(sanitizeDirPath("../etc"), null);
  assertEquals(sanitizeDirPath("foo/../../etc"), null);
  assertEquals(sanitizeDirPath("foo\\bar"), null);
});

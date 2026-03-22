import { assertEquals, assertNotEquals, assertGreater, assertLessOrEqual } from "jsr:@std/assert";
import {
  loadStore,
  saveStore,
  getData,
  getChild,
  getChildByPin,
  getUsageToday,
  addUsage,
  setUsage,
  resetUsageToday,
  getDailyLimit,
  getRemainingSeconds,
  addChild,
  removeChild,
  getTodayKey,
  getPlayback,
  setPlayback,
  getNextMidnightMs,
} from "../server/store.ts";

const TEST_DATA_PATH = "./fixtures/data.test.json";

async function setupStore() {
  await loadStore(TEST_DATA_PATH);
}

Deno.test("loadStore: reads test data", async () => {
  await setupStore();
  const data = getData();
  assertEquals(data.site_token, "testtoken");
  assertEquals(data.parent_pin, "9999");
  assertEquals(data.children.length, 3);
});

Deno.test("getChild: finds by id", async () => {
  await setupStore();
  const child = getChild("child_1");
  assertEquals(child?.name, "Emma");
  assertEquals(child?.pin, "1111");
});

Deno.test("getChild: returns undefined for missing", async () => {
  await setupStore();
  const child = getChild("nonexistent");
  assertEquals(child, undefined);
});

Deno.test("getChildByPin: finds by pin", async () => {
  await setupStore();
  const child = getChildByPin("2222");
  assertEquals(child?.name, "Sophie");
});

Deno.test("getChildByPin: returns undefined for wrong pin", async () => {
  await setupStore();
  const child = getChildByPin("9999");
  assertEquals(child, undefined); // 9999 is parent pin, not child
});

Deno.test("getTodayKey: returns YYYY-MM-DD format", () => {
  const key = getTodayKey("Europe/Zurich");
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(key), true);
});

Deno.test("getUsageToday: reads existing usage", async () => {
  await setupStore();
  const used = getUsageToday("child_1");
  assertEquals(used, 1823);
});

Deno.test("getUsageToday: returns 0 for no usage", async () => {
  await setupStore();
  const used = getUsageToday("child_2");
  assertEquals(used, 0);
});

Deno.test("addUsage: accumulates seconds", async () => {
  await setupStore();
  // Reset first to get clean state
  resetUsageToday("child_2");
  addUsage("child_2", 100);
  addUsage("child_2", 50);
  assertEquals(getUsageToday("child_2"), 150);
});

Deno.test("setUsage: overwrites", async () => {
  await setupStore();
  setUsage("child_2", 999);
  assertEquals(getUsageToday("child_2"), 999);
  resetUsageToday("child_2");
});

Deno.test("resetUsageToday: sets to 0", async () => {
  await setupStore();
  addUsage("child_2", 500);
  resetUsageToday("child_2");
  assertEquals(getUsageToday("child_2"), 0);
});

Deno.test("getDailyLimit: returns child-specific limit", async () => {
  await setupStore();
  assertEquals(getDailyLimit("test"), 7200);
  assertEquals(getDailyLimit("child_1"), 3600);
});

Deno.test("getRemainingSeconds: computes correctly", async () => {
  await setupStore();
  resetUsageToday("child_1");
  setUsage("child_1", 1000);
  const remaining = getRemainingSeconds("child_1");
  assertEquals(remaining, 2600);
});

Deno.test("getRemainingSeconds: clamps to 0", async () => {
  await setupStore();
  setUsage("child_1", 9999);
  const remaining = getRemainingSeconds("child_1");
  assertEquals(remaining, 0);
  // Reset to original
  setUsage("child_1", 1823);
});

Deno.test("addChild: adds new child", async () => {
  await setupStore();
  addChild({ id: "test_new", name: "New", pin: "5555", daily_limit_seconds: 1800 });
  const data = getData();
  const child = data.children.find((c) => c.id === "test_new");
  assertEquals(child?.name, "New");
  // Clean up
  removeChild("test_new");
});

Deno.test("addChild: updates existing child", async () => {
  await setupStore();
  addChild({ id: "child_2", name: "Sophie Updated", pin: "2222", daily_limit_seconds: 3600 });
  assertEquals(getChild("child_2")?.name, "Sophie Updated");
  // Restore
  addChild({ id: "child_2", name: "Sophie", pin: "2222", daily_limit_seconds: 3600 });
});

Deno.test("removeChild: removes existing", async () => {
  await setupStore();
  addChild({ id: "temp", name: "Temp", pin: "6666", daily_limit_seconds: 1800 });
  const removed = removeChild("temp");
  assertEquals(removed, true);
  assertEquals(getChild("temp"), undefined);
});

Deno.test("removeChild: returns false for missing", async () => {
  await setupStore();
  const removed = removeChild("nonexistent");
  assertEquals(removed, false);
});

Deno.test("setPlayback + getPlayback: round-trip", async () => {
  await setupStore();
  setPlayback("child_1", { file: "test.mp3", position: 42, folder: "" });
  const pb = getPlayback("child_1");
  assertEquals(pb?.file, "test.mp3");
  assertEquals(pb?.position, 42);
});

Deno.test("getPlayback: returns null when not set", async () => {
  await setupStore();
  // child_2_neverplayed has no playback set
  const pb = getPlayback("child_2_neverplayed");
  assertEquals(pb, null);
});

Deno.test("getNextMidnightMs: returns future timestamp", () => {
  const ms = getNextMidnightMs("Europe/Zurich");
  assertGreater(ms, Date.now());
  // Should be within 24 hours
  assertLessOrEqual(ms, Date.now() + 24 * 3600_000 + 60_000);
});

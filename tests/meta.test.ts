import { assertEquals, assertGreater } from "jsr:@std/assert";
import { parseMeta, parseMP3, parseFLAC } from "../server/meta.ts";

Deno.test("parseMeta: parses test.mp3", async () => {
  const meta = await parseMeta("./fixtures/test.mp3", "test.mp3");
  assertEquals(meta.format, "mp3");
  assertEquals(meta.filename, "test.mp3");
  assertGreater(meta.duration_seconds, 0);
  assertGreater(meta.bitrate_bps, 0);
  assertGreater(meta.size_bytes, 0);
  // Should be approximately 5 seconds
  assertGreater(meta.duration_seconds, 3);
});

Deno.test("parseMeta: parses test.flac", async () => {
  const meta = await parseMeta("./fixtures/test.flac", "test.flac");
  assertEquals(meta.format, "flac");
  assertEquals(meta.filename, "test.flac");
  assertGreater(meta.duration_seconds, 0);
  assertGreater(meta.size_bytes, 0);
  // Should be approximately 5 seconds
  assertGreater(meta.duration_seconds, 3);
});

Deno.test("parseMeta: returns title without extension", async () => {
  const meta = await parseMeta("./fixtures/test.mp3", "test.mp3");
  assertEquals(meta.title, "test");
});

Deno.test("parseMeta: caches results", async () => {
  const meta1 = await parseMeta("./fixtures/test.mp3", "test.mp3");
  const meta2 = await parseMeta("./fixtures/test.mp3", "test.mp3");
  assertEquals(meta1 === meta2, true); // same object reference
});

Deno.test("parseMP3: returns duration and bitrate", async () => {
  const data = await Deno.readFile("./fixtures/test.mp3");
  const stat = await Deno.stat("./fixtures/test.mp3");
  const result = parseMP3(data, stat.size);
  assertGreater(result.duration, 0);
  assertGreater(result.bitrate, 0);
});

Deno.test("parseFLAC: returns duration and bitrate", async () => {
  const data = await Deno.readFile("./fixtures/test.flac");
  const stat = await Deno.stat("./fixtures/test.flac");
  const result = parseFLAC(data, stat.size);
  assertGreater(result.duration, 0);
  assertGreater(result.bitrate, 0);
});

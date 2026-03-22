import { assertEquals, assertLessOrEqual, assertGreaterOrEqual } from "jsr:@std/assert";
import { parseRangeHeader } from "../server/stream.ts";

Deno.test("parseRangeHeader: no header returns full range", () => {
  const { start, end } = parseRangeHeader(null, 1000);
  assertEquals(start, 0);
  assertEquals(end, 999);
});

Deno.test("parseRangeHeader: bytes=0- returns full range", () => {
  const { start, end } = parseRangeHeader("bytes=0-", 1000);
  assertEquals(start, 0);
  assertEquals(end, 999);
});

Deno.test("parseRangeHeader: bytes=0-499 returns first half", () => {
  const { start, end } = parseRangeHeader("bytes=0-499", 1000);
  assertEquals(start, 0);
  assertEquals(end, 499);
});

Deno.test("parseRangeHeader: bytes=500-999 returns second half", () => {
  const { start, end } = parseRangeHeader("bytes=500-999", 1000);
  assertEquals(start, 500);
  assertEquals(end, 999);
});

Deno.test("parseRangeHeader: clamps end to file size", () => {
  const { start, end } = parseRangeHeader("bytes=0-9999", 1000);
  assertEquals(end, 999);
});

Deno.test("parseRangeHeader: arbitrary offset in large file", () => {
  const fileSize = 10_000_000;
  const { start, end } = parseRangeHeader("bytes=500000-", fileSize);
  assertEquals(start, 500_000);
  assertEquals(end, fileSize - 1);
});

Deno.test("quota deduction math: bytes to seconds", () => {
  const bitrateKbps = 128; // 128kbps
  const bitratesBps = bitrateKbps * 1000;
  const bytesPerSecond = bitratesBps / 8; // 16000 bytes/sec

  // 5 seconds of audio
  const fiveSecBytes = bytesPerSecond * 5;
  const seconds = fiveSecBytes / bytesPerSecond;
  assertEquals(seconds, 5);
});

Deno.test("quota clamp: maxBytes limits end", () => {
  const bitratesBps = 128_000; // 128kbps
  const bytesPerSec = bitratesBps / 8;
  const remainingSecs = 10; // 10 seconds remaining
  const maxBytesForQuota = Math.floor(remainingSecs * bytesPerSec);

  const start = 0;
  const requestedEnd = 1_000_000; // requests way more than quota
  const fileSize = 1_000_001;

  const allowedEnd = Math.min(requestedEnd, start + maxBytesForQuota - 1);
  const clampedEnd = Math.max(start, allowedEnd);

  // Should be limited to ~10s of audio
  const bytesServed = clampedEnd - start + 1;
  const secondsServed = bytesServed / bytesPerSec;

  assertLessOrEqual(secondsServed, remainingSecs + 1); // small floating point buffer
  assertGreaterOrEqual(secondsServed, remainingSecs - 1);
});

Deno.test("quota clamp: remaining 0 allows no bytes", () => {
  const bitratesBps = 128_000;
  const bytesPerSec = bitratesBps / 8;
  const remainingSecs = 0;
  const maxBytesForQuota = Math.floor(remainingSecs * bytesPerSec);

  assertEquals(maxBytesForQuota, 0);
});

Deno.test("quota clamp: high bitrate FLAC", () => {
  // FLAC at ~900kbps
  const bitratesBps = 900_000;
  const bytesPerSec = bitratesBps / 8; // 112500 bytes/sec
  const remainingSecs = 60;
  const maxBytes = Math.floor(remainingSecs * bytesPerSec);

  assertEquals(maxBytes, 6_750_000);
});

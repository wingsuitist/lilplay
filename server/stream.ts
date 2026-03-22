/**
 * stream.ts — Range-aware streaming with quota deduction
 */

import { addUsage, getRemainingSeconds, saveStore } from "./store.ts";
import { getCachedMeta } from "./meta.ts";

interface StreamState {
  childId: string;
  filename: string;
  paused: boolean;
  bytesServed: number;
  controller: AbortController;
  flushTimer: number;
  accumulatedBytes: number;
  lastFlushedBytes: number;
}

const activeStreams = new Map<string, StreamState>();

export function getActiveStreams(): Map<string, StreamState> {
  return activeStreams;
}

export function setPauseState(childId: string, paused: boolean): void {
  const state = activeStreams.get(childId);
  if (state) state.paused = paused;
}

export function getStreamState(childId: string): StreamState | undefined {
  return activeStreams.get(childId);
}

function bytesToSeconds(bytes: number, bitratesBps: number): number {
  if (bitratesBps <= 0) return 0;
  return bytes / (bitratesBps / 8);
}

async function flushUsage(state: StreamState, bitratesBps: number): Promise<void> {
  const newBytes = state.accumulatedBytes - state.lastFlushedBytes;
  if (newBytes <= 0) return;
  const newSeconds = bytesToSeconds(newBytes, bitratesBps);
  if (newSeconds > 0) {
    addUsage(state.childId, newSeconds);
    state.lastFlushedBytes = state.accumulatedBytes;
    try {
      await saveStore();
    } catch (e) {
      console.warn("Failed to flush usage:", e);
    }
  }
}

export function parseRangeHeader(
  rangeHeader: string | null,
  fileSize: number
): { start: number; end: number } {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return { start: 0, end: fileSize - 1 };
  }
  const parts = rangeHeader.slice(6).split("-");
  const start = parts[0] ? parseInt(parts[0], 10) : 0;
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  return {
    start: Math.max(0, isNaN(start) ? 0 : start),
    end: Math.min(fileSize - 1, isNaN(end) ? fileSize - 1 : end),
  };
}

export async function streamAudio(
  req: Request,
  childId: string,
  filePath: string,
  filename: string
): Promise<Response> {
  // Check for existing stream from this child
  if (activeStreams.has(childId)) {
    return new Response("Conflict: already streaming", { status: 409 });
  }

  const meta = getCachedMeta(filePath);
  if (!meta) {
    return new Response("File metadata not found", { status: 404 });
  }

  const fileSize = meta.size_bytes;
  const bitratesBps = meta.bitrate_bps;

  // Check quota
  const remaining = getRemainingSeconds(childId);
  if (remaining <= 0) {
    return new Response("Quota exceeded", { status: 429 });
  }

  // Parse Range header
  const rangeHeader = req.headers.get("range");
  const { start, end: requestedEnd } = parseRangeHeader(rangeHeader, fileSize);

  // Clamp end based on quota
  const maxBytesForQuota = Math.floor(remaining * (bitratesBps / 8));
  const allowedEnd = Math.min(requestedEnd, start + maxBytesForQuota - 1);
  const end = Math.max(start, allowedEnd);

  const contentLength = end - start + 1;
  const isPartial = rangeHeader !== null;

  // Register stream state
  const controller = new AbortController();
  const state: StreamState = {
    childId,
    filename,
    paused: false,
    bytesServed: 0,
    controller,
    flushTimer: 0,
    accumulatedBytes: 0,
    lastFlushedBytes: 0,
  };
  activeStreams.set(childId, state);

  const headers = new Headers({
    "Content-Type": meta.format === "mp3" ? "audio/mpeg" : "audio/flac",
    "Content-Length": String(contentLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  });

  if (isPartial) {
    headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  }

  const CHUNK_SIZE = 16 * 1024; // 16KB chunks
  const FLUSH_BYTES = Math.floor(bitratesBps / 8) * 5; // flush every ~5 seconds of audio

  const stream = new ReadableStream({
    async start(streamController) {
      let file: Deno.FsFile | null = null;
      try {
        file = await Deno.open(filePath, { read: true });
        await file.seek(start, Deno.SeekMode.Start);

        let bytesRemaining = contentLength;
        let bytesSinceLastFlush = 0;

        while (bytesRemaining > 0 && !controller.signal.aborted) {
          // Check if paused — yield but don't count bytes
          if (state.paused) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }

          // Re-check quota every flush interval
          if (bytesSinceLastFlush >= FLUSH_BYTES) {
            await flushUsage(state, bitratesBps);
            bytesSinceLastFlush = 0;
            const rem = getRemainingSeconds(childId);
            if (rem <= 0) {
              break; // Quota exhausted
            }
          }

          const toRead = Math.min(CHUNK_SIZE, bytesRemaining);
          const chunk = new Uint8Array(toRead);
          const bytesRead = await file.read(chunk);
          if (bytesRead === null || bytesRead === 0) break;

          const data = chunk.subarray(0, bytesRead);
          streamController.enqueue(data);

          state.accumulatedBytes += bytesRead;
          bytesRemaining -= bytesRead;
          bytesSinceLastFlush += bytesRead;
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          console.warn(`Stream error for ${childId}:`, e);
        }
      } finally {
        file?.close();
        // Final flush
        try {
          await flushUsage(state, bitratesBps);
        } catch {
          // ignore
        }
        activeStreams.delete(childId);
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    status: isPartial ? 206 : 200,
    headers,
  });
}

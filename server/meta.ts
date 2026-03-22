/**
 * meta.ts — MP3 (ID3/XING/CBR) + FLAC (STREAMINFO) metadata parser
 */

export interface TrackMeta {
  path: string;
  filename: string;
  title: string;
  duration_seconds: number;
  bitrate_bps: number;
  format: "mp3" | "flac";
  size_bytes: number;
}

// In-memory metadata cache
const metaCache = new Map<string, TrackMeta>();

export function getCachedMeta(path: string): TrackMeta | undefined {
  return metaCache.get(path);
}

export function setCachedMeta(path: string, meta: TrackMeta): void {
  metaCache.set(path, meta);
}

export function clearCache(): void {
  metaCache.clear();
}

/**
 * Parse MP3 metadata from a buffer.
 * Tries: ID3v2 tag → XING/Info/VBRI header → CBR estimation
 */
export function parseMP3(buf: Uint8Array, fileSize: number): { duration: number; bitrate: number } {
  let offset = 0;

  // Skip ID3v2 tag if present
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    // "ID3"
    const id3Size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    offset = 10 + id3Size;
    // Check for ID3 footer
    if (buf[5] & 0x10) offset += 10;
  }

  // Find first valid sync frame
  for (let i = offset; i < Math.min(buf.length - 4, offset + 8192); i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const result = tryMP3Frame(buf, i, fileSize);
      if (result) return result;
    }
  }

  // Fallback: assume 128kbps
  const bitrate = 128_000;
  const audioSize = fileSize - offset;
  return { duration: (audioSize * 8) / bitrate, bitrate };
}

function tryMP3Frame(
  buf: Uint8Array,
  offset: number,
  fileSize: number
): { duration: number; bitrate: number } | null {
  if (offset + 4 > buf.length) return null;

  const h = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];

  // Validate sync
  if ((h & 0xffe00000) !== 0xffe00000) return null;

  const versionBits = (h >> 19) & 0x3;
  const layerBits = (h >> 17) & 0x3;
  const bitrateBits = (h >> 12) & 0xf;
  const samplerateBits = (h >> 10) & 0x3;
  const paddingBit = (h >> 9) & 0x1;

  if (versionBits === 1 || layerBits === 0 || bitrateBits === 0 || bitrateBits === 15) return null;
  if (samplerateBits === 3) return null;

  const isV1 = versionBits === 3;
  const isV2 = versionBits === 2 || versionBits === 0;
  const isL3 = layerBits === 1;
  const isL2 = layerBits === 2;
  const isL1 = layerBits === 3;

  const bitrateTable: Record<string, number[]> = {
    "v1l1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    "v1l2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    "v1l3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "v2l1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    "v2l2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    "v2l3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };

  const srTable: Record<string, number[]> = {
    "v1": [44100, 48000, 32000],
    "v2": [22050, 24000, 16000],
    "v25": [11025, 12000, 8000],
  };

  const vKey = isV1 ? "v1" : versionBits === 2 ? "v2" : "v25";
  const lKey = isL1 ? "l1" : isL2 ? "l2" : "l3";
  const brKey = `${isV1 ? "v1" : "v2"}${lKey}`;

  const bitrateKbps = bitrateTable[brKey]?.[bitrateBits];
  const sampleRate = srTable[vKey]?.[samplerateBits];

  if (!bitrateKbps || !sampleRate) return null;

  const bitrate = bitrateKbps * 1000;
  const samplesPerFrame = isL1 ? 384 : isV1 ? 1152 : 576;
  const frameSize = isL1
    ? Math.floor(12 * bitrate / sampleRate + paddingBit) * 4
    : Math.floor(samplesPerFrame * bitrate / (8 * sampleRate)) + paddingBit;

  // Check for XING/Info VBR header (38 bytes into frame for stereo L3)
  const xingOffset = offset + 4 + (isL3 ? (isV1 ? 32 : 17) : 0);
  if (xingOffset + 12 <= buf.length) {
    const tag = String.fromCharCode(buf[xingOffset], buf[xingOffset + 1], buf[xingOffset + 2], buf[xingOffset + 3]);
    if (tag === "Xing" || tag === "Info") {
      const flags = (buf[xingOffset + 4] << 24) | (buf[xingOffset + 5] << 16) | (buf[xingOffset + 6] << 8) | buf[xingOffset + 7];
      let xOff = xingOffset + 8;
      let totalFrames = 0;
      if (flags & 0x1) {
        totalFrames = (buf[xOff] << 24) | (buf[xOff + 1] << 16) | (buf[xOff + 2] << 8) | buf[xOff + 3];
        xOff += 4;
      }
      if (totalFrames > 0) {
        const duration = (totalFrames * samplesPerFrame) / sampleRate;
        // Estimate bitrate from file size
        const estBitrate = totalFrames > 0 ? Math.round((fileSize * 8) / duration) : bitrate;
        return { duration, bitrate: estBitrate };
      }
    }

    // VBRI header (at frame + 32)
    const vbriOffset = offset + 4 + 32;
    if (vbriOffset + 18 <= buf.length) {
      const vbriTag = String.fromCharCode(buf[vbriOffset], buf[vbriOffset + 1], buf[vbriOffset + 2], buf[vbriOffset + 3]);
      if (vbriTag === "VBRI") {
        const totalFramesVbri = (buf[vbriOffset + 14] << 24) | (buf[vbriOffset + 15] << 16) | (buf[vbriOffset + 16] << 8) | buf[vbriOffset + 17];
        if (totalFramesVbri > 0) {
          const duration = (totalFramesVbri * samplesPerFrame) / sampleRate;
          return { duration, bitrate: Math.round((fileSize * 8) / duration) };
        }
      }
    }
  }

  // CBR: estimate from bitrate and file size
  const audioBytes = fileSize - offset;
  const duration = (audioBytes * 8) / bitrate;
  return { duration, bitrate };
}

/**
 * Parse FLAC STREAMINFO block.
 * Format: fLaC marker (4 bytes) + metadata blocks
 */
export function parseFLAC(buf: Uint8Array, fileSize: number): { duration: number; bitrate: number } {
  // Check fLaC marker
  if (buf[0] !== 0x66 || buf[1] !== 0x4c || buf[2] !== 0x61 || buf[3] !== 0x43) {
    throw new Error("Not a FLAC file");
  }

  let offset = 4;
  while (offset + 4 <= buf.length) {
    const isLast = (buf[offset] & 0x80) !== 0;
    const blockType = buf[offset] & 0x7f;
    const blockLen = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    offset += 4;

    if (blockType === 0 && blockLen >= 18) {
      // STREAMINFO
      // Bits layout (from spec):
      // 16 bits: min block size
      // 16 bits: max block size
      // 24 bits: min frame size
      // 24 bits: max frame size
      // 20 bits: sample rate
      // 3 bits: channels - 1
      // 5 bits: bits per sample - 1
      // 36 bits: total samples
      if (offset + 18 > buf.length) break;

      const sampleRate =
        ((buf[offset + 10] << 12) | (buf[offset + 11] << 4) | (buf[offset + 12] >> 4)) & 0xfffff;

      // Total samples: bits 108-143 (starting from offset)
      // Bytes 13-17 (5 bytes, but only last 4 bits of byte 13 + 4 bytes)
      // byte 13: 0000xxxx (top 4 bits are part of bits per sample)
      // We need bits [108..143] = 36 bits total
      // byte offset 13 bit4-7 (4 bits) + bytes 14,15,16,17 (32 bits) = 36 bits
      const totalSamples =
        ((buf[offset + 13] & 0x0f) * 2 ** 32) +
        ((buf[offset + 14] << 24) | (buf[offset + 15] << 16) | (buf[offset + 16] << 8) | buf[offset + 17]);

      if (sampleRate === 0) break;
      const duration = totalSamples / sampleRate;
      const bitrate = duration > 0 ? Math.round((fileSize * 8) / duration) : 0;
      return { duration, bitrate };
    }

    offset += blockLen;
    if (isLast) break;
  }

  throw new Error("FLAC STREAMINFO not found");
}

export async function parseMeta(
  filePath: string,
  filename: string
): Promise<TrackMeta> {
  const cached = metaCache.get(filePath);
  if (cached) return cached;

  const stat = await Deno.stat(filePath);
  const fileSize = stat.size;

  // Read first 64KB for header parsing
  const readSize = Math.min(65536, fileSize);
  const file = await Deno.open(filePath, { read: true });
  const buf = new Uint8Array(readSize);
  await file.read(buf);
  file.close();

  const isMP3 = filename.toLowerCase().endsWith(".mp3");
  const isFLAC = filename.toLowerCase().endsWith(".flac");

  if (!isMP3 && !isFLAC) {
    throw new Error(`Unsupported format: ${filename}`);
  }

  let duration = 0;
  let bitrate = 0;
  try {
    if (isMP3) {
      const result = parseMP3(buf, fileSize);
      duration = result.duration;
      bitrate = result.bitrate;
    } else {
      const result = parseFLAC(buf, fileSize);
      duration = result.duration;
      bitrate = result.bitrate;
    }
  } catch {
    // Fallback
    duration = 0;
    bitrate = 128_000;
  }

  // Extract title from filename (strip extension)
  const title = filename.replace(/\.(mp3|flac)$/i, "");

  const meta: TrackMeta = {
    path: filePath,
    filename,
    title,
    duration_seconds: Math.round(duration),
    bitrate_bps: bitrate,
    format: isMP3 ? "mp3" : "flac",
    size_bytes: fileSize,
  };

  metaCache.set(filePath, meta);
  return meta;
}

export interface DirEntry {
  name: string;
  type: "folder" | "file";
  // Only set for files:
  title?: string;
  duration_seconds?: number;
  bitrate_bps?: number;
  format?: "mp3" | "flac";
  size_bytes?: number;
  // Relative path from music root (for streaming)
  relative_path?: string;
}

/**
 * List a directory: returns folders first, then audio files.
 * relPath is relative to musicDir (empty string = root).
 */
export async function listDirectory(musicDir: string, relPath: string): Promise<DirEntry[]> {
  const absDir = relPath ? `${musicDir}/${relPath}` : musicDir;
  const folders: DirEntry[] = [];
  const files: DirEntry[] = [];

  try {
    for await (const entry of Deno.readDir(absDir)) {
      if (entry.isDirectory) {
        // Skip hidden directories
        if (entry.name.startsWith(".")) continue;
        folders.push({ name: entry.name, type: "folder" });
      } else if (entry.isFile) {
        const lower = entry.name.toLowerCase();
        if (!lower.endsWith(".mp3") && !lower.endsWith(".flac")) continue;
        const filePath = `${absDir}/${entry.name}`;
        const relative = relPath ? `${relPath}/${entry.name}` : entry.name;
        try {
          const meta = await parseMeta(filePath, entry.name);
          files.push({
            name: entry.name,
            type: "file",
            title: meta.title,
            duration_seconds: meta.duration_seconds,
            bitrate_bps: meta.bitrate_bps,
            format: meta.format,
            size_bytes: meta.size_bytes,
            relative_path: relative,
          });
        } catch (e) {
          console.warn(`Failed to parse ${entry.name}:`, e);
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to list directory ${absDir}:`, e);
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

export async function scanDirectory(dir: string): Promise<TrackMeta[]> {
  const results: TrackMeta[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith(".mp3") && !lower.endsWith(".flac")) continue;
      const filePath = `${dir}/${entry.name}`;
      try {
        const meta = await parseMeta(filePath, entry.name);
        results.push(meta);
      } catch (e) {
        console.warn(`Failed to parse ${entry.name}:`, e);
      }
    }
  } catch (e) {
    console.warn(`Failed to scan directory ${dir}:`, e);
  }
  results.sort((a, b) => a.filename.localeCompare(b.filename));
  return results;
}

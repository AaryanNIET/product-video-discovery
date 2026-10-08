import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import { env } from "../../config/env";
import { safeFetch } from "../../utils/safeFetch";

const REF_DIR = path.join(env.storageDir, "ref");
const THUMB_DIR = path.join(env.storageDir, "thumbs");

export const sha1 = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");

let dirsReady: Promise<unknown> | null = null;
function ensureDirs() {
  dirsReady ??= Promise.all([fs.mkdir(REF_DIR, { recursive: true }), fs.mkdir(THUMB_DIR, { recursive: true })]);
  return dirsReady;
}

/** Ids are always our own sha1 hex strings; anything else is rejected before touching the filesystem. */
export function isValidMediaId(id: string): boolean {
  return /^[a-f0-9]{40}$/.test(id);
}

export const refImagePath = (id: string) => path.join(REF_DIR, `${id}.jpg`);
export const thumbPath = (id: string) => path.join(THUMB_DIR, `${id}.jpg`);

/**
 * 64-bit difference hash (dHash): shrink to 9x8 greyscale and record whether
 * each pixel is brighter than its right neighbour. Re-uploads, re-encodes and
 * light crops of the same frame land within a few bits of each other.
 */
export async function dHash(image: Buffer): Promise<string> {
  const pixels = await sharp(image).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? "1" : "0";
    }
  }
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Small JPEG sent to the vision model (Gemini bills images up to 384px as a flat, low token count). */
export function toVisionJpeg(image: Buffer, size = 384): Promise<Buffer> {
  return sharp(image).rotate().resize(size, size, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

/** Stores a reference product image (upload or product page) and returns its id. */
export async function saveReferenceImage(image: Buffer): Promise<string> {
  await ensureDirs();
  const normalized = await sharp(image).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const id = sha1(normalized);
  await fs.writeFile(refImagePath(id), normalized);
  return id;
}

export async function loadReferenceImage(id: string): Promise<Buffer | null> {
  if (!isValidMediaId(id)) return null;
  return fs.readFile(refImagePath(id)).catch(() => null);
}

/** Downloads a remote image through the SSRF-safe fetcher and checks it is a real image. */
export async function downloadImage(url: string): Promise<Buffer> {
  const res = await safeFetch(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 10000, headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" } });
  if (res.status >= 400) throw new Error(`Image download failed (${res.status})`);
  await sharp(res.body).metadata(); // throws on non-image payloads
  return res.body;
}

export interface CachedThumb {
  thumbId: string;
  phash: string;
  visionJpeg: Buffer;
}

/**
 * Downloads a candidate's thumbnail once and keeps a local copy. Platform CDN
 * links are signed and expire within hours, and Instagram's CDN blocks
 * cross-site embedding, so the dashboard and search history always serve this
 * cached copy instead of the original URL.
 */
export async function cacheThumbnail(candidateKey: string, url: string): Promise<CachedThumb> {
  await ensureDirs();
  const original = await downloadImage(url);
  const thumbId = sha1(candidateKey);
  const display = await sharp(original).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  await fs.writeFile(thumbPath(thumbId), display);
  const [phash, visionJpeg] = await Promise.all([dHash(original), toVisionJpeg(original)]);
  return { thumbId, phash, visionJpeg };
}

/** Decodes a data: URL from the upload field, validating type and size. */
export async function decodeImageDataUrl(dataUrl: string): Promise<Buffer> {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw Object.assign(new Error("Upload must be a PNG, JPEG, WebP, GIF or AVIF image."), { status: 400 });
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > 6 * 1024 * 1024) throw Object.assign(new Error("Image is larger than 6 MB."), { status: 400 });
  try {
    await sharp(buf).metadata();
  } catch {
    throw Object.assign(new Error("The uploaded file is not a readable image."), { status: 400 });
  }
  return buf;
}

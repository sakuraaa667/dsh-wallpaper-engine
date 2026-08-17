/**
 * dsh-wallpaper-engine: extract high-resolution artwork from Wallpaper Engine
 * package files (scene.pkg / *.pkg — the PKGV container format).
 *
 * Scene-type wallpapers have no standalone image file: Wallpaper Engine
 * renders the 3D scene at runtime and only ships a small `preview.jpg`.
 * The scene package, however, embeds the real textures as PNG mip chains —
 * commonly a 4K base image. This module scans a package for embedded PNGs,
 * extracts the largest one, and caches it on disk so extraction happens once.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Safety cap: refuse to read package files larger than this (512 MB). */
const MAX_PKG_BYTES = 512 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function cacheDir() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return join(home, 'dsh-wallpaper-cache');
}

/** Deterministic cache file for one wallpaper id. */
export function cachePathFor(id) {
  return join(cacheDir(), `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`);
}

/**
 * Find every complete embedded PNG in a buffer.
 * @returns entries { off, w, h, len } for valid PNGs (dimensions from IHDR).
 */
function findPngs(buf) {
  const found = [];
  let i = 0;
  while (i < buf.length - 8) {
    const isMagic =
      buf[i] === PNG_MAGIC[0] && buf[i + 1] === PNG_MAGIC[1] &&
      buf[i + 2] === PNG_MAGIC[2] && buf[i + 3] === PNG_MAGIC[3] &&
      buf[i + 4] === PNG_MAGIC[4] && buf[i + 5] === PNG_MAGIC[5] &&
      buf[i + 6] === PNG_MAGIC[6] && buf[i + 7] === PNG_MAGIC[7];
    if (!isMagic) {
      i += 1;
      continue;
    }
    const w = buf.readUInt32BE(i + 16);
    const h = buf.readUInt32BE(i + 20);
    let end = -1;
    for (let j = i + 8; j < buf.length - 8; j += 1) {
      if (buf[j] === 0x49 && buf[j + 1] === 0x45 && buf[j + 2] === 0x4e && buf[j + 3] === 0x44) {
        end = j + 12;
        break;
      }
    }
    if (end > 0 && w > 0 && h > 0) {
      found.push({ off: i, w, h, len: end - i });
      i = end;
    } else {
      i += 8;
    }
  }
  return found;
}

/** In-process negatives: ids whose package contained no usable PNG. */
const noPngIds = new Set();

/**
 * Extract the largest embedded PNG from a package file and cache it on disk.
 * @param pkgPath - absolute path of the .pkg file.
 * @param id - wallpaper id used to derive the cache filename.
 * @returns the cache file path when extraction succeeded, otherwise null.
 */
export function extractPkgImage(pkgPath, id) {
  if (noPngIds.has(id)) return null;
  const target = cachePathFor(id);
  if (existsSync(target)) return target;

  let stat;
  try {
    stat = statSync(pkgPath);
  } catch {
    noPngIds.add(id);
    return null;
  }
  if (stat.size <= 0 || stat.size > MAX_PKG_BYTES) {
    noPngIds.add(id);
    return null;
  }

  let buf;
  try {
    buf = readFileSync(pkgPath);
  } catch {
    noPngIds.add(id);
    return null;
  }

  const pngs = findPngs(buf);
  if (pngs.length === 0) {
    noPngIds.add(id);
    return null;
  }
  // Wallpaper Engine scenes ship several textures (background, characters,
  // masks). For a desktop backdrop, the intended art is a large landscape
  // texture: prefer candidates closest to 16:9, breaking ties by pixel area.
  // Falls back to the largest area when nothing is landscape-shaped.
  const landscape = pngs.filter((entry) => entry.w / entry.h >= 1.2);
  const pool = landscape.length > 0 ? landscape : pngs;
  pool.sort((a, b) => {
    const da = Math.abs(a.w / a.h - 16 / 9);
    const db = Math.abs(b.w / b.h - 16 / 9);
    if (Math.abs(da - db) > 0.08) return da - db;
    return b.w * b.h - a.w * a.h;
  });
  const best = pool[0];

  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(target, buf.subarray(best.off, best.off + best.len));
  } catch {
    return null;
  }
  return target;
}

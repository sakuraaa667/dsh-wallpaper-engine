/**
 * dsh-wallpaper-engine: wallpaper discovery.
 *
 * Finds Wallpaper Engine content on this machine:
 *  - Steam Workshop downloads for app 431960, under every Steam library root
 *    (library roots are read from `<steam>/steamapps/libraryfolders.vdf`, so
 *    multi-library setups work), plus a few well-known layouts;
 *  - local projects under `<wallpaper_engine>/projects/myprojects` and
 *    `.../defaultprojects`.
 *
 * Paths can be overridden through plugin config (`workshopDir` / `projectsDir`)
 * or environment variables (`DSH_WALLPAPER_WORKSHOP_DIR`,
 * `DSH_WALLPAPER_STEAM_DIR`; `;`-separated lists).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

export const WORKSHOP_APP_ID = '431960';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function envList(name) {
  const value = process.env[name];
  if (!value) return [];
  return value.split(';').map((part) => part.trim()).filter(Boolean);
}

/** Collect every Steam library root reachable from common locations. */
function findSteamLibraries() {
  const roots = [];
  const seen = new Set();
  const add = (path) => {
    if (path && isDir(path) && !seen.has(path)) {
      seen.add(path);
      roots.push(path);
    }
  };

  for (const dir of envList('DSH_WALLPAPER_STEAM_DIR')) add(dir);

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const candidates = [
    join(programFilesX86, 'Steam'),
    join(programFiles, 'Steam'),
  ];
  for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
    candidates.push(`${drive}:\\steam`, `${drive}:\\SteamLibrary`);
  }
  for (const candidate of candidates) {
    if (!isDir(candidate)) continue;
    add(candidate);
    // Read additional library roots from libraryfolders.vdf when present.
    const vdf = join(candidate, 'steamapps', 'libraryfolders.vdf');
    if (!existsSync(vdf)) continue;
    try {
      const text = readFileSync(vdf, 'utf8');
      for (const match of text.matchAll(/"path"\s*"([^"]+)"/g)) {
        add(match[1].replace(/\\\\/g, '\\'));
      }
    } catch {
      // Unreadable vdf — keep the roots already found.
    }
  }
  return roots;
}

function addUnique(list, seen, path) {
  if (isDir(path) && !seen.has(path)) {
    seen.add(path);
    list.push(path);
  }
}

/** Resolve workshop + local project directories, honoring config/env overrides. */
export function detectSources(config = {}) {
  const workshopDirs = [];
  const projectDirs = [];
  const seenWorkshop = new Set();
  const seenProjects = new Set();

  const addWorkshop = (path) => addUnique(workshopDirs, seenWorkshop, path);
  const addProjects = (path) => addUnique(projectDirs, seenProjects, path);

  for (const dir of envList('DSH_WALLPAPER_WORKSHOP_DIR')) addWorkshop(dir);
  const workshopCfg = config.workshopDir;
  if (typeof workshopCfg === 'string') addWorkshop(workshopCfg);
  else if (Array.isArray(workshopCfg)) for (const dir of workshopCfg) addWorkshop(dir);

  const projectsCfg = config.projectsDir;
  if (typeof projectsCfg === 'string') addProjects(projectsCfg);
  else if (Array.isArray(projectsCfg)) for (const dir of projectsCfg) addProjects(dir);

  for (const library of findSteamLibraries()) {
    addWorkshop(join(library, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID));
    const engine = join(library, 'steamapps', 'common', 'wallpaper_engine');
    if (isDir(engine)) {
      addProjects(join(engine, 'projects', 'myprojects'));
      addProjects(join(engine, 'projects', 'defaultprojects'));
    }
  }

  return { workshopDirs, projectDirs };
}

function firstFileMatching(dir, predicate) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (predicate(entry.name)) return join(dir, entry.name);
  }
  return null;
}

function pickPreview(dir, declared) {
  if (typeof declared === 'string' && declared) {
    const path = join(dir, declared);
    if (existsSync(path)) return path;
  }
  return firstFileMatching(dir, (name) => IMAGE_EXTS.has(extname(name).toLowerCase()));
}

function pickMediaFile(dir, declared, type) {
  if (typeof declared === 'string' && declared) {
    const path = join(dir, declared);
    const ext = extname(declared).toLowerCase();
    if (existsSync(path) && (VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext))) return path;
  }
  if (type === 'video') {
    return firstFileMatching(dir, (name) => VIDEO_EXTS.has(extname(name).toLowerCase()));
  }
  return null;
}

function inferType(dir) {
  if (firstFileMatching(dir, (name) => VIDEO_EXTS.has(extname(name).toLowerCase()))) return 'video';
  if (firstFileMatching(dir, (name) => IMAGE_EXTS.has(extname(name).toLowerCase()))) return 'image';
  return 'unknown';
}

function inspectWallpaper(dir, id, source) {
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
  } catch {
    // No readable project.json — fall back to directory inspection.
  }

  const rawTitle = typeof meta.title === 'string' ? meta.title.trim() : '';
  const title = rawTitle || id.split(':').pop() || id;
  const declaredType = typeof meta.type === 'string' ? meta.type : '';
  const type = declaredType || inferType(dir);
  const preview = pickPreview(dir, meta.preview);
  const file = pickMediaFile(dir, meta.file, type);
  const hasVideo = file !== null && VIDEO_EXTS.has(extname(file).toLowerCase());

  return { id, title, type, source, preview, file, hasVideo };
}

/** Scan all sources; returns the full wallpaper list (sorted by title). */
export function scanWallpapers(config = {}) {
  const { workshopDirs, projectDirs } = detectSources(config);
  const wallpapers = [];

  for (const dir of workshopDirs) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wp = inspectWallpaper(join(dir, entry.name), `workshop:${entry.name}`, 'workshop');
      if (wp) wallpapers.push(wp);
    }
  }

  for (const dir of projectDirs) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wp = inspectWallpaper(join(dir, entry.name), `local:${entry.name}`, 'local');
      if (wp) wallpapers.push(wp);
    }
  }

  wallpapers.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  return wallpapers;
}

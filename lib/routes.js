/**
 * dsh-wallpaper-engine: HTTP routes + persisted selection.
 *
 * Routes (all same-origin, mounted on the host webServer):
 *   GET  /dsh-wallpaper/list                  → scanned wallpapers + sources
 *   GET  /dsh-wallpaper/config                → persisted selection
 *   POST /dsh-wallpaper/config                → persist selection {id, dim, overlay}
 *   GET  /dsh-wallpaper/preview/<id>          → preview image (jpg/png/webp/gif)
 *   GET  /dsh-wallpaper/file/<id>             → wallpaper media file (mp4/webm/...)
 *
 * Wallpaper ids are never used to build filesystem paths: every request is
 * looked up in a scan-built map, so arbitrary ids cannot escape the sources.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { scanWallpapers, detectSources } from './scanner.js';
import { extractPkgImage } from './pkgimage.js';

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
};

const SCAN_TTL_MS = 30_000;

function stateFile() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return join(home, 'dsh-wallpaper.json');
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  const file = stateFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, file);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === undefined || host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function serveFile(response, request, filePath) {
  const stat = statSync(filePath);
  const contentType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const headers = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=300',
  };

  const range = request.headers.range;
  if (request.method === 'HEAD') {
    response.writeHead(200, { ...headers, 'content-length': stat.size });
    response.end();
    return;
  }

  if (typeof range === 'string') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      response.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      response.end();
      return;
    }
    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) {
      response.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${stat.size}`,
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { ...headers, 'content-length': stat.size });
  createReadStream(filePath).pipe(response);
}

/**
 * Mount every route on the host webServer.
 * @param host - host context exposing `webServer`.
 * @param config - plugin config (`workshopDir`, `projectsDir`).
 * @returns a disposer removing the routes.
 */
export function mountRoutes(host, config) {
  let scanCache = { at: 0, value: null };

  const freshScan = () => {
    const value = scanWallpapers(config);
    scanCache = { at: Date.now(), value };
    return value;
  };

  const cachedScan = () => {
    if (Date.now() - scanCache.at > SCAN_TTL_MS || scanCache.value === null) return freshScan();
    return scanCache.value;
  };

  const wallpaperMap = () => {
    const map = new Map();
    for (const wp of cachedScan()) map.set(wp.id, wp);
    return map;
  };

  const disposers = [
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-wallpaper/list',
      handler: (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' });
          response.end();
          return;
        }
        const wallpapers = freshScan().map((wp) => ({
          id: wp.id,
          title: wp.title,
          type: wp.type,
          source: wp.source,
          hasVideo: wp.hasVideo,
          hasImage: wp.hasImage,
          preview: `/dsh-wallpaper/preview/${encodeURIComponent(wp.id)}`,
          // Prefer the scene-package texture when one exists (in that case the
          // standalone `file` is only the small preview); otherwise the
          // standalone image/video file.
          file: wp.pkg
            ? `/dsh-wallpaper/pkgimage/${encodeURIComponent(wp.id)}`
            : wp.file
              ? `/dsh-wallpaper/file/${encodeURIComponent(wp.id)}`
              : null,
        }));
        const sources = detectSources(config);
        sendJson(response, 200, {
          wallpapers,
          sources,
          engineFound: sources.workshopDirs.length > 0 || sources.projectDirs.length > 0,
        });
      },
    }),
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-wallpaper/config',
      handler: async (request, response) => {
        if (request.method === 'GET') {
          sendJson(response, 200, { state: readState() });
          return;
        }
        if (request.method === 'POST') {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'untrusted origin' });
            return;
          }
          try {
            const body = await readJsonBody(request);
            const state = readState();

            if (body.id === null || body.id === undefined || body.id === '') {
              state.id = null;
            } else if (typeof body.id === 'string') {
              if (!wallpaperMap().has(body.id)) {
                sendJson(response, 400, { error: `unknown wallpaper id: ${body.id}` });
                return;
              }
              state.id = body.id;
            }

            if (typeof body.dim === 'number' && Number.isFinite(body.dim)) {
              state.dim = Math.min(1, Math.max(0, body.dim));
            }
            if (typeof body.overlay === 'number' && Number.isFinite(body.overlay)) {
              state.overlay = Math.min(0.6, Math.max(0, body.overlay));
            }
            if (body.fit === 'cover' || body.fit === 'contain') {
              state.fit = body.fit;
            }

            writeState(state);
            sendJson(response, 200, { ok: true, state });
          } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        response.writeHead(405, { allow: 'GET, POST' });
        response.end();
      },
    }),
    host.webServer.register({
      kind: 'prefix',
      path: '/dsh-wallpaper/preview',
      handler: (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD' });
          response.end();
          return;
        }
        const id = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname.slice('/dsh-wallpaper/preview/'.length));
        const wp = wallpaperMap().get(id);
        if (!wp || !wp.preview || !existsSync(wp.preview)) {
          response.writeHead(404);
          response.end('not found');
          return;
        }
        serveFile(response, request, wp.preview);
      },
    }),
    host.webServer.register({
      kind: 'prefix',
      path: '/dsh-wallpaper/file',
      handler: (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD' });
          response.end();
          return;
        }
        const id = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname.slice('/dsh-wallpaper/file/'.length));
        const wp = wallpaperMap().get(id);
        if (!wp || !wp.file || !existsSync(wp.file)) {
          response.writeHead(404);
          response.end('not found');
          return;
        }
        serveFile(response, request, wp.file);
      },
    }),
    host.webServer.register({
      kind: 'prefix',
      path: '/dsh-wallpaper/pkgimage',
      handler: (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD' });
          response.end();
          return;
        }
        const id = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname.slice('/dsh-wallpaper/pkgimage/'.length));
        const wp = wallpaperMap().get(id);
        if (!wp || !wp.pkg || !existsSync(wp.pkg)) {
          response.writeHead(404);
          response.end('not found');
          return;
        }
        let extracted;
        try {
          extracted = extractPkgImage(wp.pkg, id);
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        if (!extracted || !existsSync(extracted)) {
          response.writeHead(404);
          response.end('no embedded image');
          return;
        }
        serveFile(response, request, extracted);
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

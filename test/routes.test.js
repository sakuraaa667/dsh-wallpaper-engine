import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountRoutes } from '../lib/routes.js';

/** Minimal webServer stand-in that captures registered routes. */
function mockHost() {
  const routes = [];
  return {
    webServer: {
      register(route) {
        routes.push(route);
        return () => { };
      },
    },
    _routes: routes,
  };
}

function mockRes() {
  const out = { status: 0, headers: {}, body: '' };
  return {
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers ?? {};
    },
    end(body) {
      out.body = body ?? '';
    },
    get status() { return out.status; },
    get body() { return out.body; },
    get headers() { return out.headers; },
  };
}

function json(req, res) {
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

function makeWorkshop() {
  const root = mkdtempSync(join(tmpdir(), 'wp-route-'));
  const workshop = join(root, '431960');
  mkdirSync(workshop, { recursive: true });
  const wp = join(workshop, '2001');
  mkdirSync(wp);
  writeFileSync(join(wp, 'project.json'), JSON.stringify({
    title: 'Route Test', type: 'scene', file: 'scene.json', preview: 'preview.jpg',
  }));
  writeFileSync(join(wp, 'preview.jpg'), Buffer.alloc(32));
  return root;
}

test('mountRoutes registers the list/config/preview/file routes', () => {
  const host = mockHost();
  mountRoutes(host, {});
  const paths = host._routes.map((r) => `${r.kind}:${r.path}`);
  for (const expected of [
    'exact:/dsh-wallpaper/list',
    'exact:/dsh-wallpaper/config',
    'prefix:/dsh-wallpaper/preview',
    'prefix:/dsh-wallpaper/file',
  ]) {
    assert.ok(paths.includes(expected), `missing route ${expected}`);
  }
});

test('/dsh-wallpaper/list returns scanned wallpapers', () => {
  const root = makeWorkshop();
  try {
    const host = mockHost();
    mountRoutes(host, { workshopDir: join(root, '431960') });
    const list = host._routes.find((r) => r.path === '/dsh-wallpaper/list');
    const req = { method: 'GET', url: '/dsh-wallpaper/list', headers: {} };
    const res = mockRes();
    list.handler(req, res);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    // The fixture wallpaper is present (the machine may also expose its own
    // real Wallpaper Engine sources, so the total count varies).
    const mine = body.wallpapers.find((w) => w.id === 'workshop:2001');
    assert.ok(mine, 'fixture wallpaper missing');
    assert.equal(mine.title, 'Route Test');
    assert.equal(body.engineFound, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('/dsh-wallpaper/config GET returns empty state initially', () => {
  const root = makeWorkshop();
  const prevHome = process.env.DSH_HOME;
  try {
    // Isolate persistence so the test never reads the machine's real state.
    process.env.DSH_HOME = root;
    const host = mockHost();
    mountRoutes(host, { workshopDir: join(root, '431960') });
    const cfg = host._routes.find((r) => r.path === '/dsh-wallpaper/config');
    const req = { method: 'GET', url: '/dsh-wallpaper/config', headers: {} };
    const res = mockRes();
    cfg.handler(req, res);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body).state, {});
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown preview id returns 404', () => {
  const root = makeWorkshop();
  try {
    const host = mockHost();
    mountRoutes(host, { workshopDir: join(root, '431960') });
    const preview = host._routes.find((r) => r.path === '/dsh-wallpaper/preview');
    const req = { method: 'GET', url: '/dsh-wallpaper/preview/workshop%3A9999', headers: {} };
    const res = mockRes();
    preview.handler(req, res);
    assert.equal(res.status, 404);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

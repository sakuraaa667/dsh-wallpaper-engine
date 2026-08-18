import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanWallpapers, detectSources } from '../lib/scanner.js';

/** Build a fake workshop directory tree with a few wallpapers. */
function makeWorkshop() {
  const root = mkdtempSync(join(tmpdir(), 'wp-scan-'));
  const workshop = join(root, 'workshop', 'content', '431960');
  mkdirSync(workshop, { recursive: true });

  const scene = join(workshop, '1001');
  mkdirSync(scene);
  writeFileSync(join(scene, 'project.json'), JSON.stringify({
    title: 'Scene One', type: 'scene', file: 'scene.json', preview: 'preview.jpg',
  }));
  writeFileSync(join(scene, 'preview.jpg'), Buffer.alloc(16));

  const video = join(workshop, '1002');
  mkdirSync(video);
  writeFileSync(join(video, 'project.json'), JSON.stringify({
    title: 'Video One', type: 'video', file: 'clip.mp4', preview: 'preview.jpg',
  }));
  writeFileSync(join(video, 'preview.jpg'), Buffer.alloc(16));
  writeFileSync(join(video, 'clip.mp4'), Buffer.alloc(64));

  const web = join(workshop, '1003');
  mkdirSync(web);
  writeFileSync(join(web, 'project.json'), JSON.stringify({
    title: 'Web One', type: 'web', file: 'index.html', preview: 'preview.jpg',
  }));
  // two images: a small preview and a larger original — the larger must win
  writeFileSync(join(web, 'preview.jpg'), Buffer.alloc(100));
  writeFileSync(join(web, '1.jpg'), Buffer.alloc(10_000));

  const bare = join(workshop, '1004');
  mkdirSync(bare);
  writeFileSync(join(bare, 'wallpaper.png'), Buffer.alloc(8_000));

  return root;
}

test('detectSources honors workshopDir config', () => {
  const root = makeWorkshop();
  try {
    const workshop = join(root, 'workshop', 'content', '431960');
    const { workshopDirs } = detectSources({ workshopDir: workshop });
    // The configured dir is included (the machine may also expose its own
    // real Wallpaper Engine sources).
    assert.ok(workshopDirs.includes(workshop));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanWallpapers reads project.json metadata', () => {
  const root = makeWorkshop();
  try {
    const workshop = join(root, 'workshop', 'content', '431960');
    const list = scanWallpapers({ workshopDir: workshop });
    const byId = (id) => list.find((w) => w.id === `workshop:${id}`);
    assert.equal(byId('1001').title, 'Scene One');
    assert.equal(byId('1001').type, 'scene');
    assert.equal(byId('1001').hasVideo, false);
    assert.equal(byId('1002').hasVideo, true);
    assert.equal(byId('1002').type, 'video');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('image wallpapers prefer the highest-resolution standalone image', () => {
  const root = makeWorkshop();
  try {
    const workshop = join(root, 'workshop', 'content', '431960');
    const list = scanWallpapers({ workshopDir: workshop });
    const web = list.find((w) => w.id === 'workshop:1003');
    assert.ok(web.file.endsWith('1.jpg'), `expected 1.jpg, got ${web.file}`);
    assert.equal(web.hasImage, true);
    // bare wallpaper without project.json falls back to directory inspection
    const bare = list.find((w) => w.id === 'workshop:1004');
    assert.ok(bare.file.endsWith('wallpaper.png'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

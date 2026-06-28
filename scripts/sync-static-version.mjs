#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function main() {
  const version = process.env.WEB_STATIC_VERSION || await deriveVersion();

  await syncIndexHtml(version);
  await syncManifest(version);

  process.stdout.write(`${version}\n`);
}

async function deriveVersion() {
  const files = [
    'src/services/config.js',
    'src/main.js',
    'styles/critical.css',
    'src/pages/player.js',
    'src/pages/account.js',
    'src/pages/account-shell.js',
    'styles/account-shell.css',
    'src/services/library.js',
    'src/services/playback-progress.js',
    'src/services/library-sync-state.js',
    'src/services/media-images.js',
    'src/components/auth-modal.js',
    'sw.js',
  ];
  const parts = await Promise.all(files.map((file) => readText(file)));
  const digest = createHash('sha1');
  for (const part of parts) digest.update(part);
  return digest.digest('hex').slice(0, 12);
}

async function syncIndexHtml(version) {
  const path = resolve(root, 'index.html');
  let source = await readFile(path, 'utf8');

  source = source.replace(
    /(<meta property="og:image" content="https:\/\/guangying\.org\/icons\/icon-512\.png\?v=)[^"]+(")/,
    `$1${version}$2`,
  );
  source = source.replace(
    /(<meta name="twitter:image" content="https:\/\/guangying\.org\/icons\/icon-512\.png\?v=)[^"]+(")/,
    `$1${version}$2`,
  );
  source = source.replace(
    /(window\.GY_WEB_STATIC_VERSION = ')[^']+(';)/,
    `$1${version}$2`,
  );

  await writeFile(path, source);
}

async function syncManifest(version) {
  const path = resolve(root, 'manifest.json');
  const data = JSON.parse(await readFile(path, 'utf8'));

  const icon192 = `/icons/icon-192.png?v=${version}`;
  const icon512 = `/icons/icon-512.png?v=${version}`;
  const maskable192 = `/icons/icon-maskable-192.png?v=${version}`;
  const maskable512 = `/icons/icon-maskable.png?v=${version}`;

  data.icons = [
    { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: maskable192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  data.shortcuts = (data.shortcuts || []).map((shortcut) => ({
    ...shortcut,
    icons: [{ src: icon192, sizes: '192x192' }],
  }));

  await writeFile(path, `${JSON.stringify(data, null, 4)}\n`);
}

async function readText(relativePath) {
  return readFile(resolve(root, relativePath), 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

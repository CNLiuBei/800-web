#!/usr/bin/env node
/**
 * Plan incremental CDN uploads by comparing local file hashes to the last manifest.
 *
 * Usage:
 *   node scripts/plan-cdn-upload.mjs [--full] [--dry-run] [--dir src] [--dir styles]
 *   node scripts/plan-cdn-upload.mjs --commit   # write manifest after successful uploads (reads stdin JSON)
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, '.cdn-publish-manifest.json');
const defaultDirs = ['src', 'styles', 'icons'];

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--commit')) {
    await commitManifest();
    return;
  }

  const full = args.includes('--full');
  const dryRun = args.includes('--dry-run');
  const dirs = readDirs(args);
  const manifest = full ? { version: 1, files: {} } : await loadManifest();
  const plan = [];

  for (const dir of dirs) {
    const absDir = resolve(root, dir);
    const files = await listFiles(absDir);
    for (const file of files) {
      const relFromRoot = relative(root, file).split('\\').join('/');
      const relInDir = relative(absDir, file).split('\\').join('/');
      const key = `static/web/${dir}/${relInDir}`;
      const hash = await fileHash(file);
      if (full || manifest.files[relFromRoot] !== hash) {
        plan.push({
          file,
          rel: relFromRoot,
          key,
          hash,
          cacheControl: dir === 'src'
            ? 'public, max-age=300, must-revalidate'
            : 'public, max-age=31536000, immutable',
        });
      }
    }
  }

  const payload = {
    dryRun,
    full,
    totalTracked: Object.keys(manifest.files).length,
    uploadCount: plan.length,
    skipCount: Math.max(0, await countFiles(dirs) - plan.length),
    plan,
    manifestPath,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function readDirs(args) {
  const dirs = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir' && args[i + 1]) {
      dirs.push(args[i + 1]);
      i += 1;
    }
  }
  return dirs.length ? dirs : defaultDirs;
}

async function loadManifest() {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.files === 'object') return data;
  } catch {
    // first publish or corrupt manifest
  }
  return { version: 1, files: {} };
}

async function listFiles(dir) {
  const out = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(path);
    }
  }
  await walk(dir);
  return out.sort();
}

async function countFiles(dirs) {
  let total = 0;
  for (const dir of dirs) {
    total += (await listFiles(resolve(root, dir))).length;
  }
  return total;
}

async function fileHash(file) {
  const buf = await readFile(file);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

async function commitManifest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const uploaded = JSON.parse(Buffer.concat(chunks).toString('utf8') || '[]');
  const manifest = await loadManifest();
  for (const item of uploaded) {
    if (item?.rel && item?.hash) manifest.files[item.rel] = item.hash;
  }
  manifest.updatedAt = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`manifest updated (${Object.keys(manifest.files).length} files)\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

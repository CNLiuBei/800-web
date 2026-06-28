#!/usr/bin/env node
/**
 * Incremental web static upload to R2 (src/, styles/, icons/).
 * Plans via hash manifest, uploads only changed objects, then commits manifest.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bucket = process.env.R2_BUCKET || 'flix-800-assets';
const concurrency = Number(process.env.CDN_UPLOAD_CONCURRENCY || 4);
const full = process.argv.includes('--full');
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const plan = await loadPlan();
  const { uploadCount, skipCount, plan: items } = plan;

  console.log(`CDN upload plan: ${uploadCount} to upload, ${skipCount} unchanged`);

  if (uploadCount === 0) {
    console.log('Nothing to upload.');
    return;
  }

  if (dryRun) {
    for (const item of items) console.log(`  would upload ${item.rel} -> ${item.key}`);
    return;
  }

  const uploaded = [];
  let index = 0;
  let failed = 0;

  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      const ok = await putObject(item);
      if (ok) uploaded.push({ rel: item.rel, hash: item.hash });
      else failed += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  if (failed > 0) {
    console.error(`Upload finished with ${failed} failure(s); manifest not updated.`);
    process.exit(1);
  }

  await commitManifest(uploaded);
  console.log(`Manifest updated (${uploaded.length} file(s) this run).`);
}

async function loadPlan() {
  const args = ['scripts/plan-cdn-upload.mjs'];
  if (full) args.push('--full');
  const raw = await execCapture('node', args, root);
  return JSON.parse(raw);
}

function mimeFor(file) {
  if (/\.(js|mjs)$/i.test(file)) return 'application/javascript; charset=utf-8';
  if (/\.css$/i.test(file)) return 'text/css; charset=utf-8';
  if (/\.json$/i.test(file)) return 'application/json; charset=utf-8';
  if (/\.svg$/i.test(file)) return 'image/svg+xml';
  if (/\.png$/i.test(file)) return 'image/png';
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg';
  if (/\.webp$/i.test(file)) return 'image/webp';
  if (/\.ico$/i.test(file)) return 'image/x-icon';
  if (/\.woff2$/i.test(file)) return 'font/woff2';
  if (/\.txt$/i.test(file)) return 'text/plain; charset=utf-8';
  if (/\.xml$/i.test(file)) return 'application/xml; charset=utf-8';
  return 'application/octet-stream';
}

async function putObject(item) {
  const contentType = mimeFor(item.file);
  console.log(`Publishing ${item.rel} -> r2://${bucket}/${item.key}`);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await exec('npx', [
        'wrangler', 'r2', 'object', 'put', `${bucket}/${item.key}`,
        '--remote',
        '--file', item.file,
        '--content-type', contentType,
        '--cache-control', item.cacheControl,
      ], root);
      return true;
    } catch (error) {
      if (attempt >= 4) {
        console.error(`  ✘ Failed after ${attempt} attempts: ${item.rel}`);
        return false;
      }
      console.log(`  ↩ Retry ${attempt}/3 after 5s...`);
      await sleep(5000);
    }
  }
  return false;
}

async function commitManifest(uploaded) {
  await exec('node', ['scripts/plan-cdn-upload.mjs', '--commit'], root, JSON.stringify(uploaded));
}

function exec(cmd, args, cwd, stdin) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'inherit', 'inherit'] });
    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
    child.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function execCapture(cmd, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

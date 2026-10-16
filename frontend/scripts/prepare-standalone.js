#!/usr/bin/env node
/**
 * Prepare the Next.js standalone output for the dev-compose bind-mount runner.
 *
 * The dev compose command runs `node .next/standalone/server.js`, which means
 * Next looks for static/public assets under `.next/standalone/.next/static`
 * and `.next/standalone/public`. `next build` writes these outside the
 * standalone directory, so copy them in automatically after every build.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcStatic = path.join(root, '.next', 'static');
const dstStatic = path.join(root, '.next', 'standalone', '.next', 'static');
const srcPublic = path.join(root, 'public');
const dstPublic = path.join(root, '.next', 'standalone', 'public');

if (!fs.existsSync(srcStatic)) {
  console.error('[prepare-standalone] .next/static not found; run `next build` first.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(dstStatic), { recursive: true });
fs.rmSync(dstStatic, { recursive: true, force: true });
fs.cpSync(srcStatic, dstStatic, { recursive: true });

fs.rmSync(dstPublic, { recursive: true, force: true });
fs.cpSync(srcPublic, dstPublic, { recursive: true });

console.log('[prepare-standalone] copied .next/static and public into standalone');

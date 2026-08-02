/**
 * Writes web/public/_redirects for Netlify.
 *
 * Set API_ORIGIN (no trailing slash) in Netlify env so /api and /health
 * are proxied to the Node backend. SPA fallback always comes last.
 *
 * Example: API_ORIGIN=https://api.yourdomain.com
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(rootDir, '../public');
const outFile = path.join(publicDir, '_redirects');

const apiOrigin = (process.env.API_ORIGIN ?? '').trim().replace(/\/$/, '');

const lines = [];

if (apiOrigin) {
  if (!/^https?:\/\//i.test(apiOrigin)) {
    console.error('API_ORIGIN must be an absolute http(s) URL, e.g. https://api.example.com');
    process.exit(1);
  }
  lines.push(`# Proxied to backend (API_ORIGIN)`);
  lines.push(`/api/*  ${apiOrigin}/api/:splat  200!`);
  lines.push(`/health  ${apiOrigin}/health  200!`);
} else {
  lines.push(`# No API_ORIGIN — set it on Netlify so /api proxies to your backend.`);
}

lines.push(`# SPA fallback`);
lines.push(`/*    /index.html   200`);
lines.push('');

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log(
  apiOrigin
    ? `Wrote Netlify redirects with API proxy → ${apiOrigin}`
    : 'Wrote Netlify SPA redirects (API_ORIGIN unset)',
);

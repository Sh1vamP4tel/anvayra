#!/usr/bin/env node
/*
 * Pre-deploy check for vercel.json route patterns.
 *
 * Vercel parses `rewrites[].source` and `headers[].source` with path-to-regexp.
 * It rejects nested capturing groups, e.g.
 *
 *     /assets/(.*\.(js|css))     <- deploy fails: invalid-route-source-pattern
 *
 * Use one rule per directory instead:
 *
 *     /assets/js/(.*)
 *
 * Run: node scripts/check-vercel-routes.mjs
 */

import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const errors = [];

function depthOfNestedGroup(pattern) {
  let depth = 0;
  let max = 0;
  let escaped = false;
  for (const ch of pattern) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '(') { depth += 1; max = Math.max(max, depth); }
    else if (ch === ')') { depth -= 1; if (depth < 0) return { unbalanced: true }; }
  }
  return { maxDepth: max, unbalanced: depth !== 0 };
}

const groups = [
  ['rewrites', cfg.rewrites || []],
  ['headers', cfg.headers || []],
  ['redirects', cfg.redirects || []],
];

for (const [section, rules] of groups) {
  rules.forEach((rule, i) => {
    const src = rule.source;
    if (typeof src !== 'string' || !src.startsWith('/')) {
      errors.push(`${section}[${i}] source must be an absolute path: ${JSON.stringify(src)}`);
      return;
    }
    const { maxDepth, unbalanced } = depthOfNestedGroup(src);
    if (unbalanced) errors.push(`${section}[${i}] unbalanced parentheses: ${src}`);
    else if (maxDepth > 1) errors.push(`${section}[${i}] nested regex group is rejected by Vercel: ${src}`);
  });
}

if (!cfg.buildCommand) errors.push('buildCommand is missing (frontend/ must be copied to dist/)');
if (cfg.outputDirectory !== 'dist') errors.push(`outputDirectory should be "dist", got ${JSON.stringify(cfg.outputDirectory)}`);

// The published bundle must never contain planning docs or backend source.
const forbidden = (cfg.rewrites || []).filter((r) => ['/docs', '/backend', '/supabase'].includes((r.source || '').split('/')[1] && '/' + (r.source || '').split('/')[1]));
for (const r of forbidden) {
  if (r.destination !== '/404.html') errors.push(`rewrite for ${r.source} must point at /404.html`);
}

if (errors.length) {
  console.error('vercel.json check failed:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`vercel.json ok: ${groups.reduce((n, [, r]) => n + r.length, 0)} route sources valid, outputDirectory=${cfg.outputDirectory}`);

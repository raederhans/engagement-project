#!/usr/bin/env node
// Normalize src/data/offense_groups.json to Object<string, string[]> with trimmed strings.

import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.join('src', 'data', 'offense_groups.json');

function stableStringify(obj) {
  const ordered = Object.keys(obj).sort().reduce((acc, k) => { acc[k] = obj[k]; return acc; }, {});
  return JSON.stringify(ordered, null, 2) + '\n';
}

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const logPath = path.join('logs', `fix_offense_groups_${ts}.log`);
  await fs.mkdir('logs', { recursive: true });
  let before, after, issues = [];
  try {
    const raw = await fs.readFile(SRC, 'utf8');
    before = JSON.parse(raw);
  } catch (e) {
    await fs.writeFile(logPath, `FAIL read: ${e?.message || e}`);
    console.error('Read failed:', e?.message || e);
    process.exit(0);
  }

  const out = {};
  for (const [k, v] of Object.entries(before || {})) {
    if (typeof v === 'string') {
      out[k] = [v.trim()].filter(Boolean);
    } else if (Array.isArray(v)) {
      out[k] = v.map(x => typeof x === 'string' ? x.trim() : String(x)).filter(Boolean);
    } else {
      issues.push(`Invalid type for ${k}: ${typeof v}`);
    }
  }

  const beforeCounts = Object.fromEntries(Object.keys(before || {}).sort().map(k => [k, Array.isArray(before[k]) ? before[k].length : (typeof before[k] === 'string' ? 1 : 0)]));
  const afterCounts = Object.fromEntries(Object.keys(out).sort().map(k => [k, Array.isArray(out[k]) ? out[k].length : 0]));
  const diffLines = [];
  for (const k of Object.keys({ ...beforeCounts, ...afterCounts }).sort()) {
    diffLines.push(`${k}: ${beforeCounts[k] ?? 0} -> ${afterCounts[k] ?? 0}`);
  }

  try {
    await fs.writeFile(SRC, stableStringify(out));
  } catch (e) {
    await fs.appendFile(logPath, `\nFAIL write: ${e?.message || e}`);
    console.error('Write failed:', e?.message || e);
    process.exit(0);
  }

  await fs.writeFile(logPath, `OK normalized offense_groups.json\n${diffLines.join('\n')}${issues.length ? `\nWARN issues: ${issues.join('; ')}` : ''}`);
  console.log(`Normalized offense groups. Log: ${logPath}`);
}

main();


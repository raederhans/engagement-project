#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';

import { isCadenceDue } from './lib/data_automation.mjs';

const options = parseArgs(process.argv.slice(2));
const date = options.date || new Date().toISOString().slice(0, 10);
const due = isCadenceDue(date, {
  anchor: options.anchor || '2026-08-03',
  intervalDays: Number(options.interval || 7),
});
const line = `due=${due}`;
console.log(line);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${line}\n`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--') || !args[index + 1]) throw new Error(`Invalid argument ${key}.`);
    parsed[key.slice(2)] = args[index + 1];
    index += 1;
  }
  return parsed;
}

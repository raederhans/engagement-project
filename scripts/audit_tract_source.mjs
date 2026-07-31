#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildTractSourceAudit,
  formatTractSourceAudit,
} from './lib/data_automation.mjs';

const options = parseArgs(process.argv.slice(2));
const contractFile = options.contract || path.join('scripts', 'data', 'tract_source_contract.json');
const localFile = options.local || path.join('public', 'data', 'tracts_phl.geojson');
const contract = JSON.parse(await readFile(contractFile, 'utf8'));
const localTracts = JSON.parse(await readFile(localFile, 'utf8'));
const serviceUrl = contract.service_url.replace(/\/$/, '');
const query = new URL(`${serviceUrl}/${contract.current_layer_id}/query`);
query.search = new URLSearchParams({
  where: `STATE='${contract.state_fips}' AND COUNTY='${contract.county_fips}'`,
  outFields: 'GEOID',
  returnGeometry: 'false',
  f: 'geojson',
}).toString();

const [serviceMetadata, layerMetadata, remoteTracts] = await Promise.all([
  fetchJson(`${serviceUrl}?f=pjson`),
  fetchJson(`${serviceUrl}/${contract.current_layer_id}?f=pjson`),
  fetchJson(query),
]);
const report = buildTractSourceAudit({
  contract,
  localTracts,
  remoteTracts,
  serviceMetadata,
  layerMetadata,
});
const markdown = formatTractSourceAudit(report);

if (options.json) await writeOutput(options.json, `${JSON.stringify(report, null, 2)}\n`);
if (options.markdown) await writeOutput(options.markdown, markdown);
console.log(markdown);
if (report.status !== 'stable') process.exitCode = 2;

async function fetchJson(url, { attempts = 2, timeoutMs = 15_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json,application/geo+json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message || lastError}`);
}

async function writeOutput(destination, contents) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, 'utf8');
}

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

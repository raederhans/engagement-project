#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 5173;
const DIRECTORY_CANDIDATES = Object.freeze({
  segments: ['segments_phl.demo.geojson', 'segments.geojson'],
  routes: ['routes_phl.demo.geojson', 'routes.geojson'],
});

function readOption(argv, index, name) {
  const arg = argv[index];
  const prefix = `${name}=`;
  if (arg.startsWith(prefix)) return { value: arg.slice(prefix.length), consumed: 0 };
  if (arg !== name) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return { value, consumed: 1 };
}

export function parsePreviewArgs(argv = []) {
  const options = {
    data: '',
    segments: '',
    routes: '',
    host: 'localhost',
    port: DEFAULT_PORT,
    mode: 'diary',
    open: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--no-open') {
      options.open = false;
      continue;
    }

    let matched = false;
    for (const [name, key] of [
      ['--data', 'data'],
      ['--segments', 'segments'],
      ['--routes', 'routes'],
      ['--host', 'host'],
      ['--port', 'port'],
      ['--mode', 'mode'],
    ]) {
      const option = readOption(argv, index, name);
      if (!option) continue;
      options[key] = option.value;
      index += option.consumed;
      matched = true;
      break;
    }
    if (!matched) throw new Error(`Unknown option: ${arg}`);
  }

  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535');
  }
  if (!['diary', 'crime'].includes(options.mode)) {
    throw new Error('--mode must be either "diary" or "crime"');
  }
  return options;
}

function absolutePath(input, cwd) {
  return isAbsolute(input) ? input : resolve(cwd, input);
}

function readFeatureCollection(filePath, label) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} data at ${filePath}: ${error.message}`);
  }
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error(`${label} data must be a GeoJSON FeatureCollection: ${filePath}`);
  }
  return payload;
}

function classifyFeatureCollection(payload) {
  const properties = payload.features.find((feature) => feature?.properties)?.properties || {};
  return 'route_id' in properties || 'segment_ids' in properties ? 'routes' : 'segments';
}

function findDirectoryData(directory, kind) {
  for (const filename of DIRECTORY_CANDIDATES[kind]) {
    const candidate = resolve(directory, filename);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next supported filename.
    }
  }
  return '';
}

export function resolvePreviewData(options, cwd = process.cwd()) {
  const resolved = { segments: '', routes: '' };

  if (options.data) {
    const dataPath = absolutePath(options.data, cwd);
    let stats;
    try {
      stats = statSync(dataPath);
    } catch {
      throw new Error(`Data path does not exist: ${dataPath}`);
    }

    if (stats.isDirectory()) {
      resolved.segments = findDirectoryData(dataPath, 'segments');
      resolved.routes = findDirectoryData(dataPath, 'routes');
      if (!resolved.segments && !resolved.routes) {
        throw new Error(
          `No supported GeoJSON files found in ${dataPath}. ` +
          'Expected segments_phl.demo.geojson/routes_phl.demo.geojson or segments.geojson/routes.geojson.',
        );
      }
    } else if (stats.isFile()) {
      const payload = readFeatureCollection(dataPath, 'preview');
      resolved[classifyFeatureCollection(payload)] = dataPath;
    } else {
      throw new Error(`Data path is not a file or directory: ${dataPath}`);
    }
  }

  for (const kind of ['segments', 'routes']) {
    if (options[kind]) resolved[kind] = absolutePath(options[kind], cwd);
    if (resolved[kind]) readFeatureCollection(resolved[kind], kind);
  }

  return resolved;
}

export function toViteFsUrl(filePath) {
  return `/@fs/${resolve(filePath).replaceAll('\\', '/')}`;
}

function helpText() {
  return `Quick preview for engagement-project

Usage:
  npm run quick-preview
  npm run quick-preview -- --data ./data
  npm run quick-preview -- --segments ./my-segments.geojson --routes ./my-routes.geojson

Options:
  --data <path>       Data directory or a single GeoJSON FeatureCollection
  --segments <path>   Override the diary segments GeoJSON
  --routes <path>     Override the diary routes GeoJSON
  --mode <name>       diary (default) or crime
  --host <host>       Server host (default: localhost)
  --port <port>       Server port (default: 5173)
  --no-open           Do not open the browser
  --help              Show this help
`;
}

export async function startPreview(options, cwd = process.cwd()) {
  const data = resolvePreviewData(options, cwd);
  const { createServer } = await import('vite');
  if (data.segments) process.env.VITE_DIARY_SEGMENTS_URL = toViteFsUrl(data.segments);
  if (data.routes) process.env.VITE_DIARY_ROUTES_URL = toViteFsUrl(data.routes);
  if (options.mode === 'diary') process.env.VITE_FEATURE_DIARY = '1';

  const allowedRoots = [cwd, ...Object.values(data).filter(Boolean).map(dirname)];
  const page = options.mode === 'diary' ? '/?mode=diary' : '/';
  const server = await createServer({
    root: cwd,
    server: {
      host: options.host,
      port: options.port,
      strictPort: true,
      open: options.open ? page : false,
      fs: { allow: [...new Set(allowedRoots)] },
    },
  });

  await server.listen();
  console.log(`\nPreview mode: ${options.mode}`);
  if (data.segments) console.log(`Segments data: ${data.segments}`);
  if (data.routes) console.log(`Routes data: ${data.routes}`);
  server.printUrls();
  return server;
}

async function main() {
  try {
    const options = parsePreviewArgs(process.argv.slice(2));
    if (options.help) {
      console.log(helpText());
      return;
    }
    const server = await startPreview(options);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await server.close();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } catch (error) {
    console.error(`Quick preview failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();

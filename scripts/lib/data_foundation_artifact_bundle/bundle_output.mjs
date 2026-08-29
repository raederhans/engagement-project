import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeMaterializedBundleDirectory({ outputDir, bundle, registryContract }) {
  if (!outputDir || typeof outputDir !== 'string') throw new Error('Output directory is required.');
  if (!registryContract || typeof registryContract.serializeArtifactRegistry !== 'function') {
    throw new Error('ArtifactRegistry/v1 serializeArtifactRegistry() is required for bundle output.');
  }
  const resolved = path.resolve(outputDir);
  if (resolved === path.parse(resolved).root) throw new Error('Output directory cannot be a filesystem root.');
  if (await exists(resolved)) throw new Error(`Output directory already exists: ${resolved}`);
  const parent = path.dirname(resolved);
  await fs.mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(resolved)}.staging-${randomUUID()}`);
  await fs.mkdir(staging, { recursive: false });
  const files = {
    'bundle.json': `${JSON.stringify(bundle, null, 2)}\n`,
    'm1.registry.json': `${registryContract.serializeArtifactRegistry(bundle.inventories.m1.registry)}\n`,
    'm2.registry.json': `${registryContract.serializeArtifactRegistry(bundle.inventories.m2.registry)}\n`,
  };
  for (const [name, contents] of Object.entries(files)) {
    await fs.writeFile(path.join(staging, name), contents, { flag: 'wx' });
  }
  await fs.rename(staging, resolved);
  return { outputDir: resolved, files: Object.keys(files).sort() };
}

async function exists(target) {
  return Boolean(await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }));
}

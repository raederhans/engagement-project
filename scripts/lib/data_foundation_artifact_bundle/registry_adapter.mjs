import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadArtifactRegistryContract(modulePath = null) {
  const selected = modulePath || process.env.ARTIFACT_REGISTRY_MODULE
    || path.resolve(import.meta.dirname, '..', 'artifact_registry', 'index.mjs');
  const contract = await import(pathToFileURL(path.resolve(selected)).href);
  if (typeof contract.createArtifactRegistry !== 'function') {
    throw new Error('ArtifactRegistry/v1 contract does not export createArtifactRegistry().');
  }
  return contract;
}

export function createRegistryThrough(contract, core) {
  if (!contract || typeof contract.createArtifactRegistry !== 'function') {
    throw new Error('ArtifactRegistry/v1 contract is required to materialize a data-foundation bundle.');
  }
  return contract.createArtifactRegistry(core);
}

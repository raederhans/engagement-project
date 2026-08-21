import fs from 'node:fs/promises';
import path from 'node:path';

export async function assertTaskOwnedDfev1Path(value, {
  workspace = process.cwd(),
  label = 'DFEV1 path',
} = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a task-owned .dfev1 path inside the current worktree.`);
  }
  const workspaceRoot = path.resolve(workspace);
  const resolved = path.resolve(workspaceRoot, value);
  const relative = path.relative(workspaceRoot, resolved);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative
    || relative.startsWith('..')
    || path.isAbsolute(relative)
    || segments[0] !== '.dfev1'
    || segments.length < 2) {
    throw new Error(`${label} must be a task-owned .dfev1 path inside the current worktree.`);
  }
  const workspaceReal = await fs.realpath(workspaceRoot);
  const nearest = await nearestExistingPath(resolved);
  if (!isInsideOrEqual(workspaceReal, nearest.realPath)) {
    throw new Error(`${label} must not escape the current worktree through a symbolic link or junction.`);
  }
  return resolved;
}

async function nearestExistingPath(target) {
  let current = target;
  while (true) {
    try {
      return { lexicalPath: current, realPath: await fs.realpath(current) };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function isInsideOrEqual(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

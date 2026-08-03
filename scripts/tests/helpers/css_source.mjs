import { readFile } from 'node:fs/promises';

const IMPORT_PATTERN = /@import\s+(?:url\()?['"]([^'")]+)['"]\)?\s*;/g;

async function readCssTree(url, ancestors = []) {
  const href = url.href;
  if (ancestors.includes(href)) {
    throw new Error(`Circular stylesheet import: ${[...ancestors, href].join(' -> ')}`);
  }

  const source = await readFile(url, 'utf8');
  const nextAncestors = [...ancestors, href];
  let cursor = 0;
  let combined = '';

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    combined += source.slice(cursor, match.index);
    const specifier = match[1];
    if (/^(?:https?:|data:|\/\/)/i.test(specifier)) {
      combined += match[0];
    } else {
      combined += await readCssTree(new URL(specifier, url), nextAncestors);
    }
    cursor = match.index + match[0].length;
  }

  return `${combined}${source.slice(cursor)}`;
}

export function readProductCss() {
  return readCssTree(new URL('../../../src/style.css', import.meta.url));
}

import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';

const IDENTIFIER_START = /[A-Za-z_$]/u;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/u;
const REGEX_PREFIX_KEYWORDS = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of',
  'return', 'throw', 'typeof', 'void', 'yield',
]);
const REGEX_PREFIX_PUNCTUATORS = new Set([
  '(', '[', '{', ':', ';', ',', '=', '!', '?', '&', '|', '+', '-', '*',
  '%', '^', '~', '<', '>',
]);
const PRODUCT_DIRECT_IMPORTS = Object.freeze(new Map([
  ['../../src/route_decision/evaluator/search_v2.js', '/src/route_decision/evaluator/search_v2.js'],
  ['../../src/route_generation/candidate_search/index.js', '/src/route_generation/candidate_search/index.js'],
]));
const PRODUCT_FORBIDDEN_PATHS = /(?:\/scripts\/lib\/route_graph_candidate\/|\/src\/route_decision\/contracts\/scenario_cohort_v1\.js$|\/scripts\/tests\/)/u;
const DIRECT_RUNTIME_LOADER_NAMES = new Set([
  'require', 'createRequire', 'eval', 'Function', 'AsyncFunction',
]);
const ORACLE_FORBIDDEN_CAPABILITIES = new Set([
  'process', 'global', 'globalThis',
  'require', 'createRequire',
  'eval', 'Function', 'AsyncFunction',
  'Reflect', 'constructor', '__proto__', 'prototype',
  'getPrototypeOf', 'setPrototypeOf',
  'Deno', 'Bun', 'module', 'exports',
  'window', 'self', 'document', 'Worker', 'SharedWorker',
  'WebAssembly', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport',
  'setTimeout', 'setInterval',
]);

function fail(message) {
  throw new TypeError(`route S3 import boundary: ${message}`);
}

class ModuleTokenizer {
  constructor(source, label) {
    this.source = source;
    this.label = label;
    this.cursor = 0;
  }

  tokenize(stopAtClosingBrace = false) {
    const tokens = [];
    let braceDepth = 0;
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor];
      if (/\s/u.test(character)) {
        this.cursor += 1;
        continue;
      }
      if (character === '/' && this.source[this.cursor + 1] === '/') {
        this.skipLineComment();
        continue;
      }
      if (character === '/' && this.source[this.cursor + 1] === '*') {
        this.skipBlockComment();
        continue;
      }
      if (character === '/' && this.startsRegex(tokens.at(-1))) {
        this.skipRegexLiteral();
        tokens.push({ type: 'regex', value: null });
        continue;
      }
      if (character === "'" || character === '"') {
        tokens.push({ type: 'string', value: this.readQuotedString(character) });
        continue;
      }
      if (character === '`') {
        tokens.push({ type: 'template', value: null });
        tokens.push(...this.readTemplateExpressions());
        continue;
      }
      if (IDENTIFIER_START.test(character)) {
        tokens.push({ type: 'identifier', value: this.readIdentifier() });
        continue;
      }
      if (character === '\\') {
        fail(`${this.label} contains an escaped code token that is not statically auditable`);
      }
      if (character === '{') {
        braceDepth += 1;
        tokens.push({ type: 'punctuator', value: character });
        this.cursor += 1;
        continue;
      }
      if (character === '}') {
        if (stopAtClosingBrace && braceDepth === 0) {
          this.cursor += 1;
          return tokens;
        }
        braceDepth -= 1;
        if (braceDepth < 0) fail(`${this.label} contains an unmatched closing brace`);
        tokens.push({ type: 'punctuator', value: character });
        this.cursor += 1;
        continue;
      }
      tokens.push({ type: 'punctuator', value: character });
      this.cursor += 1;
    }
    if (stopAtClosingBrace) fail(`${this.label} contains an unterminated template expression`);
    return tokens;
  }

  skipLineComment() {
    this.cursor += 2;
    while (this.cursor < this.source.length && !['\n', '\r'].includes(this.source[this.cursor])) {
      this.cursor += 1;
    }
  }

  skipBlockComment() {
    const end = this.source.indexOf('*/', this.cursor + 2);
    if (end < 0) fail(`${this.label} contains an unterminated block comment`);
    this.cursor = end + 2;
  }

  startsRegex(previous) {
    if (!previous) return true;
    if (previous.type === 'identifier') return REGEX_PREFIX_KEYWORDS.has(previous.value);
    return previous.type === 'punctuator' && REGEX_PREFIX_PUNCTUATORS.has(previous.value);
  }

  skipRegexLiteral() {
    this.cursor += 1;
    let inCharacterClass = false;
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor];
      if (character === '\\') {
        this.cursor += 2;
        continue;
      }
      if (character === '[') inCharacterClass = true;
      else if (character === ']') inCharacterClass = false;
      else if (character === '/' && !inCharacterClass) {
        this.cursor += 1;
        while (/[A-Za-z]/u.test(this.source[this.cursor] ?? '')) this.cursor += 1;
        return;
      }
      if (['\n', '\r'].includes(character)) fail(`${this.label} contains an unterminated regex literal`);
      this.cursor += 1;
    }
    fail(`${this.label} contains an unterminated regex literal`);
  }

  readQuotedString(quote) {
    this.cursor += 1;
    let value = '';
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor];
      if (character === quote) {
        this.cursor += 1;
        return value;
      }
      if (character === '\\') {
        const escaped = this.source[this.cursor + 1];
        if (escaped === undefined) fail(`${this.label} contains an unterminated string escape`);
        const simpleEscapes = {
          "'": "'", '"': '"', '\\': '\\', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0',
        };
        if (Object.hasOwn(simpleEscapes, escaped)) {
          value += simpleEscapes[escaped];
          this.cursor += 2;
          continue;
        }
        if (escaped === '\n') {
          this.cursor += 2;
          continue;
        }
        if (escaped === '\r') {
          this.cursor += this.source[this.cursor + 2] === '\n' ? 3 : 2;
          continue;
        }
        if (escaped === 'x') {
          const digits = this.source.slice(this.cursor + 2, this.cursor + 4);
          if (!/^[0-9a-f]{2}$/iu.test(digits)) fail(`${this.label} contains an invalid hexadecimal escape`);
          value += String.fromCodePoint(Number.parseInt(digits, 16));
          this.cursor += 4;
          continue;
        }
        if (escaped === 'u') {
          const braced = this.source[this.cursor + 2] === '{';
          const end = braced ? this.source.indexOf('}', this.cursor + 3) : this.cursor + 6;
          const digits = braced
            ? this.source.slice(this.cursor + 3, end)
            : this.source.slice(this.cursor + 2, end);
          const validDigits = braced ? /^[0-9a-f]{1,6}$/iu : /^[0-9a-f]{4}$/iu;
          if (end < 0 || !validDigits.test(digits)) fail(`${this.label} contains an invalid Unicode escape`);
          const codePoint = Number.parseInt(digits, 16);
          if (codePoint > 0x10ffff) fail(`${this.label} contains an out-of-range Unicode escape`);
          value += String.fromCodePoint(codePoint);
          this.cursor = braced ? end + 1 : end;
          continue;
        }
        fail(`${this.label} contains an unsupported string escape`);
      }
      if (['\n', '\r'].includes(character)) fail(`${this.label} contains an unterminated string literal`);
      value += character;
      this.cursor += 1;
    }
    fail(`${this.label} contains an unterminated string literal`);
  }

  readTemplateExpressions() {
    const expressionTokens = [];
    this.cursor += 1;
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor];
      if (character === '\\') {
        this.cursor += 2;
        continue;
      }
      if (character === '`') {
        this.cursor += 1;
        return expressionTokens;
      }
      if (character === '$' && this.source[this.cursor + 1] === '{') {
        this.cursor += 2;
        expressionTokens.push(...this.tokenize(true));
        continue;
      }
      this.cursor += 1;
    }
    fail(`${this.label} contains an unterminated template literal`);
  }

  readIdentifier() {
    const start = this.cursor;
    this.cursor += 1;
    while (IDENTIFIER_PART.test(this.source[this.cursor] ?? '')) this.cursor += 1;
    return this.source.slice(start, this.cursor);
  }
}

function dependency(kind, specifier) {
  return { kind, specifier, loader: null };
}

function runtimeLoaderDependency(loader, specifier) {
  return { kind: 'runtime-loader', specifier, loader };
}

function callOpenIndex(tokens, index) {
  if (tokens[index + 1]?.value === '(') return index + 1;
  if (tokens[index + 1]?.value === '?'
    && tokens[index + 2]?.value === '.'
    && tokens[index + 3]?.value === '(') return index + 3;
  return -1;
}

function matchingClosingParenthesis(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === '(') depth += 1;
    else if (tokens[index].value === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isMethodDeclaration(tokens, index, openIndex) {
  if (tokens[index - 1]?.value === 'function') return true;
  const closeIndex = matchingClosingParenthesis(tokens, openIndex);
  return closeIndex >= 0 && tokens[closeIndex + 1]?.value === '{';
}

function runtimeLoaderAt(tokens, index) {
  const token = tokens[index];
  if (token.type !== 'identifier') return null;
  let loader = null;
  if (DIRECT_RUNTIME_LOADER_NAMES.has(token.value)) loader = token.value;
  else if (token.value === 'getBuiltinModule'
    && tokens[index - 1]?.value === '.'
    && tokens[index - 2]?.value === 'process') loader = 'process.getBuiltinModule';
  else if (token.value === 'resolve'
    && tokens[index - 1]?.value === '.'
    && tokens[index - 2]?.value === 'meta'
    && tokens[index - 3]?.value === '.'
    && tokens[index - 4]?.value === 'import') loader = 'import.meta.resolve';
  if (!loader) return null;
  const openIndex = callOpenIndex(tokens, index);
  if (openIndex < 0 || isMethodDeclaration(tokens, index, openIndex)) return null;
  const firstArgument = tokens[openIndex + 1];
  return runtimeLoaderDependency(
    loader,
    firstArgument?.type === 'string' ? firstArgument.value : '<non-literal>',
  );
}

function parseImport(tokens, index, label) {
  const next = tokens[index + 1];
  if (next?.value === '.') return { dependencies: [], nextIndex: index + 1 };
  if (next?.value === '(') {
    const argument = tokens[index + 2];
    if (argument?.type !== 'string' || tokens[index + 3]?.value !== ')') {
      fail(`${label} contains a non-literal dynamic import`);
    }
    return {
      dependencies: [dependency('dynamic-import', argument.value)],
      nextIndex: index + 2,
    };
  }
  if (next?.type === 'string') {
    return { dependencies: [dependency('side-effect-import', next.value)], nextIndex: index + 1 };
  }
  let braceDepth = 0;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.value === '{') braceDepth += 1;
    else if (token.value === '}') braceDepth -= 1;
    else if (token.value === ';' && braceDepth === 0) break;
    else if (token.type === 'identifier' && token.value === 'from' && braceDepth === 0) {
      const specifier = tokens[cursor + 1];
      if (specifier?.type !== 'string') fail(`${label} contains a non-literal static import`);
      return { dependencies: [dependency('static-import', specifier.value)], nextIndex: cursor + 1 };
    }
  }
  fail(`${label} contains an unsupported import form`);
}

function parseExport(tokens, index, label) {
  const next = tokens[index + 1];
  if (!next || !['*', '{'].includes(next.value)) return { dependencies: [], nextIndex: index };
  let cursor = index + 1;
  let braceDepth = 0;
  for (; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.value === '{') braceDepth += 1;
    else if (token.value === '}') braceDepth -= 1;
    else if (token.value === ';' && braceDepth === 0) break;
    else if (token.type === 'identifier' && token.value === 'from' && braceDepth === 0) {
      const specifier = tokens[cursor + 1];
      if (specifier?.type !== 'string') fail(`${label} contains a non-literal export-from`);
      return { dependencies: [dependency('export-from', specifier.value)], nextIndex: cursor + 1 };
    }
  }
  return { dependencies: [], nextIndex: cursor };
}

function forbiddenCapabilityReferences(tokens) {
  const references = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token.value === '['
      && tokens[tokenIndex + 1]?.type === 'string'
      && tokens[tokenIndex + 2]?.value === ']'
      && ORACLE_FORBIDDEN_CAPABILITIES.has(tokens[tokenIndex + 1].value)) {
      references.push(Object.freeze({
        capability: tokens[tokenIndex + 1].value,
        tokenIndex: tokenIndex + 1,
      }));
    }
    if (token.type !== 'identifier') continue;
    if (token.value === 'import'
      && tokens[tokenIndex + 1]?.value === '.'
      && tokens[tokenIndex + 2]?.value === 'meta') {
      references.push(Object.freeze({ capability: 'import.meta', tokenIndex }));
    }
    if (ORACLE_FORBIDDEN_CAPABILITIES.has(token.value)) {
      references.push(Object.freeze({ capability: token.value, tokenIndex }));
    }
  }
  return Object.freeze(references);
}

export function analyzeRouteS3ModuleSource(source, label = 'module source') {
  const tokens = new ModuleTokenizer(source, label).tokenize();
  const dependencies = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    const runtimeLoader = runtimeLoaderAt(tokens, index);
    if (runtimeLoader) dependencies.push(runtimeLoader);
    let parsed;
    if (tokens[index - 1]?.value === '.' || tokens[index + 1]?.value === ':') continue;
    if (token.value === 'import') parsed = parseImport(tokens, index, label);
    else if (token.value === 'export') parsed = parseExport(tokens, index, label);
    else continue;
    dependencies.push(...parsed.dependencies);
    index = parsed.nextIndex;
  }
  return Object.freeze({
    dependencies: Object.freeze(dependencies.map(Object.freeze)),
    forbiddenCapabilities: forbiddenCapabilityReferences(tokens),
  });
}

export function parseRouteS3ModuleDependencies(source, label = 'module source') {
  return analyzeRouteS3ModuleSource(source, label).dependencies;
}

async function existingFile(path) {
  try {
    return (await stat(path)).isFile() ? await realpath(path) : null;
  } catch {
    return null;
  }
}

async function resolveLocalSpecifier(importer, specifier) {
  if (!specifier.startsWith('.') && !isAbsolute(specifier)) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.mjs`, resolve(base, 'index.js'), resolve(base, 'index.mjs')];
  for (const candidate of candidates) {
    const found = await existingFile(candidate);
    if (found) return found;
  }
  fail(`cannot resolve local module ${specifier} imported by ${importer}`);
}

export async function collectStaticImportClosure(entryPath) {
  const entry = await realpath(resolve(entryPath));
  const visited = new Set();
  const edges = [];
  const capabilityReferences = [];
  const pending = [entry];
  while (pending.length > 0) {
    const importer = pending.pop();
    if (visited.has(importer)) continue;
    visited.add(importer);
    const source = await readFile(importer, 'utf8');
    const analysis = analyzeRouteS3ModuleSource(source, importer);
    for (const reference of analysis.forbiddenCapabilities) {
      capabilityReferences.push(Object.freeze({ file: importer, ...reference }));
    }
    const dependencies = analysis.dependencies;
    for (const { kind, specifier, loader } of dependencies) {
      const imported = kind === 'runtime-loader'
        ? null
        : await resolveLocalSpecifier(importer, specifier);
      edges.push(Object.freeze({ importer, kind, specifier, loader, imported }));
      if (imported && !visited.has(imported)) pending.push(imported);
    }
  }
  return Object.freeze({
    entry,
    files: Object.freeze([...visited].sort()),
    edges: Object.freeze(edges),
    capabilityReferences: Object.freeze(capabilityReferences),
  });
}

export function assertRouteS3OracleImportBoundary(closure) {
  if (closure.files.length !== 1 || closure.files[0] !== closure.entry
    || closure.edges.length !== 0 || closure.capabilityReferences.length !== 0) {
    fail('oracle must have empty dependency edges and forbidden capability references');
  }
  return closure;
}

export function assertRouteS3ProductAdapterImportBoundary(closure) {
  const directCapabilities = closure.capabilityReferences.filter(({ file }) => file === closure.entry);
  if (directCapabilities.length > 0) {
    fail(`product adapter entry references a forbidden capability: ${directCapabilities[0].capability}`);
  }
  const directEdges = closure.edges.filter(({ importer }) => importer === closure.entry);
  if (directEdges.length !== PRODUCT_DIRECT_IMPORTS.size) {
    fail('product adapter direct import count drifted');
  }
  for (const edge of directEdges) {
    const expectedTarget = PRODUCT_DIRECT_IMPORTS.get(edge.specifier);
    const normalizedTarget = normalizeBoundaryPath(edge.imported);
    if (edge.kind !== 'static-import' || !expectedTarget || !normalizedTarget?.endsWith(expectedTarget)) {
      fail(`product adapter direct import is not allowed: ${edge.specifier}`);
    }
  }
  for (const file of closure.files) {
    const normalizedFile = normalizeBoundaryPath(file);
    const forbiddenS3Library = normalizedFile !== normalizeBoundaryPath(closure.entry)
      && normalizedFile.includes('/scripts/lib/route_s3_');
    if (forbiddenS3Library || PRODUCT_FORBIDDEN_PATHS.test(normalizedFile)) {
      fail(`product adapter recursive closure crosses a forbidden boundary: ${file}`);
    }
  }
  const unresolvedEdges = closure.edges.filter(({ imported }) => imported === null);
  if (unresolvedEdges.length > 0) {
    fail(`product adapter closure contains an unresolved or runtime-loader dependency: ${unresolvedEdges[0].specifier}`);
  }
  return closure;
}

function normalizeBoundaryPath(path) {
  if (path === null || path === undefined) return null;
  const normalized = path.replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

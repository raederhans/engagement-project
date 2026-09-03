import { readFile } from 'node:fs/promises';
import { Linter } from 'eslint';

export function parseModuleDependencies(source, filename = 'module.js') {
  const dependencies = { static: [], dynamic: [] };
  const captureRule = {
    create() {
      return {
        ImportDeclaration(node) {
          dependencies.static.push(node.source.value);
        },
        ExportNamedDeclaration(node) {
          if (node.source) dependencies.static.push(node.source.value);
        },
        ExportAllDeclaration(node) {
          dependencies.static.push(node.source.value);
        },
        ImportExpression(node) {
          if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
            dependencies.dynamic.push(node.source.value);
          }
        },
      };
    },
  };
  const messages = new Linter().verify(source, [{
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { dependencies: { rules: { capture: captureRule } } },
    rules: { 'dependencies/capture': 'error' },
  }], { filename: 'module.js' });
  const parseError = messages.find((message) => message.fatal);
  if (parseError) {
    throw new SyntaxError(`${filename}:${parseError.line}:${parseError.column} ${parseError.message}`);
  }
  return dependencies;
}

export async function readModuleDependencies(url) {
  const source = await readFile(url, 'utf8');
  return parseModuleDependencies(source, url.pathname);
}

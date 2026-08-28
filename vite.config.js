const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS === 'true' && repositoryName
  ? `/${repositoryName}/`
  : '/';

const compactBuiltHtml = {
  name: 'compact-built-html',
  apply: 'build',
  transformIndexHtml(html) {
    // Preserve line breaks (and therefore text-node spacing) while removing
    // source-only indentation from the production shell.
    return html.replace(/^[\t ]+/gm, '');
  },
};

export default {
  base,
  plugins: [compactBuiltHtml],
  build: { outDir: 'dist' },
};

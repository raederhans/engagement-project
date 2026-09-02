const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS === 'true' && repositoryName
  ? `/${repositoryName}/`
  : '/';

const compactBuiltHtml = {
  name: 'compact-built-html',
  apply: 'build',
  transformIndexHtml(html) {
    // Static shell separation is CSS-owned; inter-tag source whitespace is not content.
    return html.replace(/>\s+</g, '><').trim();
  },
};

export default {
  base,
  plugins: [compactBuiltHtml],
  build: { outDir: 'dist' },
};

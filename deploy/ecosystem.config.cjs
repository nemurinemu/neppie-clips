const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'neppie-api',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/index.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'neppie-fetcher',
      cwd: path.join(root, 'apps/fetcher'),
      script: 'dist/index.js',
      env: { NODE_ENV: 'production' },
    },
  ],
};

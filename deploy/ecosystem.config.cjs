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
    {
      name: 'neppie-twitch',
      cwd: path.join(root, 'apps/fetcher'),
      script: 'dist/twitch/index.js',
      // yt-dlp needs deno to solve YouTube's JS challenges.
      env: { NODE_ENV: 'production', PATH: `${path.join(require('node:os').homedir(), '.deno/bin')}:${process.env.PATH}` },
    },
  ],
};

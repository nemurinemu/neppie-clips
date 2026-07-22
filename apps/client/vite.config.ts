import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

const withScheme = (target?: string) => {
  const t = target?.trim();
  if (!t) return undefined;
  return /^https?:\/\//.test(t) ? t : `http://${t}`;
};

const publicFiles = (subdir: string, extRe: RegExp) => {
  const dir = path.resolve(process.cwd(), 'public', subdir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => extRe.test(f))
    .map((f) => `/${subdir}/${f}`);
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = withScheme(env.VITE_DEV_PROXY_TARGET);

  return {
    plugins: [vue()],
    define: {
      __PEEK_IMAGES__: JSON.stringify(
        publicFiles('peek', /\.(png|jpe?g|webp|gif|avif)$/i),
      ),
      __PEEK_SOUNDS__: JSON.stringify(
        publicFiles('sounds', /\.(mp3|ogg|wav|m4a|flac|webm)$/i),
      ),
    },
    server: target
      ? {
          proxy: {
            '/api': { target, changeOrigin: true },
            '/media': { target, changeOrigin: true },
          },
        }
      : undefined,
  };
});

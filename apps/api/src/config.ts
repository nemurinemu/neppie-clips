import dotenv from 'dotenv';
import path from 'node:path';
import fs, { constants } from 'node:fs';
import z from 'zod';

const nodeEnv = process.env.NODE_ENV ?? 'development';
dotenv.config({
  path: `.env.${nodeEnv}`,
});

const emptyToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;
const numeric = z.preprocess(emptyToUndefined, z.coerce.number());
const requiredString = z.string().trim().nonempty();
const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().optional(),
);

const envSchema = z.object({
  PORT: numeric,
  CLIPS_DIR: requiredString,
  CORS_ORIGIN: optionalString,
});

const validateConfig = () => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      'Failed parsing environment variables:',
      z.flattenError(parsed.error).fieldErrors,
    );
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
};

const validateReadable = (target: string, label: string) => {
  try {
    fs.accessSync(target, constants.R_OK);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      throw new Error(`No ${label} found at ${target}`);
    }
    throw new Error(`No read access to directory at ${target}`);
  }
};

const validateWritableDir = (dir: string, label: string) => {
  try {
    fs.accessSync(dir, constants.W_OK);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      throw new Error(`No ${label} found at ${dir}`);
    }
    throw new Error(`No write access to ${label} at ${dir}`);
  }
};

export const initConfig = () => {
  const env = validateConfig();
  const paths = {
    clipsDir: path.resolve(env.CLIPS_DIR, 'videos'),
    thumbsDir: path.resolve(env.CLIPS_DIR, 'thumbnails'),
    dbPath: path.resolve(env.CLIPS_DIR, 'videos.db'),
  };
  validateReadable(paths.dbPath, 'database');
  validateReadable(paths.clipsDir, 'clips directory');
  validateReadable(paths.thumbsDir, 'thumbnails directory');
  validateWritableDir(path.dirname(paths.dbPath), 'database directory');

  return {
    nodeEnv,
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN ?? '',
    ...paths,
  };
};

export const config = initConfig();

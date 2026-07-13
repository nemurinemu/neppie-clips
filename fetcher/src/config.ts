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
const requiredString = z.string().trim().nonempty();
const numeric = z.preprocess(emptyToUndefined, z.coerce.number());

const envSchema = z.object({
  API_ID: numeric,
  API_HASH: requiredString,
  TG_SESSION: requiredString,
  CLIPS_DIR: requiredString,
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
  validateClipsDir(parsed.data.CLIPS_DIR);
  return parsed.data;
};

const validateClipsDir = (dir: string) => {
  try {
    fs.accessSync(dir, constants.F_OK | constants.W_OK);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        throw new Error(`Failed creating clips directory at ${dir}`);
      }
    } else {
      throw new Error(`No write access to clips directory at ${dir}`);
    }
  }
};

export const initConfig = () => {
  const env = validateConfig();
  return {
    apiId: env.API_ID,
    apiHash: env.API_HASH,
    tgSession: env.TG_SESSION,
    clipsDir: path.resolve(env.CLIPS_DIR),
  };
};

export const config = initConfig();

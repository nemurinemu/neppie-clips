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
  TELEGRAM_CHANNEL: requiredString,
  YOUTUBE_API_KEY: requiredString,
  YOUTUBE_CHANNEL: requiredString,
  YT_DLP: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  SKIP_BACKFILL: z.preprocess(emptyToUndefined, z.coerce.boolean().optional()),
  TWITCH_CLIENT_ID: requiredString,
  TWITCH_CLIENT_SECRET: requiredString,
  TWITCH_BROADCASTER: requiredString,
  TWITCH_CLIPS_SINCE: z.iso.date(),
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

const validateWritableDir = (dir: string) => {
  try {
    fs.accessSync(dir, constants.W_OK);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        throw new Error(`Failed creating directory at ${dir}`);
      }
    } else {
      throw new Error(`No write access to directory at ${dir}`);
    }
  }
};

export const initConfig = () => {
  const env = validateConfig();
  const paths = {
    clipsDir: path.resolve(env.CLIPS_DIR, 'videos'),
    thumbsDir: path.resolve(env.CLIPS_DIR, 'thumbnails'),
    dbPath: path.resolve(env.CLIPS_DIR, 'videos.db'),
    twitchTokenPath: path.resolve(env.CLIPS_DIR, 'twitch-token.json'),
    extraClipsPath: path.resolve(env.CLIPS_DIR, 'extra-clips.txt'),
  };
  validateWritableDir(paths.clipsDir);
  validateWritableDir(paths.thumbsDir);
  return {
    nodeEnv,
    apiId: env.API_ID,
    apiHash: env.API_HASH,
    tgSession: env.TG_SESSION,
    telegramChannel: env.TELEGRAM_CHANNEL,
    youtubeApiKey: env.YOUTUBE_API_KEY,
    youtubeChannel: env.YOUTUBE_CHANNEL,
    ytDlp: env.YT_DLP ?? 'yt-dlp',
    skipBackfill: env.SKIP_BACKFILL ?? false,
    twitchClientId: env.TWITCH_CLIENT_ID,
    twitchClientSecret: env.TWITCH_CLIENT_SECRET,
    twitchBroadcaster: env.TWITCH_BROADCASTER,
    twitchClipsSince: new Date(env.TWITCH_CLIPS_SINCE),
    ...paths,
  };
};

export const config = initConfig();

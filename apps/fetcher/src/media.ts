import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from './config';

const execFileAsync = promisify(execFile);

export const videoPath = (id: number) =>
  path.resolve(config.clipsDir, `${id}.mp4`);
export const verticalPath = (id: number) =>
  path.resolve(config.clipsDir, `${id}_vertical.mp4`);
export const thumbPath = (id: number) =>
  path.resolve(config.thumbsDir, `${id}.webp`);

export const makeThumbnail = async (video: string, thumb: string) => {
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    '00:00:01',
    '-i',
    video,
    '-frames:v',
    '1',
    '-update',
    '1',
    '-vf',
    'scale=640:-2',
    '-quality',
    '80',
    thumb,
  ]);
};

export interface VideoInfo {
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
}

export const probeVideo = async (video: string): Promise<VideoInfo> => {
  if (!fs.existsSync(video)) {
    return { sizeBytes: null, width: null, height: null };
  }
  const sizeBytes = fs.statSync(video).size;
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0:s=x',
    video,
  ]);
  const [w = NaN, h = NaN] = stdout.trim().split('x').map(Number);
  return {
    sizeBytes,
    width: Number.isFinite(w) ? w : null,
    height: Number.isFinite(h) ? h : null,
  };
};

export const removeMedia = (id: number) => {
  for (const p of [videoPath(id), verticalPath(id), thumbPath(id)]) {
    fs.rmSync(p, { force: true });
  }
};

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';

const execFileAsync = promisify(execFile);

// Loudness envelope: mono PCM at 4 kHz, RMS per 10 ms → 100 samples/second,
// computed as the PCM streams out of ffmpeg so whole streams fit in memory.
const RATE = 4000;
const HOP = RATE / 100;

const envelope = (file: string): Promise<Float32Array> =>
  new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(RATE), 'pipe:1']);
    const rms: number[] = [];
    let acc = 0;
    let n = 0;
    let carry: Buffer = Buffer.alloc(0);
    ff.stdout.on('data', (chunk: Buffer) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i);
        acc += v * v;
        if (++n === HOP) {
          rms.push(Math.log1p(Math.sqrt(acc / HOP)));
          acc = 0;
          n = 0;
        }
      }
      carry = buf.subarray(usable);
    });
    let err = '';
    ff.stderr.on('data', (d: Buffer) => (err += d));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`));
      // Onsets (sudden loudness increases) are far more distinctive than
      // loudness itself, which looks alike for any speech.
      const env = new Float32Array(rms.length);
      for (let i = 1; i < rms.length; i++) env[i] = Math.max(0, rms[i]! - rms[i - 1]!);
      const mean = env.reduce((a, b) => a + b, 0) / (env.length || 1);
      for (let i = 0; i < env.length; i++) env[i]! -= mean;
      resolve(env);
    });
  });

export interface Correlation {
  lag: number; // seconds into the segment where the clip starts
  peak: number; // normalized cross-correlation at the best lag, 0..1
  ratio: number; // peak / best correlation more than 2 s away from it
}

// Normalized cross-correlation of the clip envelope against every position
// in the segment envelope. A few million multiplies; no FFT needed.
export const correlate = (clip: Float32Array, seg: Float32Array): Correlation => {
  const n = clip.length;
  const lags = seg.length - n;
  if (lags < 1) return { lag: 0, peak: 0, ratio: 0 };
  let clipNorm = 0;
  for (let i = 0; i < n; i++) clipNorm += clip[i]! * clip[i]!;
  clipNorm = Math.sqrt(clipNorm);

  const scores = new Float32Array(lags);
  let win = 0;
  for (let i = 0; i < n; i++) win += seg[i]! * seg[i]!;
  for (let lag = 0; lag < lags; lag++) {
    if (lag > 0) {
      win += seg[lag + n - 1]! * seg[lag + n - 1]! - seg[lag - 1]! * seg[lag - 1]!;
    }
    let dot = 0;
    for (let i = 0; i < n; i++) dot += clip[i]! * seg[lag + i]!;
    scores[lag] = win > 0 ? dot / (clipNorm * Math.sqrt(win)) : 0;
  }

  let best = 0;
  for (let i = 1; i < lags; i++) if (scores[i]! > scores[best]!) best = i;
  let second = 0;
  for (let i = 0; i < lags; i++) {
    if (Math.abs(i - best) > 200 && scores[i]! > second) second = scores[i]!;
  }
  const peak = scores[best]!;
  return { lag: best / 100, peak, ratio: second > 0 ? peak / second : Infinity };
};

// Audio for [from, to] seconds of a YouTube video, cut precisely; the whole
// video when no range is given. Lowest-bitrate audio is plenty for onsets,
// and it stays compressed: ffmpeg decodes it straight into the envelope (a
// WAV of a whole stream is gigabytes, which is more than /tmp on the VPS).
const downloadAudio = async (videoId: string, range: { from: number; to: number } | null, dir: string) => {
  await execFileAsync(
    config.ytDlp,
    [
      '-q',
      '--no-warnings',
      '--no-playlist',
      '-f',
      'wa',
      ...(range ? ['--download-sections', `*${range.from}-${range.to}`, '--force-keyframes-at-cuts'] : []),
      '-o',
      path.join(dir, 'seg.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const file = fs.readdirSync(dir).find((f) => f.startsWith('seg.'));
  if (!file) throw new Error('yt-dlp produced no file');
  return path.join(dir, file);
};

export interface Aligned extends Correlation {
  seconds: number; // absolute seconds into the YouTube video where the clip starts
}

// Where does `clipFile` occur in `videoId`? Searches [from, to], or the
// whole video when no range is given.
export const alignClip = async (
  clipFile: string,
  videoId: string,
  range: { from: number; to: number } | null,
): Promise<Aligned> => {
  // Scratch space on the clips disk, not /tmp (small on the VPS).
  const scratch = path.join(config.clipsDir, '..', 'tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'align-'));
  try {
    const r = range ? { from: Math.max(0, range.from), to: range.to } : null;
    const seg = await downloadAudio(videoId, r, dir);
    const [clipEnv, segEnv] = await Promise.all([envelope(clipFile), envelope(seg)]);
    const c = correlate(clipEnv, segEnv);
    return { ...c, seconds: (r?.from ?? 0) + c.lag };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export const updateYtDlp = async () => {
  try {
    const { stdout } = await execFileAsync(config.ytDlp, ['-U']);
    console.log(`yt-dlp: ${stdout.trim().split('\n').at(-1)}`);
  } catch (err) {
    console.error('yt-dlp self-update failed:', err instanceof Error ? err.message : err);
  }
};

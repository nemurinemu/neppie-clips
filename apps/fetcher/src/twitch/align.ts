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

export const envelope = (file: string): Promise<Float32Array> =>
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

// A YouTube video's whole audio. Section downloads fail for server IPs
// (YouTube serves them a format ffmpeg can't seek remotely), and seeking
// into it locally lands tens of seconds off late in a stream, so the whole
// file is always decoded. Lowest-bitrate audio is plenty for onsets, and it stays
// compressed: ffmpeg decodes it straight into the envelope (a WAV of a whole
// stream is gigabytes, which is more than /tmp on the VPS).
export class YoutubeDownloadError extends Error {}

const downloadAudio = async (videoId: string, dir: string) => {
  await execFileAsync(
    config.ytDlp,
    [
      '-q',
      '--no-warnings',
      '--no-playlist',
      // YouTube asks server IPs to sign in; cookies from a throwaway account.
      ...(fs.existsSync(config.youtubeCookiesPath) ? ['--cookies', config.youtubeCookiesPath] : []),
      '-f',
      'wa',
      '-o',
      path.join(dir, 'seg.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000 },
  ).catch((err: { killed?: boolean; stderr?: string; message?: string }) => {
    const lines = (err.stderr ?? err.message ?? '').split('\n').map((l) => l.trim());
    const reason = err.killed ? 'timed out after 30 minutes' : (lines.filter((l) => l.startsWith('ERROR')).at(-1) ?? lines.filter(Boolean).at(-1) ?? 'unknown error');
    throw new YoutubeDownloadError(reason);
  });
  const file = fs.readdirSync(dir).find((f) => f.startsWith('seg.') && !f.endsWith('.part'));
  if (!file) throw new Error('yt-dlp produced no file');
  return path.join(dir, file);
};

// YouTube sometimes answers 403 and then works on the next try. A sign-in
// demand won't pass on retry, so it fails straight away.
const RETRY_DELAYS_MS = [30_000, 120_000];
const downloadAudioRetrying = async (videoId: string, dir: string) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadAudio(videoId, dir);
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!(err instanceof YoutubeDownloadError) || /sign in|cookies/i.test(err.message) || delay === undefined) throw err;
      console.log(`YouTube download of ${videoId} failed (${err.message}); retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
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
  const [clipEnv, videoEnv] = await Promise.all([envelope(clipFile), youtubeEnvelope(videoId)]);
  if (range) return findIn(clipEnv, videoEnv, range);
  const c = correlate(clipEnv, videoEnv);
  return { ...c, seconds: c.lag };
};

// A whole YouTube video's envelope. Each video is downloaded once: the
// envelope (~1.4 MB per hour, the audio itself is deleted) is kept on disk
// and reused for every later clip, so YouTube is asked as rarely as possible.
const cacheDir = () => path.join(config.clipsDir, '..', 'audio-cache');
const CACHE_KEEP_MS = 60 * 86_400_000;

const cachePath = (videoId: string) => path.join(cacheDir(), `${videoId}.f32`);
export const isCached = (videoId: string) => fs.existsSync(cachePath(videoId));

export const youtubeEnvelope = async (videoId: string): Promise<Float32Array> => {
  fs.mkdirSync(cacheDir(), { recursive: true });
  const cached = cachePath(videoId);
  if (fs.existsSync(cached)) {
    const buf = fs.readFileSync(cached);
    const t = new Date();
    fs.utimesSync(cached, t, t);
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  // Scratch space on the clips disk, not /tmp (small on the VPS).
  const scratch = path.join(config.clipsDir, '..', 'tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'align-'));
  try {
    const env = await envelope(await downloadAudioRetrying(videoId, dir));
    fs.writeFileSync(`${cached}.tmp`, Buffer.from(env.buffer, env.byteOffset, env.byteLength));
    fs.renameSync(`${cached}.tmp`, cached);
    return env;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Envelopes unused for 60 days: the Twitch VOD is gone by then, so new clips
// from that stream are unlikely.
export const pruneAudioCache = () => {
  if (!fs.existsSync(cacheDir())) return;
  for (const f of fs.readdirSync(cacheDir())) {
    const p = path.join(cacheDir(), f);
    if (Date.now() - fs.statSync(p).mtimeMs > CACHE_KEEP_MS) fs.rmSync(p, { force: true });
  }
};

// Where does a clip occur within [from, to] of a whole-video envelope?
export const findIn = (clipEnv: Float32Array, videoEnv: Float32Array, range: { from: number; to: number }): Aligned => {
  const from = Math.max(0, Math.round(range.from));
  const seg = videoEnv.slice(from * 100, Math.round(range.to) * 100);
  // Centered on the window, as envelope() does for a downloaded section.
  const mean = seg.reduce((a, b) => a + b, 0) / (seg.length || 1);
  for (let i = 0; i < seg.length; i++) seg[i]! -= mean;
  const c = correlate(clipEnv, seg);
  return { ...c, seconds: from + c.lag };
};

export const updateYtDlp = async () => {
  try {
    const { stdout } = await execFileAsync(config.ytDlp, ['-U']);
    console.log(`yt-dlp: ${stdout.trim().split('\n').at(-1)}`);
  } catch (err) {
    console.error('yt-dlp self-update failed:', err instanceof Error ? err.message : err);
  }
};

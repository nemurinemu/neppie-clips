import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { makeThumbnail, thumbPath, verticalPath, videoPath } from '../media';
import { getClipDownloads, TwitchIds } from './api';

// Written next to the target and renamed over it, so a file being served
// is never half-written (re-downloads replace in place).
const fetchToFile = async (url: string, out: string) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${out}`);
  }
  const part = `${out}.part`;
  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as NodeReadableStream),
      fs.createWriteStream(part),
    );
    fs.renameSync(part, out);
  } finally {
    fs.rmSync(part, { force: true });
  }
  return fs.statSync(out).size;
};

export interface DownloadedClip {
  sizeBytes: number;
  verticalSizeBytes: number | null;
}

export const downloadClip = async (
  ids: TwitchIds,
  clipId: string,
  id: number,
): Promise<DownloadedClip> => {
  const [d] = await getClipDownloads(ids.broadcasterId, ids.editorId, [clipId]);
  if (!d?.landscape_download_url) {
    throw new Error(`No download URL for clip ${clipId}`);
  }
  const sizeBytes = await fetchToFile(d.landscape_download_url, videoPath(id));
  let verticalSizeBytes: number | null = null;
  if (d.portrait_download_url) {
    verticalSizeBytes = await fetchToFile(d.portrait_download_url, verticalPath(id));
  } else {
    fs.rmSync(verticalPath(id), { force: true });
  }
  await makeThumbnail(videoPath(id), thumbPath(id));
  return { sizeBytes, verticalSizeBytes };
};

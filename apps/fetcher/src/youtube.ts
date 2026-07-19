import { URL } from 'node:url';
import { config } from './config';

export const extractYoutubeId = (url: string): string | null => {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1) || null;
    }
    if (u.hostname === 'www.youtube.com') {
      return u.searchParams.get('v');
    }
    return null;
  } catch {
    return null;
  }
};

interface YoutubeMeta {
  id: string;
  title: string;
  publishedAt: string;
}

export const fetchYoutubeMetadata = async (
  ids: string[],
): Promise<Map<string, YoutubeMeta>> => {
  const result = new Map<string, YoutubeMeta>();

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(',')}&key=${config.youtubeApiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Youtube API error: ${res.status} ${await res.text()}`);
      continue;
    }
    const data = await res.json();
    for (const item of data.items ?? []) {
      result.set(item.id, {
        id: item.id,
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt,
      });
    }
  }

  return result;
};

import path from 'node:path';

export type Platform = 'telegram' | 'twitch';

// Row shape as selected by the api; has_vertical comes back as 0/1.
export interface Video {
  id: number;
  shareId: string;
  description: string;
  clipNumber: number;
  addedAt: string;
  width: string;
  height: string;
  groupedId: string | null;
  sizeBytes: number | null;
  platform: Platform;
  hasVertical: number;
  verticalSizeBytes: number | null;
  twitchUrl: string | null;
}

export interface Source {
  id: number;
  videoId: number;
  url: string;
  youtubeTitle: string | null;
  youtubePublishedAt: string | null;
}

export interface VideoResponse {
  id: number;
  shareId: string;
  description: string;
  clipNumber: number;
  addedAt: string;
  width: string;
  height: string;
  sizeBytes: number | null;
  sources: Pick<Source, 'url' | 'youtubeTitle' | 'youtubePublishedAt'>[];
  platform?: Platform;
  hasVertical?: boolean;
  verticalSizeBytes?: number | null;
  twitchUrl?: string | null;
}

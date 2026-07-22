import path from 'node:path';

export interface Video {
  id: number;
  telegramMsgId: number;
  description: string;
  addedAt: string;
  groupedId: string | null;
  sizeBytes: number | null;
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
  telegramMsgId: number;
  description: string;
  addedAt: string;
  sizeBytes: number | null;
  sources: Pick<Source, 'url' | 'youtubeTitle' | 'youtubePublishedAt'>[];
}

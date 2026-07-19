import path from 'node:path';

export interface Video {
  id: number;
  telegramMsgId: number;
  description: string;
  addedAt: string;
  groupedId: string | null;
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
  description: string;
  addedAt: string;
  sources: Pick<Source, 'url' | 'youtubeTitle' | 'youtubePublishedAt'>[];
}

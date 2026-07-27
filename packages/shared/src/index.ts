import path from 'node:path';

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
}

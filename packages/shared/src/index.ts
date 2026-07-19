export interface Video {
  id: number;
  telegramMsgId: number;
  description: string;
  videoPath: string;
  thumbPath: string;
  postedAt: string;
  groupedId: string | null;
}

export interface Source {
  id: number;
  videoId: number;
  url: string;
  youtubeTitle: string | null;
  youtubePublishedAt: string | null;
}

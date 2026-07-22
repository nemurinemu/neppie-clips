const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE ?? '/media';

export const config = {
  videosEndpoint: `${API_BASE}/videos`,
  thumbUrl: (mediaId: number) => `${MEDIA_BASE}/thumbnails/${mediaId}.webp`,
  videoUrl: (mediaId: number) => `${MEDIA_BASE}/videos/${mediaId}.mp4`,
};

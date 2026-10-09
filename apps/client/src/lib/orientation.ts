import { ref, watch } from 'vue';
import type { Clip } from './clips';

const ORIENTATION_KEY = 'neppie-clips:vertical';

const readPref = () => {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === '1';
  } catch {
    return false;
  }
};

// Shared so the row download buttons follow the player's horizontal/vertical choice.
export const preferVertical = ref(readPref());
watch(preferVertical, (v) => {
  try {
    localStorage.setItem(ORIENTATION_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
});

export const activeMedia = (clip: Clip) => {
  const vertical = preferVertical.value && !!clip.verticalUrl;
  return {
    vertical,
    src: vertical ? clip.verticalUrl! : clip.videoUrl,
    size: vertical ? clip.verticalSizeBytes : clip.sizeBytes,
    name: vertical ? `${clip.description.split('\n')[0] ?? ''} vertical` : clip.description,
  };
};

export const peekImages: string[] = __PEEK_IMAGES__;
export const peekSounds: string[] = __PEEK_SOUNDS__;

export const randomPeek = (): string | null =>
  peekImages.length
    ? peekImages[Math.floor(Math.random() * peekImages.length)]!
    : null;

// Fetch every sound once up front (~2MB total) and keep it in memory as an
// object URL, so clicking plays instantly instead of hitting the network.
const soundUrls = new Map<string, string>();

for (const src of peekSounds) {
  fetch(src)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((blob) => soundUrls.set(src, URL.createObjectURL(blob)))
    .catch(() => {});
}

export const playRandomPeekSound = () => {
  if (!peekSounds.length) return;
  const src = peekSounds[Math.floor(Math.random() * peekSounds.length)]!;
  const audio = new Audio(soundUrls.get(src) ?? src);
  void audio.play().catch(() => {});
};

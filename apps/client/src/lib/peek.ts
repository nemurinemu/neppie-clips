export const peekImages: string[] = __PEEK_IMAGES__;
export const peekSounds: string[] = __PEEK_SOUNDS__;

export const randomPeek = (): string | null =>
  peekImages.length
    ? peekImages[Math.floor(Math.random() * peekImages.length)]!
    : null;

export const playRandomPeekSound = () => {
  if (!peekSounds.length) return;
  const src = peekSounds[Math.floor(Math.random() * peekSounds.length)]!;
  const audio = new Audio(src);
  void audio.play().catch(() => {});
};

import { ref } from 'vue';
import { isOpaqueAtEvent } from './hittest';
import { playRandomPeekSound } from './peek';

// Shared peek interaction: alpha-gated hover cursor (`hot`) + a JS-driven press
// (`pressed`) so the squish shows on a mobile tap, where CSS :active is delayed.
export const usePeekPress = () => {
  const hot = ref(false);
  const pressed = ref(false);
  let start = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onMove = (e: PointerEvent) => {
    hot.value = isOpaqueAtEvent(e);
  };

  const onDown = (e: PointerEvent) => {
    const opaque = isOpaqueAtEvent(e);
    hot.value = opaque;
    if (opaque && e.button === 0) {
      clearTimeout(timer);
      pressed.value = true;
      start = performance.now();
      playRandomPeekSound();
    }
  };

  // Hold the squish at least ~90ms so a quick tap still plays the animation.
  const release = () => {
    if (!pressed.value) return;
    clearTimeout(timer);
    const wait = Math.max(0, 90 - (performance.now() - start));
    timer = setTimeout(() => {
      pressed.value = false;
    }, wait);
  };

  const onLeave = () => {
    hot.value = false;
    release();
  };

  return { hot, pressed, onMove, onDown, onLeave, release };
};

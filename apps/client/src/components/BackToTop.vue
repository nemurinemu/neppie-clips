<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { smoothScrollTo } from '../lib/scroll';

const shown = ref(false);
const flying = ref(false);
const noAnim = ref(false);

let ticking = false;
const update = () => {
  ticking = false;
  if (flying.value) return;
  const toolbar = document.querySelector('.toolbar');
  const past = toolbar
    ? toolbar.getBoundingClientRect().bottom < 0
    : window.scrollY > 300;
  shown.value = past;
};

const onScroll = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(update);
};

const onClick = () => {
  if (flying.value) return;
  smoothScrollTo(0, 420);
  flying.value = true; // float up and off the top
};

const onTransitionEnd = (e: TransitionEvent) => {
  if (e.propertyName !== 'transform' || !flying.value) return;
  // Reset to the below-screen park position without sliding back through view.
  noAnim.value = true;
  flying.value = false;
  shown.value = false;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      noAnim.value = false;
    }),
  );
};

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  update();
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <button
    class="back-to-top"
    :class="{ shown, flying, 'no-anim': noAnim }"
    type="button"
    aria-label="Scroll to top"
    @click="onClick"
    @transitionend="onTransitionEnd"
  >
    <img src="/tothetop.webp" alt="" draggable="false" />
  </button>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  z-index: 40;
  bottom: 1rem;
  right: 1rem;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  width: clamp(72px, 19vw, 86px);
  pointer-events: none;
  transform: translateY(200%);
  transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}

.back-to-top img {
  display: block;
  width: 100%;
  height: auto;
  animation: btt-bob 3s ease-in-out infinite;
}

.back-to-top.shown {
  transform: translateY(0);
  pointer-events: auto;
}

.back-to-top.flying {
  transform: translateY(-140vh);
  transition-duration: 0.7s;
}

.back-to-top.no-anim {
  transition: none;
}

@keyframes btt-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

/* Left gutter only once there's real room on the right (side peek appears). */
@media (min-width: 1600px) {
  .back-to-top {
    right: auto;
    left: max(1rem, calc(50vw - 520px - 150px));
    width: clamp(80px, 6.5vw, 104px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .back-to-top img {
    animation: none;
  }
}
</style>

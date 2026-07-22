<script setup lang="ts">
import { randomPeek } from '../lib/peek';
import { usePeekPress } from '../lib/peekPress';

const image = randomPeek();
const { hot, pressed, onMove, onDown, onLeave, release } = usePeekPress();
</script>

<template>
  <img
    v-if="image"
    class="peek"
    :class="{ hot, pressed }"
    :src="image"
    alt=""
    aria-hidden="true"
    draggable="false"
    @pointermove="onMove"
    @pointerdown="onDown"
    @pointerup="release"
    @pointercancel="release"
    @pointerleave="onLeave"
  />
</template>

<style scoped>
.peek {
  display: none;
}

/* Right-corner peek only when there's real gutter room. */
@media (min-width: 1600px) {
  .peek {
    display: block;
    position: fixed;
    right: -7vw;
    bottom: -4vh;
    width: clamp(306px, calc(((100vw - 1000px) / 2 + 180px) * 0.9), 702px);
    height: auto;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
    transform: rotate(-5deg);
    transform-origin: bottom right;
    transition: transform 0.08s ease;
    z-index: 0;
  }
  .peek.hot {
    cursor: pointer;
  }
  .peek.pressed {
    transform: rotate(-5deg) scale(0.97);
  }
}
</style>

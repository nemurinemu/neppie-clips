<script setup lang="ts">
import { ref } from 'vue';
import { randomPeek, playRandomPeekSound } from '../lib/peek';
import { isOpaqueAtEvent } from '../lib/hittest';

const image = randomPeek();
const hot = ref(false);

const sample = (e: PointerEvent) => {
  hot.value = isOpaqueAtEvent(e);
};
const onLeave = () => {
  hot.value = false;
};
const onPeek = (e: MouseEvent) => {
  if (isOpaqueAtEvent(e)) playRandomPeekSound();
};
</script>

<template>
  <img
    v-if="image"
    class="peek"
    :class="{ hot }"
    :src="image"
    alt=""
    aria-hidden="true"
    draggable="false"
    @pointermove="sample"
    @pointerdown="sample"
    @pointerleave="onLeave"
    @click="onPeek"
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
    transition: transform 0.12s ease;
    z-index: 0;
  }
  .peek.hot {
    cursor: pointer;
  }
  .peek.hot:active {
    transform: rotate(-5deg) scale(0.97);
  }
}
</style>

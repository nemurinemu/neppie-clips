<script setup lang="ts">
import { randomPeek, playRandomPeekSound } from '../lib/peek';

const image = randomPeek();
</script>

<template>
  <img
    v-if="image"
    class="peek"
    :src="image"
    alt=""
    aria-hidden="true"
    draggable="false"
    @click="playRandomPeekSound"
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
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    transform: rotate(-5deg);
    transform-origin: bottom right;
    transition: transform 0.12s ease;
    z-index: 0;
  }
  .peek:active {
    transform: rotate(-5deg) scale(0.97);
  }
}
</style>

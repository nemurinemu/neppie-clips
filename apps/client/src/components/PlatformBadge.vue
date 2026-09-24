<script setup lang="ts">
defineProps<{ platform: 'telegram' | 'twitch' }>();
</script>

<template>
  <span v-if="platform === 'twitch'" class="badge" title="From Twitch">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h16v11l-4 4h-4l-3 3v-3H5z" />
      <path d="M12 8.5v4.5M16.5 8.5v4.5" />
    </svg>
  </span>
</template>

<style scoped>
.badge {
  display: inline-block;
  width: 14px;
  height: 14px;
  line-height: 0;
  color: #9146ff;
  vertical-align: -0.25em;
}

.badge svg {
  display: block;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
}
</style>

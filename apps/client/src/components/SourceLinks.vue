<script setup lang="ts">
import type { ClipSource } from '../lib/clips';

defineProps<{ sources: ClipSource[] }>();
</script>

<template>
  <div class="sources" :class="{ 'is-empty': !sources.length }">
    <a
      v-for="source in sources"
      :key="source.url"
      class="source"
      :href="source.url"
      target="_blank"
      rel="noopener noreferrer"
      :title="source.title"
      @click.stop
    >
      <span class="dot" />
      <span class="label">{{ source.title }}</span>
    </a>
    <span v-if="!sources.length" class="empty">—</span>
  </div>
</template>

<style scoped>
.sources {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.sources.is-empty {
  align-items: center;
}

.source {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  max-width: 100%;
  margin-left: -0.45rem;
  padding: 0.2rem 0.45rem;
  border-radius: 6px;
  color: var(--ink-soft);
  font-size: 0.82rem;
  text-decoration: none;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.source:hover {
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  flex-shrink: 0;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px dotted var(--line-strong);
}

.source:hover .label {
  border-bottom-color: var(--accent);
}

.empty {
  color: var(--ink-faint);
}
</style>

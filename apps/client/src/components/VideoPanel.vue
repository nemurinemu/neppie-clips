<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { Clip } from '../lib/clips';
import { downloadName, formatDate, formatSize } from '../lib/format';
import { smoothScrollTo } from '../lib/scroll';
import SourceLinks from './SourceLinks.vue';

const props = defineProps<{ clip: Clip }>();
const emit = defineEmits<{ close: [] }>();

const copied = ref(false);
const player = ref<HTMLVideoElement | null>(null);

// Exiting native fullscreen leaves the page scrolled off the still-open panel.
// Scroll the clip's row back under the header, matching how opening it scrolls.
const scrollRowIntoView = () => {
  const row = document.querySelector<HTMLElement>(
    `[data-clip="${props.clip.id}"]`,
  );
  if (!row) return;
  // thead is hidden on mobile (offsetHeight 0), so this is just a small margin.
  const thead = document.querySelector<HTMLElement>('.clips thead');
  const offset = (thead?.offsetHeight ?? 0) + 16;
  const top = row.getBoundingClientRect().top + window.scrollY - offset;
  smoothScrollTo(top, 320);
};

const onFullscreenChange = () => {
  const fs =
    document.fullscreenElement ??
    (document as unknown as { webkitFullscreenElement?: Element })
      .webkitFullscreenElement;
  if (fs) return;
  // Re-assert: mobile browsers do their own scroll on exit and the layout keeps
  // settling (address bar), so recompute fresh and land it again to win.
  requestAnimationFrame(() => requestAnimationFrame(scrollRowIntoView));
  setTimeout(scrollRowIntoView, 300);
};

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  // Move focus off the clip row (role="button") so Space controls the video
  // instead of closing the clip.
  player.value?.focus({ preventScroll: true });
});
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
});

const copyLink = async () => {
  const url = `${location.origin}${location.pathname}?video=${props.clip.id}`;
  try {
    await navigator.clipboard.writeText(url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard unavailable */
  }
};
</script>

<template>
  <div class="panel">
    <video
      ref="player"
      class="player"
      :src="clip.videoUrl"
      :poster="clip.thumbUrl"
      controls
      autoplay
      playsinline
    />

    <p v-if="clip.description" class="description">{{ clip.description }}</p>

    <div class="meta">
      <div class="col col-sources">
        <span class="key">Sources</span>
        <SourceLinks :sources="clip.sources" />
      </div>
      <div class="col col-date col-added">
        <span class="key">Added</span>
        <span class="value">{{ formatDate(clip.addedAt) }}</span>
      </div>
      <div class="col col-date col-stream">
        <span class="key">Stream date</span>
        <span class="value">{{ formatDate(clip.streamAt) }}</span>
      </div>
    </div>

    <div class="actions">
      <a
        class="btn primary"
        :href="clip.videoUrl"
        :download="downloadName(clip.id, clip.description)"
        @click.stop
      >
        Download{{ clip.sizeBytes != null ? ` (${formatSize(clip.sizeBytes)})` : '' }}
      </a>
      <button class="btn soft" @click.stop="copyLink">
        {{ copied ? 'Copied!' : 'Copy link' }}
      </button>
      <button class="btn ghost" @click.stop="emit('close')">Close</button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.player {
  width: 100%;
  max-height: 70vh;
  border-radius: 12px;
  background: #000;
}

.description {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.5;
  color: var(--ink);
  white-space: pre-line;
}

.meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px 130px;
  gap: 1.5rem;
  align-items: start;
  padding-right: 1rem;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.col-sources :deep(.sources.is-empty) {
  align-items: flex-start;
}

.key {
  color: var(--ink-faint);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
}

.value {
  font-size: 0.92rem;
  color: var(--ink);
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.btn {
  padding: 0.5rem 0.95rem;
  border-radius: 8px;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  text-decoration: none;
  transition:
    filter 0.15s ease,
    background 0.15s ease;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
}

.btn.primary:hover {
  filter: brightness(0.94);
}

.btn.soft {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.btn.soft:hover {
  background: var(--line-strong);
}

.btn.ghost {
  background: transparent;
  border-color: var(--line-strong);
  color: var(--ink-soft);
}

.btn.ghost:hover {
  background: var(--row-hover);
}

@media (max-width: 640px) {
  .meta {
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    padding-right: 0;
  }
  .col-sources {
    grid-column: 1 / -1;
  }
  .col-added {
    grid-column: 1;
    grid-row: 2;
  }
  .col-stream {
    grid-column: 2;
    grid-row: 2;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Clip } from '../lib/clips';
import { downloadName, downloadUrl, formatDate, formatSize } from '../lib/format';
import { scrollToAnchor } from '../lib/scroll';
import SourceLinks from './SourceLinks.vue';

const props = defineProps<{ clip: Clip }>();
const emit = defineEmits<{ close: [] }>();

const copied = ref(false);
const player = ref<HTMLVideoElement | null>(null);

const ORIENTATION_KEY = 'neppie-clips:vertical';
const readPref = () => {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === '1';
  } catch {
    return false;
  }
};
const showVertical = ref(!!props.clip.verticalUrl && readPref());
watch(showVertical, (v) => {
  try {
    localStorage.setItem(ORIENTATION_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
});

const vertical = computed(() => showVertical.value && !!props.clip.verticalUrl);
const activeSrc = computed(() =>
  vertical.value ? props.clip.verticalUrl! : props.clip.videoUrl,
);
const activeSize = computed(() =>
  vertical.value ? props.clip.verticalSizeBytes : props.clip.sizeBytes,
);
const activeName = computed(() =>
  vertical.value
    ? `${props.clip.description.split('\n')[0] ?? ''} vertical`
    : props.clip.description,
);

// Exiting native fullscreen leaves the page scrolled off the still-open panel.
// Scroll the clip's row back under the header, matching how opening it scrolls.
// Nodes are cached because this is re-measured every frame while scrolling;
// isConnected re-queries if Vue ever swaps the row out from under us.
let row: HTMLElement | null = null;
let thead: HTMLElement | null = null;

const rowTop = () => {
  if (!row?.isConnected) {
    row = document.querySelector<HTMLElement>(
      `[data-clip="${props.clip.shareId}"]`,
    );
  }
  if (!row) return null;
  if (!thead?.isConnected) {
    thead = document.querySelector<HTMLElement>('.clips thead');
  }
  // thead is hidden below 700px (offsetHeight 0), so this is just a small
  // margin there — and it re-reads, so crossing that breakpoint mid-rotation
  // picks up the header appearing.
  const offset = (thead?.offsetHeight ?? 0) + 16;
  return row.getBoundingClientRect().top + window.scrollY - offset;
};

const onFullscreenChange = () => {
  const fs =
    document.fullscreenElement ??
    (document as unknown as { webkitFullscreenElement?: Element })
      .webkitFullscreenElement;
  if (fs) return;
  // Hold the row pinned: mobile browsers do their own scroll on exit, and a
  // phone held upright only rotates back to portrait after this fires — the
  // reflow moves the row by about a screen, so a one-shot scroll misses it.
  requestAnimationFrame(() =>
    scrollToAnchor(rowTop, { duration: 320, hold: 1200 }),
  );
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
  const url = `${location.origin}${location.pathname}?video=${props.clip.shareId}`;
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
    <div class="stage" :class="{ vertical }">
      <video
        ref="player"
        class="player"
        :src="activeSrc"
        :poster="vertical ? undefined : clip.thumbUrl"
        controls
        autoplay
        playsinline
      />
      <div v-if="clip.verticalUrl" class="orientation" role="tablist">
        <button
          role="tab"
          :aria-selected="!vertical"
          :class="{ active: !vertical }"
          title="Horizontal"
          @click.stop="showVertical = false"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /></svg>
        </button>
        <button
          role="tab"
          :aria-selected="vertical"
          :class="{ active: vertical }"
          title="Vertical"
          @click.stop="showVertical = true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" /></svg>
        </button>
      </div>
    </div>

    <p v-if="clip.description" class="description">{{ clip.description }}</p>

    <div class="meta">
      <div class="col col-sources">
        <span class="key">Sources</span>
        <SourceLinks :sources="clip.sources" />
      </div>
      <div v-if="clip.twitchUrl" class="col col-twitch">
        <span class="key">Twitch</span>
        <a
          class="value link"
          :href="clip.twitchUrl"
          target="_blank"
          rel="noopener noreferrer"
          @click.stop
        >
          Open clip ↗
        </a>
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
      <button class="btn primary" @click.stop="copyLink">
        {{ copied ? 'Copied!' : 'Copy link' }}
      </button>
      <a
        class="btn soft"
        :href="downloadUrl(activeSrc, clip.clipNumber, activeName)"
        :download="downloadName(clip.clipNumber, activeName)"
        @click.stop
      >
        Download{{ activeSize != null ? ` (${formatSize(activeSize)})` : '' }}
      </a>
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

.stage {
  position: relative;
  display: flex;
  justify-content: center;
}

.player {
  width: 100%;
  max-height: 70vh;
  border-radius: 12px;
  background: #000;
}

.stage.vertical .player {
  width: auto;
  max-width: 100%;
  height: 70vh;
}

.orientation {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  opacity: 0.75;
  transition: opacity 0.15s ease;
}

.stage:hover .orientation,
.orientation:focus-within {
  opacity: 1;
}

.orientation button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.orientation button.active {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.orientation svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.orientation button.active svg {
  fill: currentColor;
}

.description {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.5;
  color: var(--ink);
  white-space: pre-line;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: flex-start;
  padding-right: 1rem;
}

.col-sources {
  flex: 1 1 240px;
}

.col-twitch,
.col-date {
  flex: 0 0 130px;
}

.value.link {
  color: var(--accent-ink);
  text-decoration: none;
  border-bottom: 1px dotted var(--line-strong);
  align-self: flex-start;
}

.value.link:hover {
  border-bottom-color: var(--accent);
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
    gap: 1rem;
    padding-right: 0;
  }
  .col-sources {
    flex-basis: 100%;
  }
  .col-twitch,
  .col-date {
    flex: 1 1 auto;
  }
}
</style>

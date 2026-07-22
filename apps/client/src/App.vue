<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useClips, type SortDir, type SortKey } from './lib/clips';
import { smoothScrollTo } from './lib/scroll';
import { randomPeek, playRandomPeekSound } from './lib/peek';
import { isOpaqueAtEvent } from './lib/hittest';
import SiteHeader from './components/SiteHeader.vue';
import SearchBar from './components/SearchBar.vue';
import ClipsTable from './components/ClipsTable.vue';
import SidePeekers from './components/SidePeekers.vue';
import BackToTop from './components/BackToTop.vue';

const { loading, error, query, sortKey, sortDir, visible, load, setSort } =
  useClips();

const expandedId = ref<number | null>(null);
const searchBar = ref<InstanceType<typeof SearchBar> | null>(null);
const bottomPeek = randomPeek();
const peekHot = ref(false);

const samplePeek = (e: PointerEvent) => {
  peekHot.value = isOpaqueAtEvent(e);
};
const onPeekLeave = () => {
  peekHot.value = false;
};
const onPeek = (e: MouseEvent) => {
  if (isOpaqueAtEvent(e)) playRandomPeekSound();
};

const readUrl = () => {
  const raw = new URLSearchParams(location.search).get('video');
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) ? id : null;
};

const toggle = (id: number) => {
  expandedId.value = expandedId.value === id ? null : id;
};

watch([query, sortKey, sortDir], () => {
  expandedId.value = null;
});

watch(expandedId, (id) => {
  const url = new URL(location.href);
  if (id === null) url.searchParams.delete('video');
  else url.searchParams.set('video', String(id));
  history.replaceState(history.state, '', url);
});

const onPopState = () => {
  expandedId.value = readUrl();
};

const onSortChange = (e: Event) => {
  const [key, dir] = (e.target as HTMLSelectElement).value.split(':');
  sortKey.value = key as SortKey;
  sortDir.value = dir as SortDir;
};

const onKeydown = (e: KeyboardEvent) => {
  // Match the physical key (layout-independent) so a non-Latin keyboard layout
  // doesn't make e.key something other than 'f' and slip through to the browser.
  const isF = e.code === 'KeyF' || e.key.toLowerCase() === 'f';
  if ((e.ctrlKey || e.metaKey) && isF) {
    e.preventDefault();
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (toolbar) {
      const top = toolbar.getBoundingClientRect().top + window.scrollY - 16;
      smoothScrollTo(Math.max(0, top), 320);
    }
    searchBar.value?.focus();
  }
};

onMounted(async () => {
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeydown);
  await load();
  const target = readUrl();
  if (target !== null && visible.value.some((c) => c.id === target)) {
    expandedId.value = target;
  }
});

onUnmounted(() => {
  window.removeEventListener('popstate', onPopState);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <SidePeekers />
  <BackToTop />

  <main class="container">
    <SiteHeader />

    <div class="toolbar">
      <SearchBar ref="searchBar" v-model="query" />
      <select
        class="sort-select"
        :value="`${sortKey}:${sortDir}`"
        aria-label="Sort clips"
        @change="onSortChange"
      >
        <option value="addedAt:desc">Newest added</option>
        <option value="addedAt:asc">Oldest added</option>
        <option value="streamAt:desc">Newest stream</option>
        <option value="streamAt:asc">Oldest stream</option>
        <option value="description:asc">Description A–Z</option>
        <option value="description:desc">Description Z–A</option>
        <option value="id:asc">ID ascending</option>
        <option value="id:desc">ID descending</option>
      </select>
      <span v-if="!loading && !error" class="count">
        {{ visible.length }} clip{{ visible.length === 1 ? '' : 's' }}
        {{ query.trim() ? 'found' : 'total' }}
      </span>
    </div>

    <p v-if="loading" class="status">Loading clips…</p>
    <p v-else-if="error" class="status error">Couldn’t load clips: {{ error }}</p>

    <ClipsTable
      v-else
      :clips="visible"
      :expanded-id="expandedId"
      :sort-key="sortKey"
      :sort-dir="sortDir"
      @toggle="toggle"
      @sort="setSort"
    />

    <p v-if="!loading && !error" class="credit">
      made with love by nemu ·
      <a href="https://nemu.moe" target="_blank" rel="noopener noreferrer"
        >nemu.moe</a
      >
    </p>

    <img
      v-if="bottomPeek"
      class="peek-bottom"
      :class="{ hot: peekHot }"
      :src="bottomPeek"
      alt=""
      aria-hidden="true"
      draggable="false"
      @pointermove="samplePeek"
      @pointerdown="samplePeek"
      @pointerleave="onPeekLeave"
      @click="onPeek"
    />
  </main>
</template>

<style scoped>
.container {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  min-height: 100dvh;
  max-width: 1040px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.peek-bottom {
  display: none;
}

@media (max-width: 1599px) {
  .container {
    padding-bottom: 0;
  }
  .peek-bottom {
    display: block;
    align-self: center;
    margin-top: auto;
    padding-top: 1.25rem;
    width: min(340px, 72vw);
    height: auto;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
    transform-origin: bottom center;
    transition: transform 0.12s ease;
  }
  .peek-bottom.hot {
    cursor: pointer;
  }
  .peek-bottom.hot:active {
    transform: scale(0.97) translateY(2%);
  }
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
}

.toolbar :deep(.search) {
  flex: 1;
}

.count {
  flex-shrink: 0;
  align-self: stretch;
  display: flex;
  align-items: center;
  padding: 0 0.9rem;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--line);
  color: var(--accent-ink);
  font-size: 0.82rem;
  font-weight: 600;
  white-space: nowrap;
}

.sort-select {
  display: none;
  padding: 0.55rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 0.9rem;
}

@media (max-width: 700px) {
  .sort-select {
    display: block;
    order: 1;
    flex: 1 1 auto;
  }
  .count {
    order: 2;
    text-align: right;
  }
  .toolbar :deep(.search) {
    order: 3;
    flex: 1 1 100%;
  }
}

.status {
  padding: 2rem;
  text-align: center;
  color: var(--ink-soft);
}

.status.error {
  color: #b4232a;
}

.credit {
  margin: 0.5rem 0 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--ink-soft);
}
.credit a {
  color: var(--accent-ink);
  font-weight: 600;
  text-decoration: none;
}
.credit a:hover {
  text-decoration: underline;
}
</style>

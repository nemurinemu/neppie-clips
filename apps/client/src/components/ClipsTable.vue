<script setup lang="ts">
import { nextTick, watch } from 'vue';
import type { Clip, SortDir, SortKey } from '../lib/clips';
import { downloadName, formatDate } from '../lib/format';
import { smoothScrollTo } from '../lib/scroll';
import SourceLinks from './SourceLinks.vue';
import VideoPanel from './VideoPanel.vue';

const props = defineProps<{
  clips: Clip[];
  expandedId: number | null;
  sortKey: SortKey;
  sortDir: SortDir;
}>();

const emit = defineEmits<{
  toggle: [id: number];
  sort: [key: SortKey];
}>();

const dataColumns: { key: SortKey; label: string }[] = [
  { key: 'description', label: 'Description' },
  { key: 'addedAt', label: 'Added' },
  { key: 'streamAt', label: 'Stream date' },
];

const arrow = (key: SortKey) =>
  props.sortKey === key ? (props.sortDir === 'asc' ? '▲' : '▼') : '';

const ariaSort = (key: SortKey) =>
  props.sortKey === key
    ? props.sortDir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';

watch(
  () => props.expandedId,
  async (id) => {
    if (id === null) return;
    await nextTick();
    const el = document.querySelector<HTMLElement>(`[data-clip="${id}"]`);
    if (!el) return;
    const thead = document.querySelector<HTMLElement>('.clips thead');
    const offset = (thead?.offsetHeight ?? 48) + 16;
    smoothScrollTo(el.getBoundingClientRect().top + window.scrollY - offset, 320);
  },
);
</script>

<template>
  <div class="table-wrap card">
    <table class="clips">
      <thead>
        <tr>
          <th
            class="col-id sortable"
            :class="{ active: sortKey === 'id' }"
            :aria-sort="ariaSort('id')"
            @click="emit('sort', 'id')"
          >
            # <span class="arrow">{{ arrow('id') }}</span>
          </th>
          <th class="col-thumb">Clip</th>
          <th
            v-for="col in dataColumns"
            :key="col.key"
            class="sortable"
            :class="[`col-${col.key}`, { active: sortKey === col.key }]"
            :aria-sort="ariaSort(col.key)"
            @click="emit('sort', col.key)"
          >
            {{ col.label }} <span class="arrow">{{ arrow(col.key) }}</span>
          </th>
          <th class="col-sources">Sources</th>
          <th class="col-dl">DL</th>
        </tr>
      </thead>

      <tbody>
        <template v-for="clip in clips" :key="clip.id">
          <tr
            class="clip-row"
            :class="{ open: expandedId === clip.id }"
            :data-clip="clip.id"
            tabindex="0"
            role="button"
            :aria-expanded="expandedId === clip.id"
            @click="emit('toggle', clip.id)"
            @keydown.enter.prevent="emit('toggle', clip.id)"
            @keydown.space.prevent="emit('toggle', clip.id)"
          >
            <td class="col-id">{{ clip.id }}</td>
            <td class="col-thumb">
              <span class="thumb">
                <img
                  :src="clip.thumbUrl"
                  :alt="clip.description"
                  loading="lazy"
                />
                <span class="play">{{ expandedId === clip.id ? '⏸' : '▶' }}</span>
              </span>
            </td>
            <td class="col-desc">{{ clip.description || 'Untitled clip' }}</td>
            <td class="col-date col-addedAt">
              <span class="row-id-mobile">#{{ clip.id }} · </span
              >{{ formatDate(clip.addedAt) }}
            </td>
            <td class="col-date col-streamAt">{{ formatDate(clip.streamAt) }}</td>
            <td class="col-sources">
              <SourceLinks :sources="clip.sources" />
            </td>
            <td class="col-dl">
              <a
                class="dl"
                :href="clip.videoUrl"
                :download="downloadName(clip.id, clip.description)"
                title="Download clip"
                aria-label="Download clip"
                @click.stop
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"
                  />
                </svg>
              </a>
            </td>
          </tr>

          <tr v-if="expandedId === clip.id" class="expand-row">
            <td :colspan="7">
              <VideoPanel :clip="clip" @close="emit('toggle', clip.id)" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <p v-if="!clips.length" class="empty">No clips match your search.</p>
  </div>
</template>

<style scoped>
.table-wrap {
  padding: 0;
  overflow: hidden;
}

.clips {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--card);
  text-align: center;
  padding: 0.85rem 1rem;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-faint);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

th.sortable {
  cursor: pointer;
  user-select: none;
}

th.sortable:hover,
th.active {
  color: var(--accent-ink);
}

.arrow {
  font-size: 0.7rem;
}

.clip-row {
  cursor: pointer;
}

.clip-row td {
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}

.clip-row.open td {
  border-bottom: none;
  background: var(--card);
}

.clip-row.open td:first-child,
.expand-row td {
  box-shadow: inset 3px 0 0 var(--accent);
}

.clip-row:hover:not(.open) td {
  background: var(--row-hover);
}

.clip-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.col-id {
  width: 40px;
  text-align: center;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.clips .col-id {
  padding-right: 0.35rem;
}

.clips .col-thumb {
  padding-left: 0.5rem;
}

.col-thumb {
  width: 140px;
}

.clip-row .col-thumb {
  text-align: center;
}

.thumb {
  position: relative;
  display: inline-block;
  width: 120px;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
  vertical-align: middle;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.thumb .play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 1.3rem;
  background: rgba(0, 0, 0, 0.25);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.clip-row:hover .play {
  opacity: 1;
}

.col-desc {
  color: var(--ink);
  line-height: 1.4;
  white-space: pre-line;
}

.row-id-mobile {
  display: none;
}

.col-date {
  white-space: nowrap;
  text-align: center;
  color: var(--ink-soft);
}

.col-sources {
  max-width: 220px;
}

.col-dl {
  width: 52px;
  text-align: center;
}

.clips .col-dl {
  padding-left: 0.3rem;
}

.dl {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--ink-faint);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.dl svg {
  width: 20px;
  height: 20px;
}

.dl:hover {
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.expand-row td {
  padding: 0;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

.empty {
  padding: 2rem;
  text-align: center;
  color: var(--ink-faint);
}

@media (max-width: 720px) {
  .col-sources {
    display: none;
  }
}

@media (max-width: 700px) {
  .clips,
  .clips tbody {
    display: block;
  }

  .clips thead {
    display: none;
  }

  .clip-row {
    display: grid;
    grid-template-columns: 104px 1fr auto;
    grid-template-areas:
      'thumb desc  dl'
      'thumb added dl';
    column-gap: 1rem;
    row-gap: 0.25rem;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid var(--line);
  }

  .clip-row.open {
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .clip-row td {
    display: block;
    padding: 0;
    border: none;
    background: none;
  }

  .clip-row .col-id,
  .clip-row .col-streamAt,
  .clip-row .col-sources {
    display: none;
  }

  .clip-row .col-thumb {
    grid-area: thumb;
    width: 104px;
    text-align: left;
    padding-left: 0;
  }

  .thumb {
    width: 104px;
  }

  .clip-row .col-desc {
    grid-area: desc;
    align-self: center;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .clip-row .col-addedAt {
    grid-area: added;
    text-align: left;
    font-size: 0.8rem;
  }

  .row-id-mobile {
    display: inline;
  }

  .clip-row .col-dl {
    grid-area: dl;
    width: auto;
  }

  .expand-row,
  .expand-row td {
    display: block;
  }
}
</style>

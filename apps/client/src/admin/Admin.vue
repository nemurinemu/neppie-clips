<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { config } from '../config';

const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;

interface Stream {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  offsetSeconds: number | null;
  alignStatus: string | null;
}
interface Unmatched {
  id: number;
  shareId: string;
  description: string;
  clipId: string;
  twitchUrl: string;
  createdAt: string;
  duration: number;
  alignStatus: string | null;
  assignedStream: string | null;
  assignedTitle: string | null;
  assignedStartedAt: string | null;
  youtubeUrl: string | null;
  queuePosition: number | null;
  suggestions: Stream[];
}
interface LateSeen {
  clipId: string;
  twitchUrl: string;
  title: string;
  createdAt: string;
  id: number | null;
  shareId: string | null;
}
interface FailedStream {
  id: string;
  title: string;
  startedAt: string;
  sampleUrl: string | null;
  sampleTitle: string | null;
  clipCount: number;
}
interface Overview {
  storage: { clipsBytes: number; diskFree: number; diskTotal: number };
  counts: { platform: string; n: number }[];
  unmatched: Unmatched[];
  lateSeen: LateSeen[];
  failedStreams: FailedStream[];
}

const data = ref<Overview | null>(null);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

// nginx protects /api/admin with basic auth; the page remembers the
// credentials so the browser prompt only ever appears once.
const AUTH_KEY = 'neppie-admin:auth';
const auth = ref<string | null>((() => { try { return localStorage.getItem(AUTH_KEY); } catch { return null; } })());
const loginPass = ref('');
const login = () => {
  auth.value = btoa(`nemu:${loginPass.value}`);
  try { localStorage.setItem(AUTH_KEY, auth.value); } catch { /* fine */ }
  loginPass.value = '';
  return load();
};
const logout = () => {
  auth.value = null;
  data.value = null;
  try { localStorage.removeItem(AUTH_KEY); } catch { /* fine */ }
};
const addUrl = ref('');
const picked = ref<Record<number, string>>({});
const note = ref<Record<number, string>>({});
const link = ref<Record<number, string>>({});
const open = ref<Record<number, 'link' | 'note' | undefined>>({});

const api = async (path: string, body?: unknown) => {
  const headers: Record<string, string> = auth.value ? { Authorization: `Basic ${auth.value}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api/admin${path}`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  if (res.status === 401) {
    logout();
    throw new Error('wrong password');
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const load = async () => {
  try {
    data.value = (await api('/overview')) as Overview;
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'failed';
  }
};

const act = async (key: string, path: string, body?: unknown) => {
  busy.value = key;
  try {
    await api(path, body ?? {});
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'failed';
  } finally {
    busy.value = null;
  }
};


const date = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const siteLink = (shareId: string) => `/?video=${shareId}`;
const pct = computed(() => (data.value ? Math.round((1 - data.value.storage.diskFree / data.value.storage.diskTotal) * 100) : 0));
const count = (p: string) => data.value?.counts.find((c) => c.platform === p)?.n ?? 0;

const remove = (clip: { id: number | null; description?: string; title?: string }) => {
  if (clip.id === null) return;
  if (!confirm(`Delete "${clip.description ?? clip.title}" from the site and ignore it from now on?`)) return;
  return act(`remove-${clip.id}`, `/clips/${clip.id}/remove`);
};

onMounted(() => { if (auth.value) load(); });
</script>

<template>
  <main class="wrap">
    <header class="head">
      <h1>Admin</h1>
      <a href="/">← site</a>
      <button v-if="auth" class="btn ghost" @click="load">Refresh</button>
      <button v-if="auth" class="btn ghost" @click="logout">Log out</button>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="!auth" class="card login" @submit.prevent="login">
      <input v-model="loginPass" type="password" placeholder="password" autocomplete="current-password" />
      <button class="btn primary" type="submit" :disabled="!loginPass">Log in</button>
      <p class="muted small">Remembered in this browser until you log out.</p>
    </form>

    <template v-if="data">
      <section class="card storage">
        <div>
          <span class="key">Clips on disk</span>
          <strong>{{ formatSize(data.storage.clipsBytes) }}</strong>
          <span class="muted">{{ count('telegram') }} cuts · {{ count('twitch') }} twitch</span>
        </div>
        <div>
          <span class="key">Disk</span>
          <strong>{{ formatSize(data.storage.diskFree) }} free</strong>
          <span class="muted">of {{ formatSize(data.storage.diskTotal) }}</span>
        </div>
        <div class="bar"><span :style="{ width: pct + '%' }" /></div>
      </section>

      <section class="card">
        <h2>Needs a stream <span class="n">{{ data.unmatched.length }}</span></h2>
        <p class="muted" v-if="!data.unmatched.length">Every Twitch clip has a YouTube source.</p>
        <article v-for="c in data.unmatched" :key="c.id" class="row">
          <img :src="config.thumbUrl(c.id)" alt="" />
          <div class="body">
            <div class="title">
              <a :href="siteLink(c.shareId)" target="_blank">{{ c.description }}</a>
              <span class="muted">clipped {{ date(c.createdAt) }} · {{ Math.round(c.duration) }}s ·
                <a :href="c.twitchUrl" target="_blank">twitch</a>
                <template v-if="c.youtubeUrl"> · <a :href="c.youtubeUrl" target="_blank">current guess ↗</a></template>
              </span>
            </div>
            <div class="status" v-if="c.assignedStream">
              <template v-if="c.alignStatus === 'failed'">Not found in {{ c.assignedStartedAt ? short(c.assignedStartedAt) : '' }} — {{ c.assignedTitle }}. Try another stream, or paste the link.</template>
              <template v-else-if="c.queuePosition">Queued for {{ c.assignedStartedAt ? short(c.assignedStartedAt) : '' }} — {{ c.assignedTitle }} (#{{ c.queuePosition }} in line, a few minutes each).</template>
              <template v-else>Aligning to {{ c.assignedStartedAt ? short(c.assignedStartedAt) : '' }} — {{ c.assignedTitle }} now…</template>
            </div>
            <div class="controls">
              <select v-model="picked[c.id]">
                <option value="" disabled>the stream it's from…</option>
                <option v-for="s in c.suggestions" :key="s.id" :value="s.id">{{ short(s.startedAt) }} — {{ s.title }}</option>
              </select>
              <button class="btn primary" :disabled="!picked[c.id] || busy === `assign-${c.id}`" @click="act(`assign-${c.id}`, `/clips/${c.id}/assign`, { streamId: picked[c.id] })">Assign</button>
              <button class="link" :class="{ on: open[c.id] === 'link' }" @click="open[c.id] = open[c.id] === 'link' ? undefined : 'link'">paste link</button>
              <button class="link" :class="{ on: open[c.id] === 'note' }" @click="open[c.id] = open[c.id] === 'note' ? undefined : 'note'">no stream on YouTube?</button>
            </div>
            <div class="controls" v-if="open[c.id] === 'link'">
              <input v-model="link[c.id]" placeholder="https://youtu.be/…?t=1234 or youtube.com/watch?v=…&t=…" @keydown.enter="act(`source-${c.id}`, `/clips/${c.id}/source`, { url: link[c.id] })" />
              <button class="btn soft" :disabled="!link[c.id] || busy === `source-${c.id}`" @click="act(`source-${c.id}`, `/clips/${c.id}/source`, { url: link[c.id] })">Save</button>
            </div>
            <div class="controls" v-if="open[c.id] === 'note'">
              <input v-model="note[c.id]" placeholder="note to show under the title, e.g. which stream it was (optional)" @keydown.enter="act(`resolve-${c.id}`, `/clips/${c.id}/resolve`, { note: note[c.id] })" />
              <button class="btn soft" :disabled="busy === `resolve-${c.id}`" @click="act(`resolve-${c.id}`, `/clips/${c.id}/resolve`, { note: note[c.id] })">Save</button>
            </div>
          </div>
        </article>
      </section>

      <section class="card">
        <h2>Appeared late — yours? <span class="n">{{ data.lateSeen.length }}</span></h2>
        <p class="muted" v-if="!data.lateSeen.length">Nothing to check.</p>
        <article v-for="c in data.lateSeen" :key="c.clipId" class="row">
          <img v-if="c.id !== null" :src="config.thumbUrl(c.id)" alt="" />
          <div class="body">
            <div class="title">
              <a v-if="c.shareId" :href="siteLink(c.shareId)" target="_blank">{{ c.title }}</a>
              <span v-else>{{ c.title }}</span>
              <span class="muted">clipped {{ date(c.createdAt) }} · <a :href="c.twitchUrl" target="_blank">twitch</a></span>
            </div>
            <div class="controls">
              <button class="btn primary" :disabled="busy === `keep-${c.clipId}`" @click="act(`keep-${c.clipId}`, `/review/${c.clipId}/keep`)">It's mine</button>
              <button class="btn ghost" :disabled="c.id === null" @click="remove(c)">Delete clip</button>
            </div>
          </div>
        </article>
      </section>

      <section class="card">
        <h2>Streams that didn't align <span class="n">{{ data.failedStreams.length }}</span></h2>
        <p class="muted" v-if="!data.failedStreams.length">All aligned.</p>
        <p class="muted small" v-else>Their clips are on the site with an early-biased guess. Open the sample: if it lands right, keep it. If it's off, paste a correct link for that one clip on the site's admin row (under "Needs a stream" it'll appear after Retry) — one link fixes every clip on the stream.</p>
        <article v-for="s in data.failedStreams" :key="s.id" class="row">
          <div class="body">
            <div class="title">
              <span>{{ s.title }}</span>
              <span class="muted">{{ short(s.startedAt) }} · {{ s.clipCount }} clip{{ s.clipCount === 1 ? '' : 's' }} ·
                <a v-if="s.sampleUrl" :href="s.sampleUrl" target="_blank">sample: "{{ (s.sampleTitle ?? '').split('\n')[0] }}" ↗</a></span>
            </div>
            <div class="controls">
              <button class="btn primary" :disabled="busy === `accept-${s.id}`" @click="act(`accept-${s.id}`, `/streams/${s.id}/accept`)">Looks right — keep</button>
              <button class="btn ghost" :disabled="busy === `realign-${s.id}`" @click="act(`realign-${s.id}`, `/streams/${s.id}/realign`)">Retry</button>
            </div>
          </div>
        </article>
      </section>

      <section class="card">
        <h2>Add a clip the listing missed</h2>
        <div class="controls">
          <input v-model="addUrl" placeholder="https://www.twitch.tv/…/clip/…" @keydown.enter="act('add', '/clips/add', { url: addUrl }).then(() => (addUrl = ''))" />
          <button class="btn primary" :disabled="!addUrl || busy === 'add'" @click="act('add', '/clips/add', { url: addUrl }).then(() => (addUrl = ''))">Add</button>
        </div>
        <p class="muted small">Fetched by id on the next poll (within 5 minutes).</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.wrap { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem 4rem; display: flex; flex-direction: column; gap: 1rem; }
.head { display: flex; align-items: baseline; gap: 1rem; }
.head h1 { margin: 0; font-size: 1.4rem; }
.head a { color: var(--accent-ink); text-decoration: none; }
.head .btn:first-of-type { margin-left: auto; }
.login { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.login .muted { flex-basis: 100%; margin: 0; }
h2 { margin: 0 0 0.75rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); }
h2 .n { margin-left: 0.4rem; padding: 0.05rem 0.5rem; border-radius: 999px; background: var(--accent-soft); color: var(--accent-ink); font-size: 0.85rem; }
.error { color: #b00020; }
.muted { color: var(--ink-faint); }
.small { font-size: 0.85rem; }
.storage { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.storage > div { display: flex; flex-direction: column; gap: 0.2rem; }
.storage .key { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); }
.storage strong { font-size: 1.2rem; }
.bar { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.row { display: flex; gap: 1rem; padding: 0.85rem 0; border-top: 1px solid var(--line); align-items: center; }
.row img { width: 96px; aspect-ratio: 16 / 9; object-fit: contain; border-radius: 8px; background: #000; flex-shrink: 0; }
.body { display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; flex: 1; }
.title { display: flex; flex-direction: column; gap: 0.1rem; }
.status { font-size: 0.85rem; color: var(--accent-ink); }
.link { border: none; background: none; padding: 0; font: inherit; font-size: 0.85rem; color: var(--ink-faint); text-decoration: underline dotted; cursor: pointer; white-space: nowrap; }
.link:hover, .link.on { color: var(--accent-ink); }
.title a { color: var(--ink); text-decoration: none; font-weight: 600; }
.title .muted a { color: var(--accent-ink); }
.controls { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
input, select { font: inherit; font-size: 0.9rem; height: 34px; padding: 0 0.6rem; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--card); color: var(--ink); min-width: 0; }
select { max-width: 100%; flex: 1 1 200px; }
input { flex: 1 1 200px; }
.btn { height: 34px; padding: 0 0.9rem; border-radius: 8px; border: 1px solid transparent; font: inherit; font-weight: 600; font-size: 0.9rem; cursor: pointer; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.soft { background: var(--accent-soft); color: var(--accent-ink); }
.btn.ghost { background: transparent; border-color: var(--line-strong); color: var(--ink-soft); }
@media (max-width: 600px) { .row { flex-direction: column; } .row img { width: 100%; } }
</style>

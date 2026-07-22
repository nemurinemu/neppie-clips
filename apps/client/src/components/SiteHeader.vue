<script setup lang="ts">
import { ref } from 'vue';
import { site } from '../site';

const bannerFailed = ref(false);
const showBanner = () => !!site.bannerSrc && !bannerFailed.value;

const columns = [
  { group: 'neppie', title: 'Neppie socials', links: site.links.neppie },
  { group: 'friends', title: 'Check them out!', links: site.links.friends },
  { group: 'me', title: 'My socials', links: site.links.me },
] as const;
</script>

<template>
  <header class="header card">
    <img
      v-if="showBanner()"
      class="banner"
      :src="site.bannerSrc!"
      :alt="site.title"
      @error="bannerFailed = true"
    />
    <h1 v-else class="title">{{ site.title }}</h1>

    <p class="about" v-html="site.aboutHtml" />

    <nav class="links">
      <div
        v-for="col in columns"
        v-show="col.links.length"
        :key="col.group"
        class="link-col"
        :class="col.group"
      >
        <span class="col-title">{{ col.title }}</span>
        <a
          v-for="(link, i) in col.links"
          :key="i"
          class="link"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ link.label }}
        </a>
      </div>
    </nav>
  </header>
</template>

<style scoped>
.header {
  text-align: center;
}

.banner {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 0;
  user-select: none;
  -webkit-user-select: none;
}

.title {
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  color: var(--ink);
}

.about {
  margin: 0.9rem 0 0;
  max-width: none;
  color: var(--ink-soft);
  line-height: 1.55;
}


.links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  gap: 1.25rem;
  margin-top: 1.5rem;
}

.link-col {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  --col-bg: #fff;
  --col-line: var(--line);
  --col-ink: var(--ink);
  --col-fill: var(--ink);
}

.col-title {
  margin-bottom: 0.15rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--col-ink);
  opacity: 0.7;
}

.link {
  display: block;
  padding: 0.6rem 1rem;
  border-radius: 10px;
  border: 1.5px solid var(--col-line);
  background: var(--col-bg);
  color: var(--col-ink);
  font-weight: 600;
  font-size: 0.92rem;
  text-decoration: none;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease,
    transform 0.1s ease;
}
.link:hover {
  background: var(--col-fill);
  border-color: var(--col-fill);
  color: #fff;
}
.link:active {
  transform: translateY(1px);
}

/* neppie — accent yellow */
.link-col.neppie {
  --col-bg: var(--accent-soft);
  --col-line: var(--accent);
  --col-ink: var(--accent-ink);
  --col-fill: var(--accent);
}

/* friends — blue */
.link-col.friends {
  --col-bg: #e4eefc;
  --col-line: #2b6cb0;
  --col-ink: #2b6cb0;
  --col-fill: #2b6cb0;
}

/* me — green */
.link-col.me {
  --col-bg: #e3f5e6;
  --col-line: #2f855a;
  --col-ink: #2f855a;
  --col-fill: #2f855a;
}

@media (max-width: 560px) {
  .links {
    grid-template-columns: 1fr;
    gap: 1rem;
    max-width: 340px;
    margin-inline: auto;
  }
}
</style>

<script setup lang="ts">
import { ref } from 'vue';

const model = defineModel<string>({ required: true });
const input = ref<HTMLInputElement | null>(null);

const focus = () => {
  input.value?.focus();
  input.value?.select();
};

defineExpose({ focus });
</script>

<template>
  <div class="search">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 4a6 6 0 1 0 3.7 10.7l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4m0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8"
      />
    </svg>
    <input
      ref="input"
      v-model="model"
      type="search"
      placeholder="Search clips…"
      aria-label="Search clips"
    />
    <button v-if="model" class="clear" @click="model = ''" aria-label="Clear">
      ✕
    </button>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--line);
}

.search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.icon {
  width: 20px;
  height: 20px;
  color: var(--ink-soft);
  flex-shrink: 0;
}

input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 1rem;
  background: transparent;
  color: var(--ink);
}

input::-webkit-search-cancel-button {
  display: none;
}

.clear {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--ink-soft);
  font-size: 0.9rem;
}
</style>

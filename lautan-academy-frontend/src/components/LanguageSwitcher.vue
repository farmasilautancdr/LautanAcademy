<script setup>
import { useI18n } from 'vue-i18n'
import { STORAGE_KEY } from '../i18n'

const { locale } = useI18n()

function setLocale(lang) {
  if (locale.value === lang) return
  locale.value = lang
  localStorage.setItem(STORAGE_KEY, lang)
}
</script>

<template>
  <div class="inline-flex items-center gap-0.5 rounded-full border border-slate/30 bg-seafoam/40 p-0.5" role="radiogroup" aria-label="Language">
    <button
      type="button"
      role="radio"
      :aria-checked="locale === 'en'"
      @click="setLocale('en')"
      class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
      :class="locale === 'en' ? 'bg-white text-ink shadow-sm' : 'text-slate hover:text-ink'"
    >
      EN
    </button>
    <button
      type="button"
      role="radio"
      :aria-checked="locale === 'ms'"
      @click="setLocale('ms')"
      class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
      :class="locale === 'ms' ? 'bg-white text-ink shadow-sm' : 'text-slate hover:text-ink'"
    >
      BM
    </button>
  </div>
</template>

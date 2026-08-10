<script setup>
import { useI18n } from 'vue-i18n'
import { STORAGE_KEY } from '../i18n'

const { locale } = useI18n()

function toggleLocale() {
  locale.value = locale.value === 'en' ? 'ms' : 'en'
  localStorage.setItem(STORAGE_KEY, locale.value)
}
</script>

<template>
  <button
    type="button"
    @click="toggleLocale"
    class="text-xs font-medium text-slate hover:text-aqua border border-slate/30 rounded-full px-2.5 py-1 transition-colors"
    :aria-label="locale === 'en' ? 'Switch to Bahasa Melayu' : 'Switch to English'"
  >
    {{ locale === 'en' ? 'BM' : 'EN' }}
  </button>
</template>

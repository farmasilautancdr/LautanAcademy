<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  currentPage: { type: Number, required: true },
  totalPages: { type: Number, required: true }
})
const emit = defineEmits(['prev', 'next'])
const { t } = useI18n()
</script>

<template>
  <div v-if="totalPages > 1" class="flex items-center justify-between px-5 py-3 border-t border-seafoam text-sm">
    <button
      type="button"
      @click="emit('prev')"
      :disabled="currentPage <= 1"
      class="text-aqua font-medium disabled:text-slate/40 disabled:cursor-not-allowed"
    >
      {{ t('pagination.previous') }}
    </button>
    <span class="text-slate text-xs">{{ t('pagination.pageOf', { current: currentPage, total: totalPages }) }}</span>
    <button
      type="button"
      @click="emit('next')"
      :disabled="currentPage >= totalPages"
      class="text-aqua font-medium disabled:text-slate/40 disabled:cursor-not-allowed"
    >
      {{ t('pagination.next') }}
    </button>
  </div>
</template>

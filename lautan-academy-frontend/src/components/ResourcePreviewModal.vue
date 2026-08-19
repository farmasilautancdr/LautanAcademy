<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// rawUrl kept as a prop (still used by callers to build src) but no longer
// linked out to directly — as an installed PWA (standalone display mode,
// no browser chrome/tabs), a target="_blank" link doesn't open a new tab
// like it does in a normal browser tab; on iOS it can boot the user clean
// out of the app into Safari with no way back in, stranding them on the
// raw file with no back button (reported live via video 2026-08-19). File
// stays fully in-app (iframe/img below) — "Back to Courses" just closes
// the modal, same list is already underneath.
defineProps({
  title: { type: String, required: true },
  src: { type: String, required: true },
  rawUrl: { type: String, required: true },
  isImage: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" @click.self="emit('close')">
      <div class="w-full max-w-6xl h-[94vh] bg-white rounded-xl2 shadow-lg flex flex-col overflow-hidden">
        <div class="flex items-center gap-3 px-4 py-3 border-b border-seafoam shrink-0">
          <button type="button" @click="emit('close')" class="flex items-center gap-1 text-aqua text-sm font-medium shrink-0">
            <span aria-hidden="true">&larr;</span> {{ t('resourcesView.backToCourses') }}
          </button>
          <p class="text-sm font-medium text-ink truncate flex-1 min-w-0">{{ title }}</p>
        </div>
        <div class="flex-1 min-h-0 bg-seafoam">
          <img v-if="isImage" :src="src" class="w-full h-full object-contain" />
          <iframe v-else :src="src" class="w-full h-full border-0" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

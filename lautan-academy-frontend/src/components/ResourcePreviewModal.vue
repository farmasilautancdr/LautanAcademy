<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// src = what renders inside the frame (may be an Office Online Viewer
// wrapper URL for pptx/docx); rawUrl = the actual file, used for the
// "open in new tab" fallback (mobile Safari sometimes blocks iframe PDF
// rendering, and Office Online Viewer needs the file itself to fall back to).
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
      <div class="w-full max-w-4xl h-[85vh] bg-white rounded-xl2 shadow-lg flex flex-col overflow-hidden">
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-seafoam shrink-0">
          <p class="text-sm font-medium text-ink truncate">{{ title }}</p>
          <div class="flex items-center gap-3 shrink-0">
            <a :href="rawUrl" target="_blank" rel="noopener" class="text-xs text-aqua font-medium underline">
              {{ t('resourcesView.openInNewTab') }}
            </a>
            <button type="button" @click="emit('close')" class="text-slate text-xl leading-none px-1" :aria-label="t('resourcesView.close')">&times;</button>
          </div>
        </div>
        <div class="flex-1 min-h-0 bg-seafoam">
          <img v-if="isImage" :src="src" class="w-full h-full object-contain" />
          <iframe v-else :src="src" class="w-full h-full border-0" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps({
  title: { type: String, required: true },
  breakdown: { type: Array, required: true },
  warning: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])

const confirmText = ref('')
const canConfirm = computed(() => confirmText.value.trim().toUpperCase() === 'DELETE')
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 px-4" @click.self="emit('cancel')">
      <div class="w-full max-w-md bg-white rounded-xl2 shadow-lg p-5 space-y-4">
        <h3 class="font-display font-semibold text-ink text-base">{{ title }}</h3>
        <ul class="text-sm text-slate space-y-1 border border-seafoam rounded-lg p-3">
          <li v-for="row in breakdown" :key="row.label" class="flex justify-between">
            <span>{{ row.label }}</span>
            <span class="font-medium text-ink">{{ row.count }}</span>
          </li>
        </ul>
        <p v-if="warning" class="text-xs text-coral">{{ warning }}</p>
        <div>
          <label for="purge-confirm-input" class="block text-xs text-slate mb-1">{{ t('masterPanel.dataPurge.confirmModal.typeToConfirm') }}</label>
          <input
            id="purge-confirm-input"
            v-model="confirmText"
            type="text"
            :placeholder="t('masterPanel.dataPurge.confirmModal.placeholder')"
            class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm"
          />
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" @click="emit('cancel')" class="text-slate text-sm px-4 py-2 rounded-lg border border-slate/30">
            {{ t('masterPanel.dataPurge.confirmModal.cancel') }}
          </button>
          <button
            type="button"
            :disabled="!canConfirm || loading"
            @click="emit('confirm')"
            class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {{ loading ? t('masterPanel.dataPurge.confirmModal.deleting') : t('masterPanel.dataPurge.confirmModal.deleteButton') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

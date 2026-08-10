<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMasterAuthStore } from '../store/masterAuth'
import PasswordField from './PasswordField.vue'

const emit = defineEmits(['close', 'success'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = t('masterPanel.errorMissingFields')
    return
  }
  loading.value = true
  try {
    await masterAuth.login(username.value.trim(), password.value)
    password.value = ''
    emit('success')
  } catch (err) {
    error.value = t('masterPanel.errorInvalidLogin')
    password.value = ''
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" @click.self="emit('close')">
      <div class="w-full max-w-sm bg-white rounded-xl2 p-6 shadow-lg border border-seafoam">
        <h2 class="font-display font-semibold text-ink text-lg mb-4">{{ t('masterPanel.loginTitle') }}</h2>
        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-ink mb-1.5">{{ t('masterPanel.username') }}</label>
            <input v-model="username" type="text" autocomplete="off" class="w-full border border-slate/30 rounded-lg py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink mb-1.5">{{ t('masterPanel.password') }}</label>
            <PasswordField v-model="password" input-class="w-full border border-slate/30 rounded-lg py-2.5 pl-3 pr-9 focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua" />
          </div>
          <p v-if="error" class="text-coral text-sm">{{ error }}</p>
          <div class="flex gap-2">
            <button type="button" @click="emit('close')" class="flex-1 py-2.5 rounded-lg text-sm font-medium border border-slate/30 text-slate hover:border-aqua/50">{{ t('masterPanel.cancel') }}</button>
            <button type="submit" :disabled="loading" class="flex-1 bg-aqua text-white font-medium py-2.5 rounded-lg hover:bg-deepsea transition-colors disabled:opacity-60">{{ loading ? t('masterPanel.checking') : t('masterPanel.logIn') }}</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

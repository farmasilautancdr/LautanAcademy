<script setup>
import { ref } from 'vue'
import { useMasterAuthStore } from '../store/masterAuth'
import MasterLoginModal from './MasterLoginModal.vue'
import MasterPanel from './MasterPanel.vue'

const masterAuth = useMasterAuthStore()
const showLogin = ref(false)
const showPanel = ref(false)

function handleClick() {
  if (masterAuth.isMasterLoggedIn) showPanel.value = true
  else showLogin.value = true
}

function handleLoginSuccess() {
  showLogin.value = false
  showPanel.value = true
}
</script>

<template>
  <button type="button" @click="handleClick" class="text-slate hover:text-aqua transition-colors shrink-0" aria-label="Master Panel">
    <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  </button>
  <MasterLoginModal v-if="showLogin" @close="showLogin = false" @success="handleLoginSuccess" />
  <MasterPanel v-if="showPanel" @close="showPanel = false" />
</template>

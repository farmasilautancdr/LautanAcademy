<script setup>
// Split out of OutletManagerDashboard.vue — Manage Staff was a section on
// the same page as Create Quiz/Staff Results, but the sidebar's "Assign to
// Staff" item needs a real, distinct destination (it was a placeholder
// pointing at the same bundled page before).
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import ManageStaffPanel from '../components/ManageStaffPanel.vue'

const auth = useAuthStore()
const { t } = useI18n()
const outlet = auth.manager?.outlet
const managerLabel = `Outlet Manager - ${outlet}`
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleOutletManager') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('outletManagerStaffView.title', { outlet }) }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <ManageStaffPanel division="retail" :outlet="outlet" :manager-label="managerLabel" />
    </main>
  </div>
</template>

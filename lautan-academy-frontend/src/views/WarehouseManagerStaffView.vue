<script setup>
// Split out of WarehouseManagerDashboard.vue — see OutletManagerStaffView.vue
// for why (same pattern, "Assign to Staff" repurposed as the real Manage
// Staff destination instead of a placeholder).
import { useAuthStore } from '../store/auth'
import ManageStaffPanel from '../components/ManageStaffPanel.vue'

const auth = useAuthStore()
const location = auth.manager?.outlet
const managerLabel = `Warehouse Manager - ${location}`
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">Warehouse Manager</p>
      <h1 class="font-display text-xl font-semibold text-white">Manage Staff — {{ location }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <ManageStaffPanel division="warehouse" :outlet="location" :manager-label="managerLabel" />
    </main>
  </div>
</template>

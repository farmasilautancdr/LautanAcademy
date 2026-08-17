<script setup>
// Mandatory-course compliance matrix (CPD sub-project C). Self-fetching,
// same pattern as SupervisorPharmacistTagView.vue — no props. Renders
// nothing when staff/courses come back empty, matching the product
// principle of not showing UI for data that doesn't exist. See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const { t } = useI18n()
const staff = ref([])
const courses = ref([])
const cells = ref({})
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.getPharmacistCompliance()
    staff.value = data.staff || []
    courses.value = data.courses || []
    cells.value = data.cells || {}
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false
})

function cell(s, courseTopic) {
  return cells.value[`${s.outlet}|${s.name}`]?.[courseTopic] || { attempted: false }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString()
}
</script>

<template>
  <section v-if="!loading && staff.length && courses.length" class="mb-8">
    <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('pharmacistComplianceMatrix.heading') }}</h2>
    <div class="bg-white rounded-xl2 overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="border-b border-seafoam">
            <th class="text-left px-4 py-3 font-medium text-ink whitespace-nowrap">{{ t('pharmacistComplianceMatrix.staffColumn') }}</th>
            <th v-for="c in courses" :key="c.id" class="text-left px-4 py-3 font-medium text-ink whitespace-nowrap">{{ c.title }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in staff" :key="`${s.outlet}|${s.name}`" class="border-b border-seafoam last:border-0">
            <td class="px-4 py-3 whitespace-nowrap">
              <p class="font-medium text-ink">{{ s.name }}</p>
              <p class="text-xs text-slate">{{ s.outlet }}</p>
            </td>
            <td v-for="c in courses" :key="c.id" class="px-4 py-3 whitespace-nowrap">
              <template v-if="cell(s, c.topic).attempted">
                <span class="font-semibold" :class="cell(s, c.topic).passed ? 'text-aqua' : 'text-coral'">
                  {{ cell(s, c.topic).passed ? t('pharmacistComplianceMatrix.passed') : t('pharmacistComplianceMatrix.failed') }}
                  ({{ cell(s, c.topic).percentage }}%)
                </span>
                <p class="text-xs text-slate">{{ formatDate(cell(s, c.topic).date) }}</p>
              </template>
              <span v-else class="text-slate">{{ t('pharmacistComplianceMatrix.notAttempted') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

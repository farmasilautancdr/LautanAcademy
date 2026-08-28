<script setup>
// One tile in a stat row: colored icon chip + value + label. Icon chip
// color comes from the same accent tokens ProgressRing uses, so a stat
// card and a ring for the same metric can share a color deliberately.
defineProps({
  value: { type: [String, Number], required: true },
  label: { type: String, required: true },
  // Token name, not a hex — keeps every call site on the shared palette.
  accent: { type: String, default: 'aqua', validator: (v) => ['aqua', 'coral', 'seagrass', 'sand'].includes(v) },
  icon: { type: String, default: '' }, // SVG path data, viewBox 0 0 24 24
})

const CHIP_BG = { aqua: 'bg-aqualight', coral: 'bg-coral/10', seagrass: 'bg-seagrasslight', sand: 'bg-sandlight' }
const ICON_STROKE = { aqua: '#1E88C7', coral: '#E8622C', seagrass: '#2E9C6B', sand: '#D99A3E' }
</script>

<template>
  <div class="bg-white rounded-xl2 shadow-sm p-4 flex items-center gap-3 min-w-0">
    <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :class="CHIP_BG[accent]">
      <svg v-if="icon" viewBox="0 0 24 24" class="w-5 h-5" fill="none" :stroke="ICON_STROKE[accent]" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="icon" />
      </svg>
    </div>
    <div class="min-w-0">
      <p class="font-display text-lg font-bold text-ink leading-tight truncate">{{ value }}</p>
      <p class="text-xs text-slate truncate">{{ label }}</p>
    </div>
  </div>
</template>

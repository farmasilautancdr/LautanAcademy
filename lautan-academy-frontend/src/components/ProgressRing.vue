<script setup>
// Signature visual element: a "ripple ring" — progress rendered as a rising
// tide rather than a generic dashboard donut. Ties directly to "Lautan"
// (ocean) instead of being an arbitrary circular progress bar.
const props = defineProps({
  percent: { type: Number, required: true },
  size: { type: Number, default: 72 },
  accent: { type: String, default: '#17A398' }, // aqua by default
})

const radius = 30
const circumference = 2 * Math.PI * radius
const offset = () => circumference - (props.percent / 100) * circumference

// Label only fits comfortably above ~56px — smaller badge sizes (e.g. the
// 40px list-row indicators) show as a plain ring instead of squeezing text.
const showLabel = props.size >= 56
const labelClass = props.size >= 100 ? 'text-2xl' : props.size >= 80 ? 'text-base' : 'text-sm'
</script>

<template>
  <div class="relative inline-flex items-center justify-center" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" viewBox="0 0 72 72" class="-rotate-90">
      <circle cx="36" cy="36" :r="radius" fill="none" stroke="#E4EEEC" stroke-width="6" />
      <circle
        cx="36" cy="36" :r="radius" fill="none"
        :stroke="accent" stroke-width="6" stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset()"
        class="transition-all duration-700 ease-out"
      />
    </svg>
    <span v-if="showLabel" class="absolute font-display font-semibold text-ink" :class="labelClass">{{ percent }}%</span>
  </div>
</template>

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
    <span class="absolute font-display text-sm font-semibold text-ink">{{ percent }}%</span>
  </div>
</template>

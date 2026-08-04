<script setup>
// Signature visual element: a "ripple ring" — progress rendered as a rising
// tide rather than a generic dashboard donut. Ties directly to "Lautan"
// (ocean) instead of being an arbitrary circular progress bar.
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  percent: { type: Number, required: true },
  size: { type: Number, default: 72 },
  accent: { type: String, default: '#17A398' }, // aqua by default
  // Opt-in: tide rises from 0 on mount instead of painting at final value.
  // Off by default so every other use of this ring (badges, list rows,
  // manager dashboards) keeps its current instant-paint behavior.
  animateCount: { type: Boolean, default: false },
})

const radius = 30
const circumference = 2 * Math.PI * radius

const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const displayPercent = ref(props.animateCount && !reduceMotion ? 0 : props.percent)
const offset = () => circumference - (displayPercent.value / 100) * circumference

function tweenTo(target) {
  if (reduceMotion) { displayPercent.value = target; return }
  const start = displayPercent.value
  const startTime = performance.now()
  const duration = 700
  function step(now) {
    const t = Math.min(1, (now - startTime) / duration)
    const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic, matches the ring's CSS easing
    displayPercent.value = Math.round(start + (target - start) * eased)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

onMounted(() => { if (props.animateCount) tweenTo(props.percent) })
watch(() => props.percent, (v) => { if (props.animateCount) tweenTo(v); else displayPercent.value = v })

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
        :class="animateCount ? '' : 'transition-all duration-700 ease-out'"
      />
    </svg>
    <span v-if="showLabel" class="absolute font-display font-semibold text-ink" :class="labelClass">{{ displayPercent }}%</span>
  </div>
</template>

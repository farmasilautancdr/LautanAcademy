<script setup>
// Icon-only by design (per user request — the word "Attempted" read as
// too long inline) with a full-word title/aria-label so the meaning still
// reaches a screen reader or a hovering mouse, not color/shape alone.
defineProps({
  label: { type: String, required: true },
  size: { type: Number, default: 20 },
})
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-full bg-seagrass shrink-0"
    :style="{ width: size + 'px', height: size + 'px' }"
    :title="label"
    :aria-label="label"
    role="img"
  >
    <svg viewBox="0 0 24 24" class="w-1/2 h-1/2" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  </span>
</template>

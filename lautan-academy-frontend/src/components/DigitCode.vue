<script setup>
// Segmented numeric code entry — auto-advances per digit, backspace steps
// back, paste fills across boxes. Used for both the login PIN (4 digits)
// and the practice-quiz join code (3 digits) rather than a single masked
// text field, which reads as an afterthought for a numeric code.
import { ref, computed, watch } from 'vue'

const props = defineProps({
  length: { type: Number, required: true },
  modelValue: { type: String, default: '' },
  masked: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const digits = ref(Array.from({ length: props.length }, (_, i) => props.modelValue[i] || ''))
const inputs = ref([])

watch(() => props.modelValue, (v) => {
  if (v === digits.value.join('')) return
  digits.value = Array.from({ length: props.length }, (_, i) => v[i] || '')
})

function onInput(i, e) {
  const v = e.target.value.replace(/\D/g, '').slice(-1)
  digits.value[i] = v
  emit('update:modelValue', digits.value.join(''))
  if (v && i < props.length - 1) inputs.value[i + 1]?.focus()
}
function onKeydown(i, e) {
  if (e.key === 'Backspace' && !digits.value[i] && i > 0) inputs.value[i - 1]?.focus()
}
function onPaste(e) {
  const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, props.length)
  if (!text) return
  e.preventDefault()
  text.split('').forEach((d, i) => { digits.value[i] = d })
  emit('update:modelValue', digits.value.join(''))
  inputs.value[Math.min(text.length, props.length - 1)]?.focus()
}

defineExpose({ focus: () => inputs.value[0]?.focus() })
</script>

<template>
  <div class="flex justify-center gap-3" @paste="onPaste">
    <input
      v-for="(d, i) in digits"
      :key="i"
      :ref="el => inputs[i] = el"
      :value="digits[i]"
      @input="onInput(i, $event)"
      @keydown="onKeydown(i, $event)"
      :type="masked ? 'password' : 'text'"
      inputmode="numeric"
      maxlength="1"
      :aria-label="`Digit ${i + 1}`"
      class="w-12 h-14 text-center text-2xl font-display font-semibold border border-slate/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-aqua/50 focus:border-aqua"
    />
  </div>
</template>

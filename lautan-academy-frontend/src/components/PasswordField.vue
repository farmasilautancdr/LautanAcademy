<script setup>
import { ref } from 'vue'

defineProps({
  modelValue: { type: String, default: '' },
  id: { type: String, default: undefined },
  placeholder: { type: String, default: '' },
  autofocus: { type: Boolean, default: false },
  inputClass: { type: String, default: '' },
})
defineEmits(['update:modelValue'])

const showPassword = ref(false)
</script>

<template>
  <div class="relative">
    <input
      :id="id"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      :type="showPassword ? 'text' : 'password'"
      :placeholder="placeholder"
      :autofocus="autofocus"
      :class="inputClass"
    />
    <button
      type="button"
      tabindex="-1"
      :aria-label="showPassword ? 'Hide password' : 'Show password'"
      @click="showPassword = !showPassword"
      class="absolute inset-y-0 right-0 flex items-center px-3 text-slate hover:text-aqua"
    >
      <svg v-if="showPassword" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.5 18.5 0 0 1 4.22-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="M1 12s3-8 11-8 11 8 11 8-3 8-11 8-11-8-11-8Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  </div>
</template>

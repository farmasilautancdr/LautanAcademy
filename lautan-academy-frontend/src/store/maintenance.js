// Tracks whether the app-wide maintenance kill-switch (Master Subsystem D)
// is currently on. Two writers: check() (an explicit status read, used on
// app boot and by the overlay's retry button) and api/client.js's
// request() (an implicit write, triggered the moment any real API call
// comes back with the maintenance 503 shape). See
// docs/superpowers/specs/2026-08-11-master-subsystem-d-design.md.
import { defineStore } from 'pinia'
import { api } from '../api/client'

export const useMaintenanceStore = defineStore('maintenance', {
  state: () => ({
    active: false,
    message: '',
  }),

  actions: {
    async check() {
      try {
        const data = await api.getMaintenanceStatus()
        this.active = !!data.enabled
        this.message = data.message || ''
      } catch {
        // Network/other failure reading the status itself — leave the
        // current state as-is rather than forcing the overlay open on a
        // transient error unrelated to the actual kill-switch.
      }
    },
  },
})

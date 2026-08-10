// Fully independent of useAuthStore (src/store/auth.js) — separate
// localStorage key, separate state, never read or written by the
// existing staff/manager session. Opening/closing the Master Panel must
// never disturb whatever role session (if any) is active. See
// docs/superpowers/specs/2026-08-10-master-admin-subsystem-a-design.md.
import { defineStore } from 'pinia'
import { api } from '../api/client'

export const useMasterAuthStore = defineStore('masterAuth', {
  state: () => ({
    token: localStorage.getItem('lautan_master_token') || null,
  }),

  getters: {
    isMasterLoggedIn: (state) => !!state.token,
  },

  actions: {
    async login(username, password) {
      const data = await api.masterLogin(username, password)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      localStorage.setItem('lautan_master_token', data.token)
    },

    logout() {
      this.token = null
      localStorage.removeItem('lautan_master_token')
    },
  },
})

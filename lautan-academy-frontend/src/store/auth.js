import { defineStore } from 'pinia'
import { api } from '../api/client'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('lautan_token') || null,
    staff: JSON.parse(localStorage.getItem('lautan_staff') || 'null'),
  }),

  getters: {
    isLoggedIn: (state) => !!state.token,
  },

  actions: {
    // Real backend only returns { authorized, token } — no staff object, so
    // it's built from what was typed in rather than echoed back.
    async login(division, outlet, name, pin) {
      const data = await api.login(division, outlet, name, pin)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      this.staff = { name, outlet, division }
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_staff', JSON.stringify(this.staff))
    },

    logout() {
      this.token = null
      this.staff = null
      localStorage.removeItem('lautan_token')
      localStorage.removeItem('lautan_staff')
    },
  },
})

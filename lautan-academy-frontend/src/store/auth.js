import { defineStore } from 'pinia'
import { api } from '../api/client'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('lautan_token') || null,
    staff: JSON.parse(localStorage.getItem('lautan_staff') || 'null'),
    manager: JSON.parse(localStorage.getItem('lautan_manager') || 'null'),
  }),

  getters: {
    isLoggedIn: (state) => !!state.token,
    isStaff: (state) => !!state.staff,
    isManager: (state) => !!state.manager,
  },

  actions: {
    // Real backend only returns { authorized, token } — no staff object, so
    // it's built from what was typed in rather than echoed back.
    async login(division, outlet, name, pin) {
      const data = await api.login(division, outlet, name, pin)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      this.staff = { name, outlet, division }
      this.manager = null
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_staff', JSON.stringify(this.staff))
      localStorage.removeItem('lautan_manager')
    },

    // role: outlet_manager | warehouse_manager | area_manager | supervisor
    async loginManager(role, outlet, pin) {
      const data = await api.managerLogin(role, outlet, pin)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      this.manager = { role, outlet }
      this.staff = null
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_manager', JSON.stringify(this.manager))
      localStorage.removeItem('lautan_staff')
    },

    logout() {
      this.token = null
      this.staff = null
      this.manager = null
      localStorage.removeItem('lautan_token')
      localStorage.removeItem('lautan_staff')
      localStorage.removeItem('lautan_manager')
    },
  },
})

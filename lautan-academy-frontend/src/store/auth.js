import { defineStore } from 'pinia'
import { api } from '../api/client'
import { useMasterAuthStore } from './masterAuth'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('lautan_token') || null,
    staff: JSON.parse(localStorage.getItem('lautan_staff') || 'null'),
    manager: JSON.parse(localStorage.getItem('lautan_manager') || 'null'),
    impersonating: localStorage.getItem('lautan_impersonating') === '1',
    impersonationSessionId: localStorage.getItem('lautan_impersonation_session_id') || null,
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

    // role: outlet_manager | warehouse_manager | area_manager | supervisor.
    // label is an optional display identity (e.g. Area Manager's picked
    // area "R2 - HAZWANI") — used as the "manager" field on report
    // submissions, matching GAS's disp-mgr-name. Not needed for roles that
    // don't file reports.
    // outlet doubles as the area id for area_manager (server scopes to that
    // whole region, not one outlet — see backend's config/areas.js). outlets
    // is that region's outlet list, client-side only, for building pickers —
    // the backend independently re-resolves and enforces it server-side.
    async loginManager(role, outlet, pin, label = '', outlets = null) {
      const data = await api.managerLogin(role, outlet, pin)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      this.manager = { role, outlet, label, outlets }
      this.staff = null
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_manager', JSON.stringify(this.manager))
      localStorage.removeItem('lautan_staff')
    },

    // Same response shape as loginManager (manager-register returns
    // { authorized, token } on success too) — registering also logs you
    // in immediately, no separate login step needed after.
    async registerManager(role, outlet, masterPin, newPassword, label = '', outlets = null) {
      const data = await api.managerRegister({ role, outlet, masterPin, newPassword })
      if (!data.authorized) throw new Error(data.error || 'Registration failed')
      this.token = data.token
      this.manager = { role, outlet, label, outlets }
      this.staff = null
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_manager', JSON.stringify(this.manager))
      localStorage.removeItem('lautan_staff')
    },

    // Master Subsystem H. Stashes whatever real session is currently live
    // (if any) into a separate key before overwriting the shared
    // lautan_token/staff/manager keys api/client.js and every existing view
    // already read directly — this is what lets every dashboard/history
    // view work unmodified under an impersonated identity, without
    // clobbering a real concurrent session in the same browser. See
    // docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
    startImpersonation(token, staff, manager, sessionId) {
      const stash = { token: this.token, staff: this.staff, manager: this.manager }
      localStorage.setItem('lautan_stash', JSON.stringify(stash))
      this.token = token
      this.staff = staff
      this.manager = manager
      this.impersonating = true
      this.impersonationSessionId = sessionId
      localStorage.setItem('lautan_token', token)
      localStorage.setItem('lautan_staff', JSON.stringify(staff))
      localStorage.setItem('lautan_manager', JSON.stringify(manager))
      localStorage.setItem('lautan_impersonating', '1')
      localStorage.setItem('lautan_impersonation_session_id', sessionId)
    },

    // Called manually (Exit button) or automatically (api/client.js's 401
    // handler, on the 30-minute expiry or a Master force-logout via Active
    // Sessions). Best-effort backend call — if it fails (e.g. Master's own
    // token has also expired), the local restore still happens so the user
    // is never stuck impersonating with no way out.
    async exitImpersonation() {
      if (this.impersonationSessionId) {
        try {
          const masterAuth = useMasterAuthStore()
          if (masterAuth.token) await api.masterImpersonateEnd(this.impersonationSessionId, masterAuth.token)
        } catch (e) {
          console.error('exitImpersonation: backend end call failed:', e.message)
        }
      }
      const stash = JSON.parse(localStorage.getItem('lautan_stash') || 'null')
      this.token = stash?.token || null
      this.staff = stash?.staff || null
      this.manager = stash?.manager || null
      this.impersonating = false
      this.impersonationSessionId = null
      if (stash?.token) {
        localStorage.setItem('lautan_token', stash.token)
        localStorage.setItem('lautan_staff', JSON.stringify(stash.staff))
        localStorage.setItem('lautan_manager', JSON.stringify(stash.manager))
      } else {
        localStorage.removeItem('lautan_token')
        localStorage.removeItem('lautan_staff')
        localStorage.removeItem('lautan_manager')
      }
      localStorage.removeItem('lautan_stash')
      localStorage.removeItem('lautan_impersonating')
      localStorage.removeItem('lautan_impersonation_session_id')
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

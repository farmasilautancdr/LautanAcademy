import { ref, computed } from 'vue'
import { api } from '../api/client'

const ACTIVE_WINDOW_DAYS = 30

function isWithinWindow(timestamp, days) {
  if (!timestamp) return false
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000
}

// `results` (Module Quiz/Video Training/Content Quiz, distinguished only by
// topic elsewhere) and `aiResults` (AI Practice) are the two tables every
// other manager/supervisor activity page already reads — "any attempt"
// means a row in either.
function lastAttemptByName(rows) {
  const map = new Map()
  for (const r of rows) {
    const ts = new Date(r.Timestamp).getTime()
    const prev = map.get(r.Name)
    if (!prev || ts > prev) map.set(r.Name, ts)
  }
  return map
}

// Outlet/Warehouse Manager: full roster (so a staff member with zero
// attempts still shows up as inactive, not silently missing) cross-
// referenced against their last attempt. getScopedData(0) is session-scoped
// server-side to this manager's own outlet already, same as every other
// manager page.
export function useOutletStaffActivity(division, outlet) {
  const loading = ref(true)
  const roster = ref([])
  const lastAttempt = ref(new Map())

  async function load() {
    loading.value = true
    try {
      const [rosterRes, scoped] = await Promise.all([
        api.getStaffRosterFull(division, outlet),
        api.getScopedData(0),
      ])
      roster.value = rosterRes.staff || []
      lastAttempt.value = lastAttemptByName([...(scoped.results || []), ...(scoped.aiResults || [])])
    } catch (e) { /* leave empty */ }
    loading.value = false
  }
  load()

  const staff = computed(() => roster.value
    .map((s) => {
      const ts = lastAttempt.value.get(s.Name) || null
      return { name: s.Name, idNote: s.IDNote, lastAttempt: ts, active: isWithinWindow(ts, ACTIVE_WINDOW_DAYS) }
    })
    .sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : (a.active ? 1 : -1))))

  return {
    loading,
    staff,
    activeCount: computed(() => staff.value.filter((s) => s.active).length),
    totalCount: computed(() => staff.value.length),
    ACTIVE_WINDOW_DAYS,
  }
}

// Area Manager: no cross-outlet roster endpoint exists (staff-roster-manage
// is outlet_manager/warehouse_manager-scoped, /all is supervisor-only), so
// there's no total-staff count to show per outlet here — only who has
// recent activity. Outlets come from auth.manager.outlets (already how
// AreaManagerDashboard.vue enumerates the region).
export function useAreaStaffActivity(outlets) {
  const loading = ref(true)
  const rows = ref([])

  async function load() {
    loading.value = true
    try {
      const scoped = await api.getScopedData(0)
      rows.value = [...(scoped.results || []), ...(scoped.aiResults || [])]
    } catch (e) { /* leave empty */ }
    loading.value = false
  }
  load()

  const outletActivity = computed(() => outlets
    .map((outlet) => {
      const lastAttempt = lastAttemptByName(rows.value.filter((r) => r.Outlet === outlet))
      const activeStaff = [...lastAttempt.entries()]
        .filter(([, ts]) => isWithinWindow(ts, ACTIVE_WINDOW_DAYS))
        .map(([name]) => name)
        .sort()
      return { outlet, activeStaff, activeCount: activeStaff.length }
    })
    .sort((a, b) => {
      if ((a.activeCount === 0) !== (b.activeCount === 0)) return a.activeCount === 0 ? -1 : 1
      return a.outlet.localeCompare(b.outlet)
    }))

  return {
    loading,
    outletActivity,
    activeOutletCount: computed(() => outletActivity.value.filter((o) => o.activeCount > 0).length),
    totalOutletCount: outlets.length,
    ACTIVE_WINDOW_DAYS,
  }
}

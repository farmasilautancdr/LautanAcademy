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
// means a row in either. Keyed by Name+Outlet, not Name alone — staff names
// aren't unique across a region's outlets (see AreaManagerDashboard.vue's
// wrongsFor fallback for the same caveat).
function lastAttemptByStaffKey(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = `${r.Name}|${r.Outlet}`
    const ts = new Date(r.Timestamp).getTime()
    const prev = map.get(key)
    if (!prev || ts > prev) map.set(key, ts)
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
      lastAttempt.value = lastAttemptByStaffKey([...(scoped.results || []), ...(scoped.aiResults || [])])
    } catch (e) { /* leave empty */ }
    loading.value = false
  }
  load()

  const staff = computed(() => roster.value
    .map((s) => {
      const ts = lastAttempt.value.get(`${s.Name}|${outlet}`) || null
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

// Area Manager: roster comes from /staff-roster-manage/region (server-scoped
// to this manager's own region, same outletsForArea lookup /scoped-data
// already uses) — gives a real total-staff count per outlet, including
// staff who've never attempted anything, not just "no attempt in 30 days".
export function useAreaStaffActivity(outlets) {
  const loading = ref(true)
  const roster = ref([])
  const lastAttempt = ref(new Map())

  async function load() {
    loading.value = true
    try {
      const [rosterRes, scoped] = await Promise.all([
        api.getRegionStaffRoster(),
        api.getScopedData(0),
      ])
      roster.value = rosterRes.staff || []
      lastAttempt.value = lastAttemptByStaffKey([...(scoped.results || []), ...(scoped.aiResults || [])])
    } catch (e) { /* leave empty */ }
    loading.value = false
  }
  load()

  const outletActivity = computed(() => outlets
    .map((outlet) => {
      const staff = roster.value
        .filter((s) => s.Outlet === outlet)
        .map((s) => {
          const ts = lastAttempt.value.get(`${s.Name}|${outlet}`) || null
          return { name: s.Name, idNote: s.IDNote, lastAttempt: ts, active: isWithinWindow(ts, ACTIVE_WINDOW_DAYS) }
        })
        .sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : (a.active ? 1 : -1)))
      return { outlet, staff, activeCount: staff.filter((s) => s.active).length, totalCount: staff.length }
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

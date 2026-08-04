<script setup>
// Role-aware nav drawer. The spec this was built from assumed 3 roles
// ('staff' | 'manager' | 'area_manager') — the real auth store has 5
// distinct login identities instead: staff, outlet_manager,
// warehouse_manager, area_manager, supervisor (store/auth.js has no
// `role` field on auth.staff at all). Adapted to the real roles per
// instruction, not built against the literal spec's role model.
//
// Route honesty: most nav items below point at real, working pages; a
// couple point at routes that don't exist yet because the underlying page
// hasn't been built (Assign to Staff, and the whole Cross-Outlet section
// for Area Manager — that role is scoped to one outlet per login in the
// real system, it has no cross-outlet view today). Each is commented at
// its definition below — see this session's chat reply for the full list,
// not silently faked here.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'

const props = defineProps({
  // No real "pending reviews" concept exists yet (Reports are just
  // filed/not-filed, no review-queue state) — defaults hidden until a real
  // count exists to pass in.
  pendingReviewCount: { type: Number, default: 0 },
})

const router = useRouter()
const auth = useAuthStore()

const managerRole = computed(() => auth.manager?.role || null)
const isOutletOrWarehouseManager = computed(() => managerRole.value === 'outlet_manager' || managerRole.value === 'warehouse_manager')
const isAreaManager = computed(() => managerRole.value === 'area_manager')
const isSupervisor = computed(() => managerRole.value === 'supervisor')
const managerHomePath = computed(() => managerRole.value === 'warehouse_manager' ? '/warehouse-manager' : '/manager')

const ROLE_LABELS = { outlet_manager: 'Outlet Manager', warehouse_manager: 'Warehouse Manager', area_manager: 'Area Manager', supervisor: 'Supervisor' }
const roleLabel = computed(() => auth.isStaff ? 'Staff' : (ROLE_LABELS[managerRole.value] || ''))
const displayName = computed(() => (auth.isStaff ? auth.staff.name : auth.manager?.label) || roleLabel.value)
const avatarInitial = computed(() => (displayName.value || '?').trim().charAt(0).toUpperCase())
const subtitle = computed(() => auth.isStaff ? 'Staff Training' : roleLabel.value)

const sections = computed(() => {
  const groups = []

  if (auth.isStaff) {
    groups.push({
      label: 'My Learning',
      items: [
        { label: 'My Learning', to: '/', icon: 'home' },
        { label: 'Quiz History', to: '/history', icon: 'history' },
        { label: 'Resources', to: '/resources', icon: 'book' },
      ],
    })
  }

  if (isOutletOrWarehouseManager.value) {
    groups.push({
      label: 'Quiz Management',
      items: [
        // Real — quiz-create form already lives on this manager's dashboard.
        { label: 'Create Quiz', to: managerHomePath.value, icon: 'plus' },
        // Not a distinct real feature — quizzes are joined by passcode, not
        // individually assigned to specific staff. Routes to the same
        // dashboard rather than a page that doesn't exist.
        { label: 'Assign to Staff', to: managerHomePath.value, icon: 'send' },
      ],
    })
    groups.push({
      label: 'Outlet Performance',
      items: [
        { label: 'Staff Results', to: managerHomePath.value, icon: 'chart' },
      ],
    })
  }

  if (isAreaManager.value) {
    groups.push({
      label: 'Outlet Performance',
      items: [
        { label: 'Staff Results', to: '/area-manager', icon: 'chart' },
        // Real — this is the Filed Reports section on the Area Manager
        // dashboard. No "pending" state exists in the data model yet.
        { label: 'Reviews', to: '/area-manager', icon: 'clipboard', badge: props.pendingReviewCount },
      ],
    })
  }

  // Cross-outlet: neither role has this as a real feature today. Area
  // Manager is scoped to one outlet per login session, not cross-outlet.
  // Supervisor's actual company-wide view (/supervisor) already covers
  // stats + activity log on one page, not three separate ones. Included
  // per spec with routes that need real pages built — not hidden, not faked.
  if (isAreaManager.value || isSupervisor.value) {
    groups.push({
      label: 'Cross-Outlet',
      items: [
        { label: 'All Outlets', to: isSupervisor.value ? '/supervisor' : '/am/outlets', icon: 'grid' },
        { label: 'Staff Comparison', to: '/am/compare', icon: 'users' },
        { label: 'Cluster Reports', to: '/am/reports', icon: 'file' },
      ],
    })
  }

  return groups
})

// Default open; only collapsed once a user explicitly toggles it shut.
const collapsed = ref({})
function isOpen(label) { return !collapsed.value[label] }
function toggle(label) { collapsed.value[label] = isOpen(label) }

async function handleLogout() {
  auth.logout()
  if (isAreaManager.value) router.push('/area-manager-login')
  else if (isSupervisor.value) router.push('/supervisor-login')
  else if (isOutletOrWarehouseManager.value) router.push('/manager-login')
  else router.push('/login')
}

const ICONS = {
  home: 'M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9',
  history: 'M12 8v4l3 2M4 12a8 8 0 1 1 2.5 5.8M4 12H2m2 0 2.5-2.5M4 12l2.5 2.5',
  book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z',
  plus: 'M12 5v14M5 12h14',
  send: 'M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z',
  chart: 'M4 20V10M4 20h16M10 20V4M16 20v-7',
  clipboard: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 12h6M9 16h6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  users: 'M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  chevron: 'm6 9 6 6 6-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
}
</script>

<template>
  <aside class="w-64 h-screen bg-white border-r border-seafoam flex flex-col shrink-0">
    <div class="px-5 py-6 flex items-center gap-3 border-b border-seafoam">
      <div class="w-10 h-10 rounded-xl2 bg-aqua flex items-center justify-center shrink-0">
        <span class="font-display text-white font-bold text-lg">L</span>
      </div>
      <div class="min-w-0">
        <p class="font-display font-semibold text-ink text-sm leading-tight truncate">Lautan Academy</p>
        <p class="text-xs text-slate truncate">{{ subtitle }}</p>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      <div v-for="group in sections" :key="group.label">
        <button
          type="button"
          @click="toggle(group.label)"
          class="w-full flex items-center justify-between px-2 py-2 text-left"
        >
          <span class="text-[11px] font-semibold text-slate uppercase tracking-wider">{{ group.label }}</span>
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 text-slate transition-transform" :class="{ '-rotate-90': !isOpen(group.label) }" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path :d="ICONS.chevron" />
          </svg>
        </button>

        <div v-show="isOpen(group.label)" class="space-y-0.5 mb-2">
          <RouterLink
            v-for="item in group.items"
            :key="item.label"
            :to="item.to"
            custom
            v-slot="{ isActive, navigate }"
          >
            <button
              type="button"
              @click="navigate"
              class="w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm transition-colors"
              :class="isActive ? 'bg-aqua text-white font-medium' : 'text-ink hover:bg-seafoam'"
            >
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" :stroke="isActive ? 'white' : 'currentColor'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ICONS[item.icon]" />
              </svg>
              <span class="flex-1 text-left truncate">{{ item.label }}</span>
              <span v-if="item.badge" class="text-[10px] font-bold text-white bg-coral rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
                {{ item.badge }}
              </span>
            </button>
          </RouterLink>
        </div>
      </div>
    </nav>

    <div class="px-4 py-4 border-t border-seafoam flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-aqualight flex items-center justify-center shrink-0">
        <span class="font-display font-semibold text-deepsea text-sm">{{ avatarInitial }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-ink truncate">{{ displayName }}</p>
        <p class="text-xs text-slate truncate">{{ roleLabel }}</p>
      </div>
      <button type="button" @click="handleLogout" class="text-slate hover:text-coral transition-colors shrink-0" aria-label="Log out">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path :d="ICONS.logout" />
        </svg>
      </button>
    </div>
  </aside>
</template>

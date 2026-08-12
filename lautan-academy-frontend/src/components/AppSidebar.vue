<script setup>
// Role-aware nav drawer. The spec this was built from assumed 3 roles
// ('staff' | 'manager' | 'area_manager') — the real auth store has 5
// distinct login identities instead: staff, outlet_manager,
// warehouse_manager, area_manager, supervisor (store/auth.js has no
// `role` field on auth.staff at all). Adapted to the real roles per
// instruction, not built against the literal spec's role model.
//
// Route honesty: every nav item now points at a real, distinct page except
// the Cross-Outlet section for Area Manager/Supervisor — that role is
// scoped to one outlet per login in the real system (Area Manager) or
// already covers everything on one page (Supervisor), so those routes
// don't have real pages built yet. Commented at their definition below.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import logoUrl from '../assets/logo-transparent.png'
import LanguageSwitcher from './LanguageSwitcher.vue'

const props = defineProps({
  // No real "pending reviews" concept exists yet (Reports are just
  // filed/not-filed, no review-queue state) — defaults hidden until a real
  // count exists to pass in.
  pendingReviewCount: { type: Number, default: 0 },
})

const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()

const managerRole = computed(() => auth.manager?.role || null)
const isOutletOrWarehouseManager = computed(() => managerRole.value === 'outlet_manager' || managerRole.value === 'warehouse_manager')
const isAreaManager = computed(() => managerRole.value === 'area_manager')
const isSupervisor = computed(() => managerRole.value === 'supervisor')
const managerHomePath = computed(() => managerRole.value === 'warehouse_manager' ? '/warehouse-manager' : '/manager')
const managerStaffPath = computed(() => `${managerHomePath.value}/staff`)
const managerResultsPath = computed(() => `${managerHomePath.value}/results`)
// Area Manager's home path differs from managerHomePath (which only
// branches outlet vs. warehouse); Supervisor's home is /supervisor.
const managerResourcesPath = computed(() => {
  if (isAreaManager.value) return '/area-manager/resources'
  if (isSupervisor.value) return '/supervisor/resources'
  return `${managerHomePath.value}/resources`
})

const ROLE_LABEL_KEYS = { outlet_manager: 'roleOutletManager', warehouse_manager: 'roleWarehouseManager', area_manager: 'roleAreaManager', supervisor: 'roleSupervisor' }
const roleLabel = computed(() => auth.isStaff ? t('sidebar.roleStaff') : (ROLE_LABEL_KEYS[managerRole.value] ? t(`sidebar.${ROLE_LABEL_KEYS[managerRole.value]}`) : ''))
const displayName = computed(() => (auth.isStaff ? auth.staff.name : auth.manager?.label) || roleLabel.value)
const avatarInitial = computed(() => (displayName.value || '?').trim().charAt(0).toUpperCase())
const subtitle = computed(() => auth.isStaff ? t('sidebar.staffTraining') : roleLabel.value)

const sections = computed(() => {
  const groups = []

  if (auth.isStaff) {
    // Restructured to mirror the manager sidebars' multiple-named-groups
    // pattern instead of one flat list — same collapsible mechanism below,
    // just more than one group to collapse.
    groups.push({ label: t('sidebar.groupMyLearning'), items: [{ label: t('sidebar.dashboard'), to: '/', icon: 'home' }] })

    // Module Quiz (Standard Quiz question bank) is retail-only — matches
    // GAS, which never gave warehouse staff anything but AI Practice.
    const quizItems = []
    if (auth.staff?.division === 'retail') quizItems.push({ label: t('sidebar.moduleQuiz'), to: '/module-quiz', icon: 'clipboard' })
    if (auth.staff?.division === 'retail') quizItems.push({ label: t('sidebar.videoTraining'), to: '/video-training', icon: 'video' })
    quizItems.push({ label: t('sidebar.quizHistory'), to: '/history', icon: 'history' })
    groups.push({ label: t('sidebar.groupQuizzes'), items: quizItems })

    groups.push({ label: t('sidebar.groupBrowseCourses'), items: [{ label: t('sidebar.browseCourses'), to: '/resources', icon: 'book' }] })
  }

  if (isOutletOrWarehouseManager.value) {
    groups.push({
      label: t('sidebar.groupQuizManagement'),
      items: [
        { label: t('sidebar.createQuiz'), to: managerHomePath.value, icon: 'plus' },
      ],
    })
    groups.push({
      label: t('sidebar.groupAssignStaff'),
      // Repurposed from a placeholder — "assigning" isn't a real concept
      // (quizzes are joined by passcode), but Manage Staff is a real,
      // working feature that fits this section better than dead-ending.
      items: [{ label: t('sidebar.staffRoster'), to: managerStaffPath.value, icon: 'send' }],
    })
    const performanceItems = [{ label: t('sidebar.staffResults'), to: managerResultsPath.value, icon: 'chart' }]
    if (managerRole.value === 'outlet_manager') {
      performanceItems.push({ label: t('sidebar.staffReview'), to: '/manager/staff-review', icon: 'clipboard' })
    }
    groups.push({ label: t('sidebar.groupOutletPerformance'), items: performanceItems })
    groups.push({
      label: t('sidebar.groupBrowseCourses'),
      items: [{ label: t('sidebar.browseCourses'), to: managerResourcesPath.value, icon: 'book' }],
    })
  }

  if (isAreaManager.value) {
    groups.push({
      label: t('sidebar.groupOutletPerformance'),
      items: [
        { label: t('sidebar.staffResults'), to: '/area-manager', icon: 'chart' },
        // Real — File a Report + Filed Reports, its own page now. No
        // "pending" state exists in the data model yet.
        { label: t('sidebar.assessment'), to: '/area-manager/reviews', icon: 'clipboard', badge: props.pendingReviewCount },
      ],
    })
    groups.push({
      label: t('sidebar.groupBrowseCourses'),
      items: [{ label: t('sidebar.browseCourses'), to: managerResourcesPath.value, icon: 'book' }],
    })
  }

  // Cross-outlet: Supervisor only. Area Manager now scopes to their whole
  // region (see store/auth.js, backend's areas/store_outlets tables) —
  // "Staff Results" in the Outlet Performance group above already covers every outlet in
  // that region on one page, so a separate Cross-Outlet section here would
  // just duplicate the same link. All 3 items are real pages.
  if (isSupervisor.value) {
    groups.push({
      label: t('sidebar.groupCrossOutlet'),
      items: [
        { label: t('sidebar.allOutlets'), to: '/supervisor', icon: 'grid' },
        { label: t('sidebar.staffComparison'), to: '/supervisor/staff-comparison', icon: 'users' },
        { label: t('sidebar.clusterReports'), to: '/supervisor/reports', icon: 'file' },
        { label: t('sidebar.managerAccess'), to: '/supervisor/manager-access', icon: 'key' },
      ],
    })
    groups.push({
      label: t('sidebar.groupBrowseCourses'),
      items: [
        { label: t('sidebar.browseCourses'), to: managerResourcesPath.value, icon: 'book' },
        { label: t('sidebar.addResources'), to: '/supervisor/add-resources', icon: 'plus' },
      ],
    })
  }

  return groups
})

// Default open; only collapsed once a user explicitly toggles it shut.
const collapsed = ref({})
function isOpen(label) { return !collapsed.value[label] }
function toggle(label) { collapsed.value[label] = isOpen(label) }

// Mobile bottom nav: the whole <aside> (including its footer logout
// button) hides below md, so every real destination — logout included —
// needs to be reachable from this flat icon row instead.
const flatItems = computed(() => sections.value.flatMap(g => g.items))

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
  video: 'M23 7l-7 5 7 5V7zM1 5h15v14H1z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  users: 'M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  key: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
  chevron: 'm6 9 6 6 6-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
}
</script>

<template>
  <aside class="hidden md:flex w-64 h-screen sticky top-0 bg-white border-r border-seafoam flex-col shrink-0">
    <div class="px-5 py-6 flex items-center gap-3 border-b border-seafoam">
      <div class="w-10 h-10 shrink-0">
        <img :src="logoUrl" alt="Lautan Academy" class="w-full h-full object-contain" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-display font-semibold text-ink text-sm leading-tight truncate">Lautan Academy</p>
        <p class="text-xs text-slate truncate">{{ subtitle }}</p>
      </div>
      <div class="flex items-center gap-2">
        <LanguageSwitcher />
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
      <button type="button" @click="handleLogout" class="text-slate hover:text-coral transition-colors shrink-0" :aria-label="t('sidebar.logOut')">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path :d="ICONS.logout" />
        </svg>
      </button>
    </div>
  </aside>

  <nav class="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-seafoam flex items-stretch pb-[env(safe-area-inset-bottom)]" aria-label="Primary">
    <RouterLink
      v-for="item in flatItems"
      :key="item.label"
      :to="item.to"
      custom
      v-slot="{ isActive, navigate }"
    >
      <button
        type="button"
        @click="navigate"
        class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-0"
        :class="isActive ? 'text-aqua' : 'text-slate'"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path :d="ICONS[item.icon]" />
        </svg>
        <span class="text-[10px] font-medium truncate max-w-full px-0.5">{{ item.label }}</span>
      </button>
    </RouterLink>
    <button type="button" @click="handleLogout" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-0 text-slate" :aria-label="t('sidebar.logOut')">
      <svg viewBox="0 0 24 24" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="ICONS.logout" />
      </svg>
      <span class="text-[10px] font-medium">{{ t('sidebar.logOut') }}</span>
    </button>
  </nav>
</template>

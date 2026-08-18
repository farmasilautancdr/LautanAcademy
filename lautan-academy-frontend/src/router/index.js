import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../store/auth'

import LoginView from '../views/LoginView.vue'
import ManagerLoginView from '../views/ManagerLoginView.vue'
import AreaManagerLoginView from '../views/AreaManagerLoginView.vue'
import ManagerRegisterView from '../views/ManagerRegisterView.vue'
import AreaManagerRegisterView from '../views/AreaManagerRegisterView.vue'
import SupervisorLoginView from '../views/SupervisorLoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import QuizHistoryView from '../views/QuizHistoryView.vue'
import ModuleQuizView from '../views/ModuleQuizView.vue'
import ResourcesView from '../views/ResourcesView.vue'
import VideoTrainingListView from '../views/VideoTrainingListView.vue'
import VideoWatchView from '../views/VideoWatchView.vue'
import PharmacistCoursesListView from '../views/PharmacistCoursesListView.vue'
import ReadingView from '../views/ReadingView.vue'
import ContentReadingView from '../views/ContentReadingView.vue'
import QuizView from '../views/QuizView.vue'
import ResultView from '../views/ResultView.vue'
import OutletManagerDashboard from '../views/OutletManagerDashboard.vue'
import OutletManagerStaffView from '../views/OutletManagerStaffView.vue'
import OutletManagerResultsView from '../views/OutletManagerResultsView.vue'
import OutletManagerStaffReviewView from '../views/OutletManagerStaffReviewView.vue'
import WarehouseManagerDashboard from '../views/WarehouseManagerDashboard.vue'
import WarehouseManagerStaffView from '../views/WarehouseManagerStaffView.vue'
import WarehouseManagerResultsView from '../views/WarehouseManagerResultsView.vue'
import AreaManagerDashboard from '../views/AreaManagerDashboard.vue'
import AreaManagerReviewsView from '../views/AreaManagerReviewsView.vue'
import SupervisorDashboard from '../views/SupervisorDashboard.vue'
import SupervisorStaffComparisonView from '../views/SupervisorStaffComparisonView.vue'
import SupervisorReportsView from '../views/SupervisorReportsView.vue'
import SupervisorAddResourcesView from '../views/SupervisorAddResourcesView.vue'
import SupervisorManagerAccessView from '../views/SupervisorManagerAccessView.vue'
import SupervisorPharmacistTagView from '../views/SupervisorPharmacistTagView.vue'
import SupervisorManageQuizQuestionsView from '../views/SupervisorManageQuizQuestionsView.vue'
import SupervisorManageContentQuizQuestionsView from '../views/SupervisorManageContentQuizQuestionsView.vue'

const router = createRouter({
  history: createWebHistory(),
  // Without this, switching bottom-nav/sidebar tabs keeps the previous
  // page's scroll offset — the whole window is the scroll container (no
  // overflow-y-auto wrapper around <router-view> in App.vue), so a new
  // page can mount already scrolled deep down, then jump as its real
  // height resolves. Reset to top on fresh navigation, restore on
  // browser back/forward.
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  },
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    // manager-login covers both outlet_manager and warehouse_manager — a
    // Retail/Warehouse division toggle inside the page picks the role, same
    // pattern as staff login (see ManagerLoginView.vue).
    { path: '/manager-login', name: 'manager-login', component: ManagerLoginView, meta: { managerRoles: ['outlet_manager', 'warehouse_manager'] } },
    { path: '/area-manager-login', name: 'area-manager-login', component: AreaManagerLoginView, meta: { managerRoles: ['area_manager'] } },
    { path: '/manager-register', name: 'manager-register', component: ManagerRegisterView },
    { path: '/area-manager-register', name: 'area-manager-register', component: AreaManagerRegisterView },
    { path: '/supervisor-login', name: 'supervisor-login', component: SupervisorLoginView, meta: { managerRoles: ['supervisor'] } },
    { path: '/', name: 'dashboard', component: DashboardView, meta: { requiresAuth: true, role: 'staff' } },
    { path: '/history', name: 'history', component: QuizHistoryView, meta: { requiresAuth: true, role: 'staff' } },
    // Standard Quiz is retail-only, matches GAS (warehouse never had it,
    // only AI Practice) — division meta enforced below, not just hidden
    // from the sidebar. The backend's /data/results already 403s a
    // warehouse staff's save either way, but they shouldn't reach the quiz
    // screen at all just to hit that wall.
    { path: '/module-quiz', name: 'module-quiz', component: ModuleQuizView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
    { path: '/resources', name: 'resources', component: ResourcesView, meta: { requiresAuth: true, role: 'staff' } },
    // Same retail-only gating as Module Quiz — warehouse staff don't get
    // this today either.
    { path: '/video-training', name: 'video-training', component: VideoTrainingListView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
    { path: '/video-watch/:id', name: 'video-watch', component: VideoWatchView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
    { path: '/pharmacist-courses', name: 'pharmacist-courses', component: PharmacistCoursesListView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
    { path: '/reading-view/:id', name: 'reading-view', component: ReadingView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
    { path: '/content-reading/:id', name: 'content-reading', component: ContentReadingView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
    { path: '/quiz', name: 'quiz', component: QuizView, meta: { requiresAuth: true, role: 'staff' } },
    { path: '/result', name: 'result', component: ResultView, meta: { requiresAuth: true, role: 'staff' } },
    { path: '/manager', name: 'manager', component: OutletManagerDashboard, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
    { path: '/manager/staff', name: 'manager-staff', component: OutletManagerStaffView, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
    { path: '/manager/results', name: 'manager-results', component: OutletManagerResultsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
    { path: '/manager/staff-review', name: 'manager-staff-review', component: OutletManagerStaffReviewView, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
    { path: '/manager/resources', name: 'manager-resources', component: ResourcesView, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
    { path: '/warehouse-manager', name: 'warehouse-manager', component: WarehouseManagerDashboard, meta: { requiresAuth: true, role: 'manager', managerRole: 'warehouse_manager' } },
    { path: '/warehouse-manager/staff', name: 'warehouse-manager-staff', component: WarehouseManagerStaffView, meta: { requiresAuth: true, role: 'manager', managerRole: 'warehouse_manager' } },
    { path: '/warehouse-manager/results', name: 'warehouse-manager-results', component: WarehouseManagerResultsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'warehouse_manager' } },
    { path: '/warehouse-manager/resources', name: 'warehouse-manager-resources', component: ResourcesView, meta: { requiresAuth: true, role: 'manager', managerRole: 'warehouse_manager' } },
    { path: '/area-manager', name: 'area-manager', component: AreaManagerDashboard, meta: { requiresAuth: true, role: 'manager', managerRole: 'area_manager' } },
    { path: '/area-manager/reviews', name: 'area-manager-reviews', component: AreaManagerReviewsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'area_manager' } },
    { path: '/area-manager/resources', name: 'area-manager-resources', component: ResourcesView, meta: { requiresAuth: true, role: 'manager', managerRole: 'area_manager' } },
    { path: '/supervisor', name: 'supervisor', component: SupervisorDashboard, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/staff-comparison', name: 'supervisor-staff-comparison', component: SupervisorStaffComparisonView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/reports', name: 'supervisor-reports', component: SupervisorReportsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/resources', name: 'supervisor-resources', component: ResourcesView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/add-resources', name: 'supervisor-add-resources', component: SupervisorAddResourcesView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/manager-access', name: 'supervisor-manager-access', component: SupervisorManagerAccessView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/pharmacist', name: 'supervisor-pharmacist', component: SupervisorPharmacistTagView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/manage-quiz-questions', name: 'supervisor-manage-quiz-questions', component: SupervisorManageQuizQuestionsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
    { path: '/supervisor/manage-content-quiz', name: 'supervisor-manage-content-quiz', component: SupervisorManageContentQuizQuestionsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
  ],
})

const managerHome = { outlet_manager: 'manager', warehouse_manager: 'warehouse-manager', area_manager: 'area-manager', supervisor: 'supervisor' }
const managerLogin = { outlet_manager: 'manager-login', warehouse_manager: 'manager-login', area_manager: 'area-manager-login', supervisor: 'supervisor-login' }

// Route guard: bounce to the right login screen if not authenticated for
// that role, and away from a login screen (or another role's pages) once
// logged in — staff and manager sessions are mutually exclusive (single
// active token, see store/auth.js), and a manager role only ever sees its
// own dashboard.
router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth) {
    if (to.meta.role === 'staff') {
      if (!auth.isStaff) return { name: auth.isManager ? managerHome[auth.manager.role] : 'login' }
      if (to.meta.division && auth.staff.division !== to.meta.division) return { name: 'dashboard' }
      return
    }
    if (to.meta.role === 'manager') {
      if (auth.isManager && auth.manager.role === to.meta.managerRole) return
      if (auth.isManager) return { name: managerHome[auth.manager.role] }
      return { name: auth.isStaff ? 'dashboard' : managerLogin[to.meta.managerRole] }
    }
  }

  if (to.name === 'login' && auth.isStaff) return { name: 'dashboard' }
  if (to.meta.managerRoles && auth.isManager && to.meta.managerRoles.includes(auth.manager.role)) {
    return { name: managerHome[auth.manager.role] }
  }
})

export default router

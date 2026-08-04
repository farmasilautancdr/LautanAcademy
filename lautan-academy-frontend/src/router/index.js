import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../store/auth'

import LoginView from '../views/LoginView.vue'
import ManagerLoginView from '../views/ManagerLoginView.vue'
import WarehouseManagerLoginView from '../views/WarehouseManagerLoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import QuizView from '../views/QuizView.vue'
import ResultView from '../views/ResultView.vue'
import OutletManagerDashboard from '../views/OutletManagerDashboard.vue'
import WarehouseManagerDashboard from '../views/WarehouseManagerDashboard.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/manager-login', name: 'manager-login', component: ManagerLoginView, meta: { managerRole: 'outlet_manager' } },
    { path: '/warehouse-manager-login', name: 'warehouse-manager-login', component: WarehouseManagerLoginView, meta: { managerRole: 'warehouse_manager' } },
    { path: '/', name: 'dashboard', component: DashboardView, meta: { requiresAuth: true, role: 'staff' } },
    { path: '/quiz', name: 'quiz', component: QuizView, meta: { requiresAuth: true, role: 'staff' } },
    { path: '/result', name: 'result', component: ResultView, meta: { requiresAuth: true, role: 'staff' } },
    { path: '/manager', name: 'manager', component: OutletManagerDashboard, meta: { requiresAuth: true, role: 'manager', managerRole: 'outlet_manager' } },
    { path: '/warehouse-manager', name: 'warehouse-manager', component: WarehouseManagerDashboard, meta: { requiresAuth: true, role: 'manager', managerRole: 'warehouse_manager' } },
  ],
})

const managerHome = { outlet_manager: 'manager', warehouse_manager: 'warehouse-manager' }
const managerLogin = { outlet_manager: 'manager-login', warehouse_manager: 'warehouse-manager-login' }

// Route guard: bounce to the right login screen if not authenticated for
// that role, and away from a login screen (or another role's pages) once
// logged in — staff and manager sessions are mutually exclusive (single
// active token, see store/auth.js), and a manager role only ever sees its
// own dashboard.
router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth) {
    if (to.meta.role === 'staff') {
      if (auth.isStaff) return
      return { name: auth.isManager ? managerHome[auth.manager.role] : 'login' }
    }
    if (to.meta.role === 'manager') {
      if (auth.isManager && auth.manager.role === to.meta.managerRole) return
      if (auth.isManager) return { name: managerHome[auth.manager.role] }
      return { name: auth.isStaff ? 'dashboard' : managerLogin[to.meta.managerRole] }
    }
  }

  if (to.name === 'login' && auth.isStaff) return { name: 'dashboard' }
  if (to.meta.managerRole && !to.meta.requiresAuth) {
    if (auth.isManager && auth.manager.role === to.meta.managerRole) return { name: managerHome[to.meta.managerRole] }
  }
})

export default router

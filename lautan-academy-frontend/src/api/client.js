// Thin wrapper around fetch — attaches the auth token automatically and
// centralizes the backend base URL, so it's one place to change when
// deploying (localhost during dev, real Railway/Render URL in production).
// No /api prefix — the real backend (lautan-academy-backend, port 3000)
// mounts routes at /auth, /quiz, /data directly.
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

function getToken() {
  return localStorage.getItem('lautan_token')
}

async function request(path, options = {}) {
  const token = getToken()
  // FormData bodies (file uploads) must NOT get a manual Content-Type — the
  // browser sets multipart/form-data with the correct boundary itself.
  const isFormData = options.body instanceof FormData
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))

  if (res.status === 503 && data.maintenance === true) {
    // Dynamic import, not a static top-of-file import: store/maintenance.js
    // imports `api` from this same file, so a static import here would be a
    // circular module reference — client.js could reach this line before
    // its own `export const api = {...}` (further down this file) has run,
    // leaving the store's `api` binding uninitialized. The dynamic import
    // only resolves once this function actually runs, by which point this
    // module has already finished loading, so the cycle never bites.
    const { useMaintenanceStore } = await import('../store/maintenance')
    const maintenance = useMaintenanceStore()
    maintenance.active = true
    maintenance.message = data.message || ''
    throw new Error(data.error || 'Maintenance')
  }

  // Master Subsystem H: a 401 while impersonating means the 30-minute
  // token expired (or Master force-revoked it via Active Sessions) —
  // restore the stashed real session and bounce home instead of leaving
  // the user stuck on a dead impersonated view. Same circular-import
  // reasoning as the maintenance branch above: store/auth.js imports `api`
  // from this file, so this import must be dynamic.
  if (res.status === 401) {
    const { useAuthStore } = await import('../store/auth')
    const auth = useAuthStore()
    if (auth.impersonating) {
      await auth.exitImpersonation()
      window.location.href = '/'
      throw new Error(data.error || 'Impersonation session expired.')
    }
  }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  // Real backend's staff login takes division+outlet+name+pin, not a single
  // global passcode — matches the actual GAS data model (staff identified by
  // outlet + name, not a company-wide unique code).
  login: (division, outlet, name, pin) =>
    request('/auth/staff-login', { method: 'POST', body: JSON.stringify({ division, outlet, name, pin }) }),
  getStaffNames: (division, outlet) =>
    request(`/auth/staff-roster?division=${encodeURIComponent(division)}&outlet=${encodeURIComponent(outlet)}`),
  // role: outlet_manager | warehouse_manager | area_manager | supervisor.
  // outlet is ignored server-side for supervisor (unscoped, 'ALL').
  managerLogin: (role, outlet, pin) =>
    request('/auth/manager-login', { method: 'POST', body: JSON.stringify({ role, outlet, pin }) }),
  managerRegister: (payload) => request('/auth/manager-register', { method: 'POST', body: JSON.stringify(payload) }),
  getScopedData: (windowMonths) =>
    request(`/data/scoped-data${windowMonths ? `?windowMonths=${windowMonths}` : ''}`),
  getPharmacistCompliance: () => request('/pharmacist-compliance'),
  createAiQuiz: (payload) => request('/quiz/create', { method: 'POST', body: JSON.stringify(payload) }),
  redeemAiQuiz: (outlet, passcode) =>
    request('/quiz/redeem', { method: 'POST', body: JSON.stringify({ outlet, passcode }) }),
  getActiveQuiz: (outlet) => request(`/quiz/${encodeURIComponent(outlet)}/active`),
  endQuiz: (outlet) => request(`/quiz/${encodeURIComponent(outlet)}/end`, { method: 'POST' }),
  saveResult: (payload) => request('/data/results', { method: 'POST', body: JSON.stringify(payload) }),
  saveAiResult: (payload) => request('/data/ai-results', { method: 'POST', body: JSON.stringify(payload) }),
  // Fire-and-forget variant of saveResult for page-unload time (Module Quiz
  // anti-fraud abandon lock, Task 5). Deliberately bypasses request() — we
  // can't await a response once the page is being torn down, and
  // navigator.sendBeacon() can't carry the Authorization header this API
  // requires, so this uses fetch's keepalive flag instead.
  saveResultKeepalive: (payload) => {
    const token = getToken()
    fetch(`${BASE_URL}/data/results`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
  },
  getContent: () => request('/content'),
  // Returns { status: 'created'|'updated'|'duplicate'|'auth_error'|'error' } —
  // duplicate/auth_error are normal 200 responses, not thrown errors, since
  // they're expected outcomes the caller needs to react to, not failures.
  saveReport: (payload) => request('/reports', { method: 'POST', body: JSON.stringify(payload) }),
  getStaffRosterFull: (division, outlet) =>
    request(`/staff-roster-manage/full?division=${encodeURIComponent(division)}&outlet=${encodeURIComponent(outlet)}`),
  addStaff: (payload) => request('/staff-roster-manage', { method: 'POST', body: JSON.stringify(payload) }),
  resetStaffPin: (payload) => request('/staff-roster-manage/reset-pin', { method: 'POST', body: JSON.stringify(payload) }),
  removeStaff: (payload) => request('/staff-roster-manage', { method: 'DELETE', body: JSON.stringify(payload) }),
  addContent: (payload) => request('/content', { method: 'POST', body: JSON.stringify(payload) }),
  deleteContent: (id) => request(`/content/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadContentFile: (file) => {
    const form = new FormData()
    form.append('file', file)
    return request('/content/upload', { method: 'POST', body: form })
  },
  getResources: () => request('/resources'),
  getQuestions: () => request('/questions'),
  getVideoTrainings: () => request('/video-trainings'),
  getVideoQuestions: (topic) => request(`/video-questions?topic=${encodeURIComponent(topic)}`),
  checkVideoAnswer: (id, chosen) => request(`/video-questions/${id}/check`, { method: 'POST', body: JSON.stringify({ chosen }) }),
  addVideoQuestion: (payload) => request('/video-questions', { method: 'POST', body: JSON.stringify(payload) }),
  updateVideoQuestion: (id, payload) => request(`/video-questions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVideoQuestion: (id) => request(`/video-questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveVideoResult: (payload) => request('/data/video-results', { method: 'POST', body: JSON.stringify(payload) }),
  addVideoTraining: (payload) => request('/video-trainings', { method: 'POST', body: JSON.stringify(payload) }),
  deleteVideoTraining: (id) => request(`/video-trainings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getContentQuestions: (topic) => request(`/content-questions?topic=${encodeURIComponent(topic)}`),
  checkContentAnswer: (id, chosen) => request(`/content-questions/${id}/check`, { method: 'POST', body: JSON.stringify({ chosen }) }),
  addContentQuestion: (payload) => request('/content-questions', { method: 'POST', body: JSON.stringify(payload) }),
  updateContentQuestion: (id, payload) => request(`/content-questions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteContentQuestion: (id) => request(`/content-questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveContentResult: (payload) => request('/data/content-results', { method: 'POST', body: JSON.stringify(payload) }),
  getAllStaffPharmacistTags: () => request('/staff-roster-manage/all'),
  setStaffPharmacistTag: (id, isPharmacist) =>
    request(`/staff-roster-manage/${id}/pharmacist`, { method: 'PATCH', body: JSON.stringify({ isPharmacist }) }),
  getPharmacistCourses: () => request('/video-trainings/pharmacist'),
  getOutlets: (division) => request(`/outlets${division ? `?division=${encodeURIComponent(division)}` : ''}`),
  getAreas: () => request('/areas'),
  masterGetOutlets: (masterToken) =>
    request('/master/outlets', { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterCreateArea: (payload, masterToken) =>
    request('/master/outlets/areas', { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterUpdateArea: (id, payload, masterToken) =>
    request(`/master/outlets/areas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterCreateOutlet: (payload, masterToken) =>
    request('/master/outlets', { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterUpdateOutlet: (code, payload, masterToken) =>
    request(`/master/outlets/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${masterToken}` } }),
  // Live per-question reveal — not authoritative, saveResult/saveAiResult
  // independently re-grade the whole attempt server-side regardless of what
  // this returns.
  checkStandardAnswer: (id, chosen) => request(`/questions/${id}/check`, { method: 'POST', body: JSON.stringify({ chosen }) }),
  checkAiAnswer: (outlet, passcode, index, chosen) =>
    request(`/quiz/${encodeURIComponent(outlet)}/check`, { method: 'POST', body: JSON.stringify({ passcode, index, chosen }) }),
  rotateMasterPin: (payload) => request('/auth/rotate-master-pin', { method: 'POST', body: JSON.stringify(payload) }),
  masterLogin: (username, password) =>
    request('/auth/master-login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  masterResetSupervisorPin: (newPin, masterToken) =>
    request('/auth/master-reset-supervisor-pin', {
      method: 'POST',
      body: JSON.stringify({ newPin }),
      headers: { Authorization: `Bearer ${masterToken}` },
    }),
  masterSearchStaffForPurge: (params, masterToken) =>
    request(`/master/purge/staff/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteStaff: (ids, masterToken) =>
    request('/master/purge/staff/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchQuizAttempts: (params, masterToken) =>
    request(`/master/purge/quiz-attempts/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteQuizAttempts: (type, ids, masterToken) =>
    request('/master/purge/quiz-attempts/delete', { method: 'POST', body: JSON.stringify({ type, ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchManagerAccounts: (params, masterToken) =>
    request(`/master/purge/manager-accounts/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteManagerAccounts: (ids, masterToken) =>
    request('/master/purge/manager-accounts/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchReports: (params, masterToken) =>
    request(`/master/purge/reports/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteReports: (ids, masterToken) =>
    request('/master/purge/reports/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchContent: (params, masterToken) =>
    request(`/master/purge/content/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterDeleteContent: (ids, masterToken) =>
    request('/master/purge/content/delete', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  searchAuditLog: (params, masterToken) =>
    request(`/master/audit-log/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  getMaintenanceStatus: () => request('/maintenance-status'),
  setMaintenanceStatus: (enabled, message, masterToken) =>
    request('/master/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled, message }),
      headers: { Authorization: `Bearer ${masterToken}` },
    }),
  // Not routed through request() — that helper always calls res.json(), but
  // this response body is raw SQL text, not JSON.
  masterBackupExport: async (masterToken) => {
    const res = await fetch(`${BASE_URL}/master/backup-export`, {
      headers: { Authorization: `Bearer ${masterToken}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Request failed (${res.status})`)
    }
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="?([^"]+)"?/)
    const filename = match ? match[1] : `lautan-academy-backup-${Date.now()}.sql`
    return { blob, filename }
  },
  masterAnnualResetPreview: (masterToken) =>
    request('/master/annual-reset/preview', { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterAnnualReset: (masterToken) =>
    request('/master/annual-reset', { method: 'POST', headers: { Authorization: `Bearer ${masterToken}` } }),
  masterSearchSessions: (params, masterToken) =>
    request(`/master/sessions/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterRevokeSessions: (ids, masterToken) =>
    request('/master/sessions/revoke', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterImpersonateStart: (scopeType, scopeKey, masterToken) =>
    request('/master/impersonate/start', { method: 'POST', body: JSON.stringify({ scopeType, scopeKey }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterImpersonateEnd: (sessionId, masterToken) =>
    request('/master/impersonate/end', { method: 'POST', body: JSON.stringify({ sessionId }), headers: { Authorization: `Bearer ${masterToken}` } }),
}

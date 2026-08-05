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

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
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
  createAiQuiz: (payload) => request('/quiz/create', { method: 'POST', body: JSON.stringify(payload) }),
  redeemAiQuiz: (outlet, passcode) =>
    request('/quiz/redeem', { method: 'POST', body: JSON.stringify({ outlet, passcode }) }),
  getActiveQuiz: (outlet) => request(`/quiz/${encodeURIComponent(outlet)}/active`),
  endQuiz: (outlet) => request(`/quiz/${encodeURIComponent(outlet)}/end`, { method: 'POST' }),
  saveResult: (payload) => request('/data/results', { method: 'POST', body: JSON.stringify(payload) }),
  saveAiResult: (payload) => request('/data/ai-results', { method: 'POST', body: JSON.stringify(payload) }),
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
  // Live per-question reveal — not authoritative, saveResult/saveAiResult
  // independently re-grade the whole attempt server-side regardless of what
  // this returns.
  checkStandardAnswer: (id, chosen) => request(`/questions/${id}/check`, { method: 'POST', body: JSON.stringify({ chosen }) }),
  checkAiAnswer: (outlet, passcode, index, chosen) =>
    request(`/quiz/${encodeURIComponent(outlet)}/check`, { method: 'POST', body: JSON.stringify({ passcode, index, chosen }) }),
  rotateMasterPin: (payload) => request('/auth/rotate-master-pin', { method: 'POST', body: JSON.stringify(payload) }),
}

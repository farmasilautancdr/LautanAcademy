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
  const headers = {
    'Content-Type': 'application/json',
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
}

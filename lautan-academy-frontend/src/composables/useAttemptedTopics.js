// A staff member's "have I already attempted this" signal lives in two
// separate tables — AI Practice's aiResults and everything else's results
// (Module Quiz/Video Training/eLearning) — both keyed by the same
// free-text Topic field the rest of the app already matches by (see
// useCpdHours.js's topic-based splitting). Exposed once here since both
// DashboardView.vue and ResourcesView.vue need to answer the same
// question against the same two tables.
export function attemptedTopics(results, aiResults) {
  const set = new Set()
  for (const r of results) if (r.Topic) set.add(r.Topic)
  for (const r of aiResults) if (r.Topic) set.add(r.Topic)
  return set
}

function normalize(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

// Classic edit distance — minimum single-character insertions/deletions/
// substitutions to turn a into b.
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    [prev, curr] = [curr, prev]
  }
  return prev[n]
}

// 0..1, 1 = identical, case/whitespace-insensitive. The real gap this
// closes: the Module Quiz question bank's own Topic ("Iwell & Calcinity")
// doesn't exactly match the Drive file it's about ("Biomerit Iwell &
// Calcinity") — same real-world topic, different free-text label, so an
// exact string match missed it. Containment is checked first (one name is
// fully a prefix/suffix/substring of the other — a brand prefix like
// "Biomerit " or a generic suffix like " - Training Module" are both this
// shape) since Levenshtein's ratio unfairly penalizes a long common
// substring plus a long unrelated remainder as barely similar.
export function similarity(a, b) {
  const x = normalize(a), y = normalize(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return 1
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

const SIMILARITY_THRESHOLD = 0.6

// True if `key` (a resource's Name or a Content entry's Topic) is at
// least 60% similar to any attempted Topic — not just an exact match.
export function isAttempted(key, attemptedSet) {
  if (!key) return false
  for (const topic of attemptedSet) {
    if (similarity(key, topic) >= SIMILARITY_THRESHOLD) return true
  }
  return false
}

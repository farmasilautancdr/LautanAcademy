// Pure calculation, no reactive state of its own — every call site already
// owns its own `results`/`aiResults`/`video_trainings` refs from the API
// calls it was already making. Reused identically by the Dashboard and all
// three manager-facing Staff Results pages instead of quadruplicating the
// same join+group logic. See
// docs/superpowers/specs/2026-08-12-cpd-hours-design.md and
// docs/superpowers/specs/2026-08-13-cpd-hours-revision-design.md.

// Flat rates for the two sources with no fixed per-entry hours value to
// attach to (Module Quiz's standard_questions bank has no hours field; AI
// Practice quizzes are generated on the fly per passcode, no catalog at
// all). Video Training's real per-video rate comes from hoursByTopic
// instead.
export const MODULE_QUIZ_HOURS = 1
export const AI_PRACTICE_HOURS = 0.25

// Global CPD target, hours/calendar-year. Was 120, lowered to 60 — single
// source of truth so a future change only touches this file. See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
export const CPD_TARGET_HOURS = 60

// video_trainings entries -> a topic -> hours lookup, the shape
// hoursByStaff() needs to tell a Video Training results row apart from a
// Module Quiz one (same results table, only topic membership here
// distinguishes them — Video Training's and Module Quiz's topic
// namespaces never collide by design).
export function videoHoursByTopic(videoTrainings) {
  const map = new Map()
  for (const v of videoTrainings) map.set(v.topic, v.hours)
  return map
}

// Splits a `results` array (Video Training + Module Quiz share one table)
// into the two sources by topic membership — the same check hoursByStaff()
// already does internally, exposed standalone so views can render them as
// separate sections instead of only summing them together. See
// docs/superpowers/specs/2026-08-13-results-filters-sections-design.md.
export function splitByVideoTopic(results, hoursByTopic) {
  const video = []
  const moduleQuiz = []
  for (const r of results) {
    (hoursByTopic.has(r.Topic) ? video : moduleQuiz).push(r)
  }
  return { video, moduleQuiz }
}

// results rows (Video Training + Module Quiz, shared table) + aiResults
// rows (AI Practice, separate table) -> per-staff hours-this-year, both
// filtered to Timestamp falling in `year` (defaults to the current
// calendar year). A results row counts at its video's real hours if its
// Topic is a video-training topic (every attempt stacks); otherwise it's
// Module Quiz, flat rate but capped to the first attempt per topic per
// year (see MODULE_QUIZ_HOURS/data.js's cpdHoursThisYear() — same rule,
// kept in sync here since this is the client-side copy of that
// calculation). Every aiResults row counts at the flat AI Practice rate,
// no topic check needed (ai_results is exclusively AI Practice). Sorted
// ascending by hours — staff furthest behind the CPD_TARGET_HOURS target
// surface first, the actual point of a manager-facing view.
export function hoursByStaff(results, aiResults, hoursByTopic, year = new Date().getFullYear()) {
  const byStaff = new Map()
  const countedModuleTopics = new Set()
  function add(name, outlet, hours) {
    const key = `${name}|${outlet}`
    if (!byStaff.has(key)) byStaff.set(key, { name, outlet, hours: 0 })
    byStaff.get(key).hours += hours
  }
  for (const r of results) {
    if (new Date(r.Timestamp).getFullYear() !== year) continue
    if (hoursByTopic.has(r.Topic)) {
      add(r.Name, r.Outlet, hoursByTopic.get(r.Topic))
      continue
    }
    const topicKey = `${r.Name}|${r.Outlet}|${r.Topic}`
    if (countedModuleTopics.has(topicKey)) continue
    countedModuleTopics.add(topicKey)
    add(r.Name, r.Outlet, MODULE_QUIZ_HOURS)
  }
  for (const r of aiResults) {
    if (new Date(r.Timestamp).getFullYear() !== year) continue
    add(r.Name, r.Outlet, AI_PRACTICE_HOURS)
  }
  return [...byStaff.values()].sort((a, b) => a.hours - b.hours)
}

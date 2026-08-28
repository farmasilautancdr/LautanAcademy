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

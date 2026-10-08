# Supervisor Module Quiz CSV — Dedup, Outlet Tiers, AI Suggestions — Design

**Date:** 2026-10-08
**Status:** Approved, pending plan

## Purpose

Supervisor's "Module Quiz Results" CSV export (`SupervisorDashboard.vue`)
currently dumps every raw `results` row for the staff/outlet/topic/window
currently on screen, one row per attempt. Retakes count every attempt as
a separate data point, which skews any per-outlet average, and a
sub-30% score from a forced logout / system glitch looks identical to a
genuine fail. Supervisor wants the export to: dedupe retakes down to one
counted attempt per staff per topic per outlet, flag staff whose retakes
swung wildly, roll the deduped scores up into a per-outlet tier
(Top/Middle/Bottom), and append an AI-generated, topic-specific
improvement suggestion per outlet tied to that outlet's most commonly
missed question — written like a community-pharmacy training specialist,
not generic filler.

## Scope decisions (from brainstorming)

- **Module Quiz CSV only.** Reports CSV (`SupervisorReportsView.vue`) and
  the CPD record export (`QuizHistoryView.vue`) are untouched — their
  underlying tables either have a uniqueness constraint already
  (`reports`) or aren't attempt-based (CPD record).
- **Dedup grouping is (Staff Name, Outlet, Topic).** Retakes of the same
  topic by the same staff at the same outlet collapse to one counted
  entry. Different topics for the same staff stay separate rows.
- **Counted entry = earliest attempt scoring ≥30%.** A score below 30% is
  treated as a likely system error (forced logout mid-quiz, etc.), not a
  genuine attempt. If every attempt in a group is <30%, fall back to the
  earliest one anyway — a staff member is never silently dropped from the
  report for having bad luck every time.
- **"Large score gap" highlight threshold: ≥20 percentage points** between
  the group's min and max attempt. Flagged groups get a `Duplicate
  Attempts` count and a `Large Score Gap` note (`"45% -> 92%"`) appended
  as two extra columns on the existing row set — existing columns/order
  untouched.
- **Outlet tiers, computed off the deduped set, scoped by whatever
  region/outlet/topic filter is already active on screen** (same
  "exports what's on screen" rule this file's CSV already follows):
  - Top: average ≥95%
  - Middle: 85–94%
  - Bottom: ≤84%
- **AI-generated suggestions, not a hardcoded content library.** Module
  Quiz topics are free text the Supervisor manages (`standard_questions.
  topic`) — sometimes a broad category ("Supplements"), sometimes a
  specific product/brand name. A static per-topic library can't scale to
  that and risks shipping stale or wrong pharmacology if hand-authored
  once and never revisited. Suggestions are generated server-side via the
  existing Gemini integration (already used for AI Practice Quiz
  generation), tied explicitly to the outlet's own most-missed question
  — not a generic tier blurb reused across every outlet.
- **"Most Missed Question" is its own column**, independent of the AI
  suggestion feature — works for any topic. Computed from `wrong_answers`
  (same outlet/topic/window scope as the main export), grouped by exact
  question text, counting **distinct staff** who got it wrong (not raw
  wrong-answer rows, so one staff retrying the same question repeatedly
  doesn't inflate the count).
- **Suggestions only generated when a single Topic is selected.** "All
  Topics" means an outlet's rows span unrelated subjects — nothing
  coherent to tailor a suggestion to. In that case every outlet gets a
  clearly-labeled generic tier tip, no Gemini call, no cache writes.
- **Cache, not a new table.** Reuses `system_settings` (existing
  key-value table, currently only holds the maintenance kill-switch).
  Key: `suggestion:<topic>:<tier>:<8-char hash of the most-missed
  question text>`. Value: `{ text, generatedAt }`. A cache hit younger
  than 35 days is reused as-is; older or missing → regenerate. The hash
  in the key means a cache entry naturally invalidates itself the moment
  the outlet's most-missed question changes, with no manual "regenerate"
  button needed. Given Supervisor extracts roughly one topic a month,
  this also means a fresh suggestion is generated on essentially every
  real use without any extra UI.
- **English only.** Matches every other free-text field in these CSVs
  (Reports' `Recommendations`/`Performance Gaps` are Supervisor/Area
  Manager-typed English only, no bilingual requirement there either).

## Backend

### `gemini.js` — add `generateOutletSuggestion`

`callGemini(prompt)` currently hardcodes
`generationConfig.responseMimeType: 'application/json'` for the quiz-gen
use case. Refactored to `callGemini(prompt, generationConfig = {})`,
merging the override over sane JSON defaults — quiz generation passes
nothing and keeps its current behavior; the new function passes
`{ responseMimeType: 'text/plain', temperature: 0.4 }` (lower temperature
than quiz-gen's 0.6 — suggestions should read consistent, not creative).

```js
export async function generateOutletSuggestion(topic, tier, missedQuestion, correctAnswer) {
  const prompt = buildSuggestionPrompt(topic, tier, missedQuestion, correctAnswer)
  const text = await callGemini(prompt, { responseMimeType: 'text/plain', temperature: 0.4 })
  return text.trim()
}
```

`buildSuggestionPrompt` instructs: role (community pharmacy training
specialist in Malaysia), the topic, the tier (phrased as "this outlet's
staff are scoring in the Top/Middle/Bottom band on this topic"), the
most-missed question + its correct answer, and asks for 2–4 sentences,
concrete and specific — explicitly naming upsell/cross-sell guidance and
a counselling point tied to the missed question when the topic is
product/supplement-like, no generic filler, plain text only (no
markdown, no headers).

### New endpoint: `POST /supervisor-insights/outlet-suggestions`

New file `routes/supervisorInsights.js`, mounted at
`/supervisor-insights` in `app.js`. `requireAuth`,
`requireScope('supervisor')` — same pattern as `questions.js`,
`videoTraining.js`, etc.

Request:
```json
{
  "topic": "Supplements",
  "outlets": [
    { "code": "R1-001", "tier": "bottom", "missedQuestion": "...", "correctAnswer": "..." }
  ]
}
```

Logic:
1. For each outlet entry, compute `cacheKey = suggestion:${topic}:${tier}:${hash8(missedQuestion)}`.
2. Dedup identical cache keys within the batch (two outlets in the same
   tier with the same most-missed question share one Gemini call and one
   cache entry).
3. `select key, value from system_settings where key = ANY($1)` for all
   unique keys.
4. For each unique key: cache hit with `value.generatedAt` <35 days old →
   reuse `value.text`. Otherwise call `generateOutletSuggestion(...)`;
   on success, upsert into `system_settings`
   (`insert ... on conflict (key) do update`); on failure (Gemini down/
   rate-limited/malformed), skip the upsert and use the static generic
   tier fallback text for that key instead — the batch overall still
   returns `200`, never fails wholesale over one Gemini error.
5. Respond `{ suggestions: { [outletCode]: text } }`, mapping every
   requested outlet back to its (possibly shared) generated text.

No schema migration — `system_settings` already exists.

## Frontend (`SupervisorDashboard.vue`)

### Dedup + highlight

New computed `dedupedModuleQuiz`: groups `filteredModuleQuiz` by
`Name + '|' + Outlet + '|' + Topic`. Per group, sort by `Timestamp` asc;
counted = first entry with `parseInt(Percentage) >= 30`, else the
group's earliest entry regardless of score. Each counted entry carries
`_duplicateCount` (group length) and `_scoreGap` (`null`, or
`"min% -> max%"` when `max - min >= 20` and group length > 1).

### Outlet summary

New computed `outletSummaries`, derived from `dedupedModuleQuiz` (already
respecting the existing region/outlet/topic filters — same source the
raw CSV rows already come from): group by `Outlet` → `{ region, avgPercent, tier, entriesCounted }`.
Tier via the ≥95/85–94/≤84 thresholds above.

New computed `mostMissedByOutlet`, derived from `wrongAnswers` (newly
stored from `data.wrongAnswers` in `load()`, filtered the same way
`filteredModuleQuiz` is — region/outlet/topic/window), grouped by
`Outlet` then by `Question Text En`, counting `Set` of distinct
`Staff Name` per question, keeping the max per outlet.

### CSV build (`downloadCsv`)

1. Build the raw row block from `dedupedModuleQuiz` instead of
   `filteredModuleQuiz`, with the existing `CSV_COLUMNS` plus two new
   entries appended: `Duplicate Attempts` (`_duplicateCount`), `Large
   Score Gap` (`_scoreGap || ''`).
2. If `topicFilter.value !== 'ALL'`: call
   `api.getOutletSuggestions({ topic: topicFilter.value, outlets: outletSummaries mapped with each outlet's tier + mostMissedByOutlet question/answer })`,
   `await` it, merge the returned text onto each outlet summary row. On
   any error (network/5xx), fall back to the static generic tier tip
   locally and set a `suggestionsDegraded` flag.
   If `topicFilter.value === 'ALL'`: skip the call entirely, every outlet
   gets the static generic tier tip.
3. Append a blank line, then an `OUTLET SUMMARY` header row, then one row
   per outlet: `Outlet, Region, Average %, Tier, Entries Counted, Most
   Missed Question, Suggestion`.
4. If `suggestionsDegraded` was set, show the existing `status` line
   ("AI suggestions unavailable this time — showing generic tips.")
   instead of blocking the download.

### `api/client.js`

```js
getOutletSuggestions: (payload) =>
  request('/supervisor-insights/outlet-suggestions', { method: 'POST', body: JSON.stringify(payload) }),
```

## Static generic tier fallback text

Used whenever a suggestion can't be tailored (Gemini failure, or "All
Topics" selected) — honestly generic, not pretending to be tailored:

- **Top:** "Outlet is performing well on this topic — keep reinforcing
  correct answers in daily huddles so the standard holds through staff
  turnover."
- **Middle:** "Outlet is above the minimum bar but inconsistent — review
  the most-missed question above as a team and re-quiz in a few weeks."
- **Bottom:** "Outlet needs a structured refresher on this topic before
  the next quiz cycle — start with the most-missed question above."

## Edge cases

- A staff member's only attempt at a topic/outlet is <30% — still
  counted (fallback rule), so they're never invisible in the report.
- An outlet with zero deduped entries for the current filter (e.g. no
  one at that outlet took the selected topic) doesn't appear in the
  summary block at all — matches "exports what's on screen."
- Two outlets share the same tier and identical most-missed question
  text — one Gemini call, one cache row, both get the same suggestion
  text. Correct: the suggestion is about the topic+tier+weak-question
  combination, not the outlet's identity.
- Gemini returns empty/unparseable text for one key — treated the same
  as a request failure for that key only (static fallback for that
  outlet), doesn't affect other keys in the same batch.
- Supervisor picks a Topic with fewer than 2 distinct `wrong_answers`
  rows at an outlet (e.g. everyone got everything right) — "Most Missed
  Question" is blank for that outlet, suggestion prompt still gets built
  (falls back to "no notable wrong answers" wording) rather than
  erroring.

## Out of scope / explicitly not fixed here

- No manual "regenerate suggestion" button — the hash-based cache key
  already refreshes automatically when the underlying weak question
  changes; revisit only if Supervisor actually hits a stale-text case in
  practice.
- No bilingual (EN/MS) suggestion text.
- No changes to Reports CSV or CPD record CSV.
- No new table — reusing `system_settings` is accepted even though it's
  semantically a "settings" table, not a cache table; revisit if cache
  volume ever grows past the "~1 topic/month" usage this was sized for.

## Testing / verification plan

- Backend unit test (mocking `generateOutletSuggestion`): cache miss →
  Gemini called, row upserted; cache hit <35 days → Gemini not called;
  cache hit >35 days → Gemini called again; Gemini throws → static
  fallback returned, `200` still, no upsert.
- `curl`: `POST /supervisor-insights/outlet-suggestions` as a non-
  supervisor token → 403.
- `npm run build` clean (frontend).
- Live browser click-through: download CSV with a single topic selected
  → raw rows deduped (retake counts match manual check against a known
  staff member with retakes), gap column populated for a known >=20pp
  swing, summary block present with plausible tiers, suggestion text
  reads specific (not boilerplate) and references the listed most-missed
  question. Switch to "All Topics" → summary block still appears, every
  suggestion is the static generic tier text, no network call to
  `/supervisor-insights/*` (verified via browser devtools).

<script setup>
// "Module Quiz Review" (sidebar `sidebar.allOutlets`, route /supervisor) —
// company-wide, Module Quiz results only. Video Training/eLearning/AI
// Practice are deliberately excluded here (they live on Staff Comparison's
// leaderboards instead) — see moduleQuizResults below. No outlet scoping
// server-side, windowMonths controls how far back the backend queries
// (0 = all time). Add Resources (Content entries) now lives on its own
// route under the Browse Courses nav group — see SupervisorAddResourcesView.vue.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
// ExcelJS adds ~270KB gzipped — loaded via a lazy dynamic import() inside
// downloadReport() below, not statically here, so every role/page that
// isn't this report doesn't pay that weight (this app bundles as a single
// chunk, no route-based code splitting). ExcelJS's own browser bundle
// (dist/exceljs.min.js) is a UMD build with no real ESM export; the bare
// 'exceljs'/'exceljs/excel.js' entries are Node-only (they gate on
// process.versions.node, which doesn't exist in a browser) — this is the
// only import path that works at all. BUT: Vite's two bundlers interop
// with that UMD build differently and disagree on where the library ends
// up. `npm run dev` (esbuild) runs the UMD factory in a context where it
// self-attaches to `window.ExcelJS`; `npm run build` (Rollup) captures the
// module's CJS export directly as the import's `.default` and never
// touches `window` at all. Checking both, in this order, is required —
// confirmed by testing each bundler's actual output in a real browser,
// not assumed. See vite.config.js's optimizeDeps.exclude, required so
// esbuild's dep pre-bundler doesn't try (and fail) to re-parse the
// already-minified file.
async function loadExcelJS() {
  const mod = await import('exceljs/dist/exceljs.min.js')
  return mod.default || window.ExcelJS
}
import { api } from '../api/client'
import { useOutlets } from '../composables/useOutlets'
import { usePagination } from '../composables/usePagination'
import { videoHoursByTopic, contentHoursByTopic, splitByVideoTopic, splitByContentTopic } from '../composables/useCpdHours'
import Pagination from '../components/Pagination.vue'
import StatCard from '../components/StatCard.vue'

const ICON_USERS = 'M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
const ICON_GRID = 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'
const ICON_CHART = 'M4 20V10M4 20h16M10 20V4M16 20v-7'

const { t } = useI18n()
const { areas: AREAS, outletsForArea } = useOutlets()
const windowMonths = ref(3) // matches GAS's default — fast first load
const loading = ref(true)
const results = ref([])
const wrongAnswers = ref([])
const downloading = ref(false)
const status = ref('')
const statusOk = ref(false)
const regionFilter = ref('ALL')
const outletFilter = ref('ALL')
const topicFilter = ref('ALL')
const videoTrainings = ref([])
const contentEntries = ref([])

// Picking a region narrows the outlet dropdown to that region's roster
// (whether or not those outlets have data in the current window) rather
// than only outlets already present in loaded data — matches the picker
// pattern AreaManagerReviewsView.vue already uses.
function onRegionChange() { outletFilter.value = 'ALL'; topicFilter.value = 'ALL' }
function onOutletChange() { topicFilter.value = 'ALL' }

async function load() {
  loading.value = true
  try {
    const data = await api.getScopedData(windowMonths.value)
    results.value = data.results || []
    wrongAnswers.value = data.wrongAnswers || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}

watch(windowMonths, load)
load()

// Video Training + Module Quiz share the same `results` table, and Module
// Quiz further shares its topic namespace with Content/eLearning quizzes —
// fetched here so this whole page (stats, activity log, CSV export) can be
// narrowed to true Module Quiz only, excluding Video Training, eLearning,
// and AI Practice entirely (those stay on Staff Comparison).
// videoTrainingsLoaded gates rendering alongside `loading` (same pattern
// as SupervisorStaffComparisonView.vue) — without it, moduleQuizResults
// briefly classifies every row as Module Quiz before videoTrainings
// arrives, flashing Video Training/Content rows into the log and CSV.
const videoTrainingsLoaded = ref(false)
onMounted(async () => {
  try {
    const [videos, content] = await Promise.all([api.getVideoTrainings(), api.getContent()])
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty */ }
  videoTrainingsLoaded.value = true
})

// results.value mixes Video Training + Module Quiz + Content/eLearning in
// one table; splitByVideoTopic + splitByContentTopic peel off Video
// Training then Content, leaving true Module Quiz.
const moduleQuizResults = computed(() => {
  const video = splitByVideoTopic(results.value, videoHoursByTopic(videoTrainings.value))
  const nonVideo = splitByContentTopic(video.moduleQuiz, contentHoursByTopic(contentEntries.value))
  return nonVideo.moduleQuiz
})

// Region narrows first (canonical roster, not just outlets with data),
// outlet narrows further within that — same two-step scoping as the
// region-then-outlet flows elsewhere (e.g. AreaManagerReviewsView.vue).
const outlets = computed(() => {
  if (regionFilter.value !== 'ALL') return outletsForArea(regionFilter.value)
  return [...new Set(moduleQuizResults.value.map(r => r.Outlet))].filter(Boolean).sort()
})

const scopedModuleQuiz = computed(() => {
  let list = moduleQuizResults.value
  if (regionFilter.value !== 'ALL') {
    const regionOutlets = new Set(outletsForArea(regionFilter.value))
    list = list.filter(r => regionOutlets.has(r.Outlet))
  }
  if (outletFilter.value !== 'ALL') list = list.filter(r => r.Outlet === outletFilter.value)
  return list
})
// Newest addition first: last time each topic appeared in the results, descending.
const moduleQuizTopics = computed(() => {
  const latestByTopic = new Map()
  scopedModuleQuiz.value.forEach(r => {
    if (!r.Topic) return
    const ts = new Date(r.Timestamp).getTime()
    if (!latestByTopic.has(r.Topic) || ts > latestByTopic.get(r.Topic)) latestByTopic.set(r.Topic, ts)
  })
  return [...latestByTopic.keys()].sort((a, b) => latestByTopic.get(b) - latestByTopic.get(a))
})
// Topic-filtered — this is the single source for the stat tiles, the
// visible activity log, and the CSV export below, so what's on screen
// always matches what gets downloaded.
const filteredModuleQuiz = computed(() => {
  if (topicFilter.value === 'ALL') return scopedModuleQuiz.value
  return scopedModuleQuiz.value.filter(r => r.Topic === topicFilter.value)
})

const activity = computed(() => [...filteredModuleQuiz.value].sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)))
const staffCount = computed(() => new Set(filteredModuleQuiz.value.map(r => r.Name)).size)
const avgPercent = computed(() => {
  const all = filteredModuleQuiz.value
  if (!all.length) return 0
  return Math.round(all.reduce((sum, r) => sum + (parseInt(r.Percentage) || 0), 0) / all.length)
})
const { currentPage, totalPages, paginatedItems: paginatedActivity, next, prev } = usePagination(activity)

// Reverse of outletsForArea: outlet code -> region id, so the CSV can carry
// Region without a per-row lookup call.
const outletRegion = computed(() => {
  const map = {}
  AREAS.value.forEach(a => (a.outlets || []).forEach(o => { map[o] = a.id }))
  return map
})

// Retakes of the same topic by the same staff at the same outlet collapse
// to one counted entry — a sub-30% attempt is treated as a likely system
// error (forced logout mid-quiz) and skipped in favor of the next valid
// attempt, unless every attempt in the group is sub-30%, in which case the
// earliest one counts anyway so nobody silently vanishes from the report.
// _scoreGap flags a >=20-point swing across the group's attempts, surfaced
// as an extra CSV column rather than silently resolved one way or another.
const dedupedModuleQuiz = computed(() => {
  const groups = new Map()
  for (const r of filteredModuleQuiz.value) {
    const key = `${r.Name}|${r.Outlet}|${r.Topic}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const result = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp))
    const valid = sorted.find(r => (parseInt(r.Percentage) || 0) >= 30)
    const counted = valid || sorted[0]
    const percentages = sorted.map(r => parseInt(r.Percentage) || 0)
    const gap = Math.max(...percentages) - Math.min(...percentages)
    result.push({
      ...counted,
      _duplicateCount: sorted.length,
      _scoreGap: sorted.length > 1 && gap >= 20 ? `${Math.min(...percentages)}% -> ${Math.max(...percentages)}%` : '',
    })
  }
  return result
})

// Outlet Result sheet's row order — region first (Master's own area
// order, not lexicographic), outlet code second, so a Supervisor scans
// one region's outlets together instead of a flat staff-name-ordered list.
const sortedOutletResult = computed(() => {
  const regionRank = new Map(AREAS.value.map((a, i) => [a.id, i]))
  return [...dedupedModuleQuiz.value].sort((a, b) => {
    const ra = regionRank.get(outletRegion.value[a.Outlet]) ?? Infinity
    const rb = regionRank.get(outletRegion.value[b.Outlet]) ?? Infinity
    if (ra !== rb) return ra - rb
    return a.Outlet.localeCompare(b.Outlet)
  })
})

// wrong_answers isn't split by Video Training/Content/Module Quiz the way
// `results` is (see moduleQuizResults above) — restrict to Module Quiz's
// own topic universe first, then apply the same region/outlet/topic
// filters already governing the raw CSV rows, so "most missed question"
// never pulls in a Video Training or Content quiz question.
const scopedWrongAnswers = computed(() => {
  const moduleTopics = new Set(moduleQuizTopics.value)
  let list = wrongAnswers.value.filter(w => moduleTopics.has(w.Topic))
  if (regionFilter.value !== 'ALL') {
    const regionOutlets = new Set(outletsForArea(regionFilter.value))
    list = list.filter(w => regionOutlets.has(w.Outlet))
  }
  if (outletFilter.value !== 'ALL') list = list.filter(w => w.Outlet === outletFilter.value)
  if (topicFilter.value !== 'ALL') list = list.filter(w => w.Topic === topicFilter.value)
  return list
})

// Counts distinct staff who got each question wrong (not raw wrong-answer
// rows), so one staff retrying the same question repeatedly doesn't
// inflate it — then keeps the single most-missed question per outlet.
const mostMissedByOutlet = computed(() => {
  const byOutlet = new Map()
  for (const w of scopedWrongAnswers.value) {
    const question = w['Question Text En']
    if (!question) continue
    if (!byOutlet.has(w.Outlet)) byOutlet.set(w.Outlet, new Map())
    const questionMap = byOutlet.get(w.Outlet)
    if (!questionMap.has(question)) questionMap.set(question, { staff: new Set(), correctAnswer: w['Correct Answer En'] || '' })
    questionMap.get(question).staff.add(w['Staff Name'])
  }
  const result = {}
  for (const [outlet, questionMap] of byOutlet) {
    let best = null
    for (const [question, info] of questionMap) {
      if (!best || info.staff.size > best.count) best = { question, count: info.staff.size, correctAnswer: info.correctAnswer }
    }
    if (best) result[outlet] = best
  }
  return result
})

function tierFor(avgPercent) {
  if (avgPercent >= 95) return 'top'
  if (avgPercent >= 85) return 'middle'
  return 'bottom'
}

// Honest fallback, not a fake tailored suggestion — used when Gemini is
// unavailable for a given outlet, or when "All Topics" is selected (an
// outlet's rows span unrelated subjects, so nothing coherent to tailor to).
const STATIC_FALLBACK = {
  top: 'Outlet is performing well on this topic — keep reinforcing correct answers in daily huddles so the standard holds through staff turnover.',
  middle: 'Outlet is above the minimum bar but inconsistent — review the most-missed question above as a team and re-quiz in a few weeks.',
  bottom: 'Outlet needs a structured refresher on this topic before the next quiz cycle — start with the most-missed question above.',
}
const TIER_DISPLAY = { top: 'Top', middle: 'Middle', bottom: 'Bottom' }
const TIER_RANK = { top: 0, middle: 1, bottom: 2 }
// Excel's own built-in "Good/Neutral/Bad" conditional-formatting colors —
// recognizable to anyone who's used Excel's conditional formatting before,
// not an arbitrary palette.
const TIER_FILL = {
  top: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
  middle: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } },
  bottom: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
}
const TIER_FONT = {
  top: { color: { argb: 'FF006100' } },
  middle: { color: { argb: 'FF9C6500' } },
  bottom: { color: { argb: 'FF9C0006' } },
}
const REGION_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }

// Tier-breakdown block appended below the per-outlet table — layout
// modeled on a reference report (SUMMARY REPORT OMEGA & NUTRAN.xlsx)
// Supervisor provided: a bold section header per tier, an "Outlets:"
// line, a one-line "Summary:", then a bold "Recommendation:" with 3
// bullets. Both the Summary and the Recommendation bullets are now
// AI-generated per topic+tier (see downloadReport's tierRecommendations
// below) — RECOMMENDATION_BULLETS further down is the fallback only,
// used when "All Topics" is selected or the request fails.
const TIER_SECTION_TITLE = {
  top: 'Top Performing Outlets (Accuracy ≥95%)',
  middle: 'Middle Performing Outlets (Accuracy 85-94%)',
  bottom: 'Underperforming Outlets (Accuracy ≤84%)',
}
const TIER_ORDER = ['top', 'middle', 'bottom']
// Deterministic fallback for the tier "Summary:" line — used when the
// whole /outlet-suggestions request fails (network error) or "All
// Topics" is selected, same honest-fallback philosophy as STATIC_FALLBACK.
// Mirrors the backend's own tierSummaryFallback for consistency between
// "Gemini failed for this one tier" and "the request never went out."
function tierSummaryFallback(tier, outlets) {
  const sorted = [...outlets].sort((a, b) => b.avgPercent - a.avgPercent)
  if (!sorted.length) return ''
  if (tier === 'top') {
    const best = sorted[0]
    return `${sorted.length} outlet(s) scored in the Top tier, led by ${best.outlet} at ${best.avgPercent}%.`
  }
  if (tier === 'bottom') {
    const worst = sorted[sorted.length - 1]
    return `${sorted.length} outlet(s) scored in the Bottom tier, with ${worst.outlet} lowest at ${worst.avgPercent}%.`
  }
  return `${sorted.length} outlet(s) scored in the Middle tier, ranging from ${sorted[sorted.length - 1].avgPercent}% to ${sorted[0].avgPercent}%.`
}

const RECOMMENDATION_BULLETS = {
  top: [
    ['Incentives', 'Recognize and reward staff at these outlets to maintain high quiz performance and morale.'],
    ['Best Practice Sharing', 'Document how these outlets prepare for and review Module Quiz topics, and share it as a standard for other outlets.'],
    ['Mentorship', 'Pair high-scoring staff from these outlets with staff at underperforming outlets for peer coaching.'],
  ],
  middle: [
    ['Targeted Training', 'Review the specific questions these outlets got wrong to identify if gaps are knowledge-based or process-based.'],
    ['Internal Audits', 'Have outlet managers run a quick weekly quiz-topic review with staff to catch knowledge gaps early.'],
    ['Refresher Courses', 'Schedule a light refresher on this topic next quarter to close the gap to the top tier.'],
  ],
  bottom: [
    ['Immediate Intervention', 'Investigate the root cause with outlet management — staffing gaps, lack of reference material, or need for retraining.'],
    ['Intensive Retraining', 'Staff at these outlets should redo the Module Quiz training material before retaking the quiz.'],
    ['Monitoring', 'Increase check-ins with these outlets and re-quiz within a few weeks to confirm improvement.'],
  ],
}

const outletSummaries = computed(() => {
  const byOutlet = new Map()
  for (const r of dedupedModuleQuiz.value) {
    if (!byOutlet.has(r.Outlet)) byOutlet.set(r.Outlet, { sum: 0, count: 0 })
    const acc = byOutlet.get(r.Outlet)
    acc.sum += parseInt(r.Percentage) || 0
    acc.count += 1
  }
  return [...byOutlet.entries()].map(([outlet, { sum, count }]) => {
    const avgPercent = Math.round(sum / count)
    const missed = mostMissedByOutlet.value[outlet]
    return {
      outlet,
      region: outletRegion.value[outlet] || '',
      avgPercent,
      tier: tierFor(avgPercent),
      entriesCounted: count,
      missedQuestion: missed?.question || '',
      missedCount: missed?.count || 0,
      correctAnswer: missed?.correctAnswer || '',
    }
  })
})

// Score comes back as "correct/total" (e.g. "15/15") — kept as " of " for
// readability continuity with the old CSV export (this cell is written as
// an explicit string value, so unlike a CSV re-opened in Excel, there's no
// date-autodetection risk here either way).
const RAW_COLUMNS = [
  ['Timestamp', r => new Date(r.Timestamp).toISOString()],
  ['Region', r => outletRegion.value[r.Outlet] || ''],
  ['Outlet', r => r.Outlet],
  ['Staff Name', r => r.Name],
  ['Quiz Type', () => 'Module Quiz'],
  ['Topic', r => r.Topic],
  ['Score', r => (r.Score || '').replace('/', ' of ')],
  ['Percentage', r => r.Percentage],
  ['Duplicate Attempts', r => r._duplicateCount],
  ['Large Score Gap', r => r._scoreGap || ''],
]

async function downloadReport() {
  downloading.value = true
  status.value = ''
  try {
    let summaries = outletSummaries.value
    const tierGroups = TIER_ORDER
      .map(tier => ({ tier, outlets: summaries.filter(s => s.tier === tier) }))
      .filter(g => g.outlets.length)

    let suggestionByOutlet = {}
    let tierSummaryByTier = {}
    let tierRecommendationsByTier = {}
    if (topicFilter.value !== 'ALL' && (summaries.length || tierGroups.length)) {
      try {
        const { suggestions, tierSummaries, tierRecommendations } = await api.getOutletSuggestions({
          topic: topicFilter.value,
          outlets: summaries.map(s => ({ code: s.outlet, tier: s.tier, missedQuestion: s.missedQuestion, correctAnswer: s.correctAnswer })),
          tiers: tierGroups.map(g => ({ tier: g.tier, outlets: g.outlets.map(s => ({ code: s.outlet, avgPercent: s.avgPercent })) })),
        })
        suggestionByOutlet = suggestions || {}
        tierSummaryByTier = tierSummaries || {}
        tierRecommendationsByTier = tierRecommendations || {}
      } catch (e) {
        status.value = t('supervisorDashboard.suggestionsDegraded')
        statusOk.value = false
      }
    }

    const ExcelJS = await loadExcelJS()
    const workbook = new ExcelJS.Workbook()

    const rawSheet = workbook.addWorksheet('Outlet Result')
    rawSheet.addRow(RAW_COLUMNS.map(([label]) => label)).font = { bold: true }
    for (const r of sortedOutletResult.value) rawSheet.addRow(RAW_COLUMNS.map(([, get]) => get(r)))
    rawSheet.columns.forEach(col => { col.width = 18 })

    const summarySheet = workbook.addWorksheet('Outlet Summary')
    summarySheet.addRow(['Outlet', 'Average %', 'Tier', 'Entries Counted', 'Most Missed Question', 'Suggestion']).font = { bold: true }
    summarySheet.columns = [{ width: 12 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 45 }, { width: 70 }]

    const summaryByOutlet = new Map(summaries.map(s => [s.outlet, s]))
    const grouped = new Set()

    function writeOutletRow(s) {
      const suggestion = suggestionByOutlet[s.outlet] || STATIC_FALLBACK[s.tier]
      const missed = s.missedQuestion ? `${s.missedQuestion} (missed by ${s.missedCount} staff)` : ''
      const row = summarySheet.addRow([s.outlet, `${s.avgPercent}%`, TIER_DISPLAY[s.tier], s.entriesCounted, missed, suggestion])
      row.eachCell(cell => { cell.fill = TIER_FILL[s.tier]; cell.font = TIER_FONT[s.tier] })
      row.alignment = { wrapText: true, vertical: 'top' }
      grouped.add(s.outlet)
    }

    // Region order matches Master's own area list (R1, R2, ... R10, not
    // lexicographic) — within a region, outlets cluster Top -> Middle ->
    // Bottom, highest average first within a tier, so a Supervisor scans
    // one region at a glance instead of hunting across a flat list.
    for (const area of AREAS.value) {
      const areaOutlets = (area.outlets || [])
        .map(code => summaryByOutlet.get(code))
        .filter(Boolean)
        .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.avgPercent - a.avgPercent)
      if (!areaOutlets.length) continue

      const regionRow = summarySheet.addRow([`${area.id} - ${area.label}`])
      summarySheet.mergeCells(regionRow.number, 1, regionRow.number, 6)
      regionRow.font = { bold: true }
      regionRow.getCell(1).fill = REGION_HEADER_FILL
      areaOutlets.forEach(writeOutletRow)
    }

    // Safety net, not the expected path — every outlet summary comes from
    // outletRegion, which is itself built from AREAS, so this should never
    // fire. Guards against silently dropping a row if that ever drifts.
    const leftover = summaries.filter(s => !grouped.has(s.outlet))
    if (leftover.length) {
      const regionRow = summarySheet.addRow(['Unassigned'])
      summarySheet.mergeCells(regionRow.number, 1, regionRow.number, 6)
      regionRow.font = { bold: true }
      regionRow.getCell(1).fill = REGION_HEADER_FILL
      leftover.forEach(writeOutletRow)
    }

    // Tier breakdown — bold section title, "Outlets:" list, one-line
    // "Summary:", then "Recommendation:" with 3 bullets. Each text block
    // merged across all 6 columns and wrapped, matching the per-outlet
    // rows above rather than introducing a different layout mid-sheet.
    function writeMergedTextRow(text, { bold = false, fill = null } = {}) {
      const row = summarySheet.addRow([text])
      summarySheet.mergeCells(row.number, 1, row.number, 6)
      row.font = { bold }
      row.alignment = { wrapText: true, vertical: 'top' }
      if (fill) row.getCell(1).fill = fill
      return row
    }

    for (const { tier, outlets: tierOutlets } of tierGroups) {
      const sortedTierOutlets = [...tierOutlets].sort((a, b) => b.avgPercent - a.avgPercent)
      const outletList = tier === 'bottom'
        ? sortedTierOutlets.map(s => `${s.outlet} (${s.avgPercent}%)`).join(', ')
        : sortedTierOutlets.map(s => s.outlet).join(', ')
      const summaryText = tierSummaryByTier[tier] || tierSummaryFallback(tier, tierOutlets)
      const bullets = tierRecommendationsByTier[tier]?.length
        ? tierRecommendationsByTier[tier].map(r => [r.label, r.text])
        : RECOMMENDATION_BULLETS[tier]

      summarySheet.addRow([])
      writeMergedTextRow(`${TIER_SECTION_TITLE[tier]} — ${tierOutlets.length} outlet(s)`, { bold: true, fill: TIER_FILL[tier] })
      writeMergedTextRow(`Outlets: ${outletList}.`)
      writeMergedTextRow(`Summary: ${summaryText}`)
      summarySheet.addRow([])
      writeMergedTextRow('Recommendation:', { bold: true })
      for (const [label, text] of bullets) {
        writeMergedTextRow(`${label}: ${text}`)
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const topicLabel = (topicFilter.value === 'ALL' ? 'All Topics' : topicFilter.value).replace(/[\\/:*?"<>|]/g, '-')
    a.download = `${topicLabel} Result & Summary - ${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } finally {
    downloading.value = false
  }
}

</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorDashboard.title') }}</h1>
    </header>

    <main class="max-w-4xl mx-auto px-6 py-8">
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <select v-model.number="windowMonths" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option :value="3">{{ t('supervisorDashboard.last3Months') }}</option>
          <option :value="6">{{ t('supervisorDashboard.last6Months') }}</option>
          <option :value="12">{{ t('supervisorDashboard.last12Months') }}</option>
          <option :value="0">{{ t('supervisorDashboard.allTime') }}</option>
        </select>
        <select v-model="regionFilter" @change="onRegionChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorDashboard.allRegions') }}</option>
          <option v-for="a in AREAS" :key="a.id" :value="a.id">{{ a.id }} - {{ a.label }}</option>
        </select>
        <select v-model="outletFilter" @change="onOutletChange" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorDashboard.allOutlets') }}</option>
          <option v-for="o in outlets" :key="o" :value="o">{{ o }}</option>
        </select>
        <select v-model="topicFilter" class="border border-slate/30 rounded-lg py-2 px-3 text-sm bg-white">
          <option value="ALL">{{ t('supervisorDashboard.allTopics') }}</option>
          <option v-for="tp in moduleQuizTopics" :key="tp" :value="tp">{{ tp }}</option>
        </select>
        <button type="button" @click="downloadReport" :disabled="downloading || dedupedModuleQuiz.length === 0"
          class="ml-auto bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40">
          {{ downloading ? t('supervisorDashboard.generatingSuggestions') : t('supervisorDashboard.downloadReport') }}
        </button>
      </div>

      <p v-if="status" class="text-xs mb-4" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

      <div v-if="loading || !videoTrainingsLoaded" class="text-slate text-sm">{{ t('supervisorDashboard.loading') }}</div>

      <template v-else>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard :value="staffCount" :label="t('supervisorDashboard.staffActive')" accent="aqua" :icon="ICON_USERS" />
          <StatCard :value="outlets.length" :label="t('supervisorDashboard.outletsActive')" accent="seagrass" :icon="ICON_GRID" />
          <StatCard :value="`${avgPercent}%`" :label="t('supervisorDashboard.averageScore')" :accent="avgPercent >= 70 ? 'aqua' : 'coral'" :icon="ICON_CHART" />
        </div>

        <h2 class="font-display text-lg font-semibold text-ink mb-4">{{ t('supervisorDashboard.activityLog') }}</h2>
        <div v-if="activity.length === 0" class="text-slate text-sm">{{ t('supervisorDashboard.noActivity') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
          <div v-for="(r, i) in paginatedActivity" :key="i" class="flex items-center justify-between px-5 py-3">
            <div>
              <p class="text-sm font-medium text-ink">{{ r.Name }} · {{ r.Outlet }}</p>
              <p class="text-xs text-slate">{{ r.Topic }} · {{ new Date(r.Timestamp).toLocaleDateString() }}</p>
            </div>
            <span class="text-sm font-display font-semibold" :class="parseInt(r.Percentage) >= 70 ? 'text-aqua' : 'text-coral'">
              {{ r.Score }}
            </span>
          </div>
          <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
        </div>
      </template>
    </main>
  </div>
</template>

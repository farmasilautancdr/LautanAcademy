# Module Quiz Anti-Fraud (Abandon Lock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a staff member answers ≥1 question in a Module (Standard) Quiz, lock the attempt in as recorded — whether they finish normally, navigate away in-app, or close the tab/app — so abandoning can no longer be used to retry for a better score.

**Architecture:** Reuse the existing `POST /data/results` grading endpoint (already grades a missing `chosen` as wrong, already no-ops a same-day duplicate) — no backend changes. `QuizView.vue` gets three new exit paths that all funnel into the same grading call: the existing Submit button, a `vue-router` `onBeforeRouteLeave` guard (in-app navigation, with a confirm dialog), and a `pagehide` listener (real tab/app close, best-effort, no dialog). A `hasSubmitted` flag makes the three paths mutually exclusive. Everything is gated on `kind === 'standard'` — AI Practice is untouched.

**Tech Stack:** Vue 3 (`<script setup>`), Vue Router 4, vue-i18n. No new dependencies.

## Global Constraints

- Bilingual EN/MS: every new user-facing string needs both `en.json` and `ms.json` entries, same key, same nesting.
- No new frameworks/libraries without asking first (per `CLAUDE.md`) — this plan introduces none.
- No test framework in this frontend (no vitest/jest) — verification is `npm run build` (must stay clean) plus manual browser click-through, per this project's documented convention.
- Match existing file conventions over textbook best practice (e.g. this file already uses native `confirm()` for destructive actions elsewhere in the app — no new custom modal component).
- Terse code comments, English only, only where the *why* isn't obvious from the code itself.

---

## Design correction from the spec (read before starting Task 5)

The spec (`docs/superpowers/specs/2026-08-12-module-quiz-anti-fraud-design.md`) says the close-detection listener is "`pagehide`/`visibilitychange`". Task 5 below uses **`pagehide` only**, not `visibilitychange`. Reason: `visibilitychange` fires to `'hidden'` on *any* backgrounding — switching apps, taking a phone call, locking the screen — not just genuine abandonment. This is a mobile PWA used on the shop floor; staff get interrupted constantly and will background the app mid-quiz intending to come straight back. Wiring grading finalization to `visibilitychange` would silently lock in (and fail) their attempt the instant they get interrupted, which is a much worse outcome than the fraud this feature prevents. `pagehide` fires on actual navigation-away/tab-close/app-close, which matches the intended "real exit" case — at the cost of the already-agreed-to limitation (a hard force-kill while merely backgrounded, before `pagehide` fires, can still slip through unrecorded). This keeps the already-approved "best-effort is fine" trade-off without introducing a new, more harmful false-positive.

---

### Task 1: Split `submit()` into `gradeAndSave()` + `submitQuiz()`, add `hasSubmitted` guard

Pure refactor — the manual Submit button's behavior must be identical after this task. This is the foundation Tasks 4 and 5 build on: they need to grade-and-save *without* the button path's "go to the Result screen" side effect (they're not going to `/result`, they're going wherever the user actually navigated to, or closing).

**Files:**
- Modify: `lautan-academy-frontend/src/views/QuizView.vue:36` (add `hasSubmitted` ref near existing `answers`/`submitting` refs), `QuizView.vue:89-127` (replace `submit()`)
- Modify: `lautan-academy-frontend/src/views/QuizView.vue:185-192` (template: `@click="submit"` → `@click="submitQuiz"`)

**Interfaces:**
- Produces: `gradeAndSave(): Promise<{score, total, percentage} | null>` — grades+saves via `api.saveResult`/`api.saveAiResult`, sets `hasSubmitted.value = true` as its first action, returns `null` if already submitted (no-op), throws on network/API error. No sessionStorage or router side effects.
- Produces: `submitQuiz(): Promise<void>` — button-facing wrapper: calls `gradeAndSave()`, builds `wrongAnswers`, writes `lautan_last_result` to sessionStorage, clears `lautan_active_quiz`, navigates to `/result`. On error, resets `hasSubmitted.value = false` (so the button remains usable) and sets `errorMsg`, same as today's `submit()`.
- Produces: `hasSubmitted` ref (boolean), consumed by Tasks 4 and 5 to avoid double-firing.

- [ ] **Step 1: Add the `hasSubmitted` ref**

In `QuizView.vue`, next to the existing refs (after line 40 `const errorMsg = ref('')`):

```js
const hasSubmitted = ref(false)
```

- [ ] **Step 2: Replace `submit()` with `gradeAndSave()` + `submitQuiz()`**

Replace the entire existing `async function submit() { ... }` block (lines 89-127) with:

```js
async function gradeAndSave() {
  if (hasSubmitted.value) return null
  hasSubmitted.value = true

  const payloadAnswers = questions.value.map((q, i) => {
    const a = answers.value[i]
    return kind === 'standard' ? { id: q.id, chosen: a?.chosen } : { index: i, chosen: a?.chosen }
  })

  return kind === 'standard'
    ? api.saveResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
    : api.saveAiResult({ attemptId: 'AI' + Date.now(), name: auth.staff.name, outlet: auth.staff.outlet, topic, passcode, answers: payloadAnswers })
}

async function submitQuiz() {
  submitting.value = true
  errorMsg.value = ''

  try {
    const data = await gradeAndSave()
    if (!data) return

    // Missed-question summary for ResultView comes from the live per-answer
    // checks already done during the quiz, not recomputed here — the score
    // shown (data.score/data.total/data.percentage) is the server's, though.
    const wrongAnswers = []
    questions.value.forEach((q, i) => {
      const a = answers.value[i]
      if (a && a.chosen !== a.correctIndex) {
        const opts = optionsFor(q)
        wrongAnswers.push({
          qText: locale.value === 'en' ? q.question_en : q.question_ms,
          userChoice: opts[a.chosen] ?? '',
          correctText: opts[a.correctIndex] ?? '',
        })
      }
    })

    sessionStorage.setItem('lautan_last_result', JSON.stringify({ scoreCorrect: data.score, scoreTotal: data.total, percentage: data.percentage, wrongAnswers }))
    sessionStorage.removeItem('lautan_active_quiz')
    router.push('/result')
  } catch (err) {
    hasSubmitted.value = false
    errorMsg.value = err.message || t('quizView.errorSubmitFailed')
  } finally {
    submitting.value = false
  }
}
```

- [ ] **Step 3: Update the template's Submit button**

In the template (around line 185-192), change:

```html
<button
  v-else
  @click="submit"
```

to:

```html
<button
  v-else
  @click="submitQuiz"
```

- [ ] **Step 4: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: builds with no new errors/warnings beyond the two pre-existing dynamic-import notices (`store/auth.js`, `store/maintenance.js`).

- [ ] **Step 5: Manual regression check**

In the browser (dev server), log in as retail staff, start a Module Quiz, answer every question, click Submit. Confirm: it still lands on the Result screen with the correct score, and the attempt shows up in Quiz History same as before this change.

- [ ] **Step 6: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/QuizView.vue
git commit -m "Refactor QuizView submit into gradeAndSave + submitQuiz

Splits the grading/save call from the button's navigate-to-Result side
effect, so the upcoming auto-submit paths (nav-away, tab-close) can
grade+save without hijacking the user's actual navigation target."
```

---

### Task 2: Disable Back button once ≥1 question answered (Module Quiz only)

**Files:**
- Modify: `lautan-academy-frontend/src/views/QuizView.vue:169-176` (template)

**Interfaces:**
- Consumes: `kind` (string, already in scope), `answeredCount` (computed, already in scope), `currentIndex` (already in scope).

- [ ] **Step 1: Update the Back button's `:disabled` binding**

Change:

```html
<button
  @click="back"
  :disabled="currentIndex === 0"
  class="text-slate text-sm disabled:opacity-30"
>
```

to:

```html
<button
  @click="back"
  :disabled="currentIndex === 0 || (kind === 'standard' && answeredCount >= 1)"
  class="text-slate text-sm disabled:opacity-30"
>
```

- [ ] **Step 2: Manual verification**

Start a Module Quiz, answer question 1, confirm Back is now greyed out/disabled for the rest of the quiz. Separately, start an AI Practice quiz (join via a passcode from the dashboard), answer question 1, confirm Back still works normally there (unaffected).

- [ ] **Step 3: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/QuizView.vue
git commit -m "Disable Back button in Module Quiz once first question answered

Forward-only from the first answer onward, per the anti-fraud abandon-
lock design — AI Practice is untouched."
```

---

### Task 3: Add the confirm-leave i18n strings

**Files:**
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json:196` (inside `quizView`, after `submitQuiz`)
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json:196` (inside `quizView`, after `submitQuiz`)

**Interfaces:**
- Produces: i18n key `quizView.confirmLeaveAutoSubmit` (string, no interpolation params), consumed by Task 4.

- [ ] **Step 1: Add the English key**

In `en.json`, change:

```json
    "submitQuiz": "Submit quiz",
    "errorSubmitFailed": "Could not submit your answers. Check your connection and try again."
  },
```

to:

```json
    "submitQuiz": "Submit quiz",
    "errorSubmitFailed": "Could not submit your answers. Check your connection and try again.",
    "confirmLeaveAutoSubmit": "Leaving now will submit your quiz with the answers you've given so far — unanswered questions count as wrong. This can't be undone. Leave and submit?"
  },
```

- [ ] **Step 2: Add the Bahasa Malaysia key**

In `ms.json`, change:

```json
    "submitQuiz": "Hantar kuiz",
    "errorSubmitFailed": "Tidak dapat menghantar jawapan anda. Semak sambungan anda dan cuba lagi."
  },
```

to:

```json
    "submitQuiz": "Hantar kuiz",
    "errorSubmitFailed": "Tidak dapat menghantar jawapan anda. Semak sambungan anda dan cuba lagi.",
    "confirmLeaveAutoSubmit": "Keluar sekarang akan menghantar kuiz anda dengan jawapan yang telah diberikan setakat ini — soalan yang tidak dijawab akan dikira salah. Ini tidak boleh dibuat asal. Keluar dan hantar?"
  },
```

- [ ] **Step 3: Verify key parity**

Run: `cd lautan-academy-frontend && node -e "const en=require('./src/i18n/locales/en.json'); const ms=require('./src/i18n/locales/ms.json'); console.log('en:', Object.keys(en.quizView).length, 'ms:', Object.keys(ms.quizView).length)"`
Expected: both counts equal (10 each), confirming the key exists on both sides.

- [ ] **Step 4: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Add confirmLeaveAutoSubmit i18n key for quiz abandon-lock warning"
```

---

### Task 4: In-app navigation guard (`onBeforeRouteLeave`)

**Files:**
- Modify: `lautan-academy-frontend/src/views/QuizView.vue:19` (import), add guard after existing computed/function declarations (after `back()`, before `gradeAndSave`/`submitQuiz`, i.e. around line 88)

**Interfaces:**
- Consumes: `gradeAndSave()` and `hasSubmitted` from Task 1, `kind`/`answeredCount` (already in scope), `t()` from vue-i18n (already in scope), `quizView.confirmLeaveAutoSubmit` key from Task 3.

- [ ] **Step 1: Import `onBeforeRouteLeave`**

Change:

```js
import { useRouter } from 'vue-router'
```

to:

```js
import { useRouter, onBeforeRouteLeave } from 'vue-router'
```

- [ ] **Step 2: Add the route guard**

Add this after the existing `function back() { ... }` block and before `gradeAndSave`/`submitQuiz`:

```js
// Module Quiz only — once >=1 question is answered, leaving via in-app
// navigation (not the Submit button) still records the attempt, so
// abandoning can't be used to retry for a better score. AI Practice is
// explicitly excluded (kind !== 'standard' check).
onBeforeRouteLeave(async (to, from, next) => {
  if (kind !== 'standard' || answeredCount.value === 0 || hasSubmitted.value) {
    next()
    return
  }
  if (!window.confirm(t('quizView.confirmLeaveAutoSubmit'))) {
    next(false)
    return
  }
  try {
    await gradeAndSave()
  } catch (e) {
    // Best-effort — still let them leave rather than trapping them on a
    // quiz they've already confirmed they want to exit.
  }
  sessionStorage.removeItem('lautan_active_quiz')
  next()
})
```

- [ ] **Step 3: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean, same as Task 1.

- [ ] **Step 4: Manual verification — cancel path**

Start a Module Quiz, answer question 1, click a sidebar nav link (e.g. "Staff Results" or the logo/dashboard link). Confirm the browser's confirm dialog appears with the translated warning. Click Cancel. Confirm you're still on the quiz, at the same question, and can continue answering normally.

- [ ] **Step 5: Manual verification — confirm path**

Same setup, this time click OK on the dialog. Confirm you land on the page you actually clicked toward (not the Result screen). Then check that topic now shows up as an attempted result today (e.g. via `ModuleQuizView`'s topic picker showing "already attempted", or the Area Manager Assessment topic dropdown for that staff member) — this is the actual anti-fraud behavior working.

- [ ] **Step 6: Manual verification — zero answered, no interruption**

Start a Module Quiz, answer nothing, immediately click away. Confirm no dialog appears and navigation is instant (guard's `answeredCount.value === 0` short-circuit).

- [ ] **Step 7: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/QuizView.vue
git commit -m "Auto-submit Module Quiz on in-app nav-away after first answer

onBeforeRouteLeave warns via confirm() once >=1 question is answered,
then grades+saves the partial attempt (unanswered = wrong) before
letting navigation proceed — closes the abandon-and-retry loophole for
in-app navigation. AI Practice is unaffected."
```

---

### Task 5: Best-effort auto-submit on real tab/app close (`pagehide`)

See the "Design correction from the spec" section above before starting — this task uses `pagehide` only, not `visibilitychange`.

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js` (add `saveResultKeepalive`, near existing `saveResult`)
- Modify: `lautan-academy-frontend/src/views/QuizView.vue:18` (import `onMounted`, `onUnmounted`), add handler + lifecycle hooks

**Interfaces:**
- Consumes: `getToken()` and `BASE_URL` (both already private to `client.js`), `kind`/`answeredCount`/`hasSubmitted`/`questions`/`answers`/`auth`/`topic` (already in scope in `QuizView.vue`).
- Produces: `api.saveResultKeepalive(payload: {name, outlet, topic, answers})` — fire-and-forget, no return value, consumed only by this task.

- [ ] **Step 1: Add `saveResultKeepalive` to `api/client.js`**

Find `getStaffNames` / `saveResult` in the `api` object (`client.js`, inside the `export const api = { ... }` block) and add this new method next to `saveResult`:

```js
// Fire-and-forget variant of saveResult for page-unload time (Task 5 of
// the Module Quiz anti-fraud plan). Deliberately bypasses request() — we
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
```

- [ ] **Step 2: Import lifecycle hooks in `QuizView.vue`**

Change:

```js
import { ref, computed } from 'vue'
```

to:

```js
import { ref, computed, onMounted, onUnmounted } from 'vue'
```

- [ ] **Step 3: Add the `pagehide` handler and lifecycle wiring**

Add this after the `onBeforeRouteLeave` block from Task 4:

```js
// Best-effort only: pagehide fires on real navigation-away/tab-close/app-
// close, not on mere backgrounding (that's visibilitychange, deliberately
// NOT used here — see the plan's "Design correction" note: hooking
// grading to a simple tab-switch/backgrounding event would wrongly lock
// in an attempt every time staff get interrupted mid-quiz, which happens
// constantly on the shop floor). A hard force-kill before pagehide fires
// still won't be recorded — accepted limitation, no fully reliable
// client-side alternative exists.
function handlePageHide() {
  if (kind !== 'standard' || answeredCount.value === 0 || hasSubmitted.value) return
  hasSubmitted.value = true
  const payloadAnswers = questions.value.map((q, i) => ({ id: q.id, chosen: answers.value[i]?.chosen }))
  api.saveResultKeepalive({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
}

onMounted(() => {
  window.addEventListener('pagehide', handlePageHide)
})
onUnmounted(() => {
  window.removeEventListener('pagehide', handlePageHide)
})
```

- [ ] **Step 4: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean.

- [ ] **Step 5: Manual verification**

Start a Module Quiz, answer question 1, then close the browser tab entirely (not an in-app nav — an actual tab close, or mobile: swipe the app away). Reopen the app, log in again, and check that topic shows as already attempted today (same check as Task 4 Step 5). Note: this is inherently best-effort — if it occasionally doesn't fire in a given browser/OS combination, that's the accepted limitation, not a bug to chase.

- [ ] **Step 6: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/api/client.js lautan-academy-frontend/src/views/QuizView.vue
git commit -m "Best-effort auto-submit Module Quiz on real tab/app close

pagehide listener fires a keepalive fetch to grade+save whatever was
answered, closing the abandon loophole for actual tab/app close (not
just in-app navigation, already handled by the onBeforeRouteLeave
guard). Deliberately not wired to visibilitychange — see plan notes."
```

---

## Self-review notes (for the plan author, not a task)

- **Spec coverage:** Module-Quiz-only scoping (Tasks 2/4/5 all gate on `kind === 'standard'`) ✓. In-app nav confirm+submit (Task 4) ✓. Best-effort close handling (Task 5) ✓. Back button disabled once answered (Task 2) ✓. No backend/schema changes (none in this plan) ✓. Bilingual strings (Task 3) ✓. No new "abandoned" marker (both auto-submit paths call the same `POST /data/results` used by the manual path, writing an identical row shape) ✓.
- **Deviation from spec, called out explicitly:** Task 5 uses `pagehide` only, not `visibilitychange` — see the "Design correction" section. This is a refinement in service of the approved goal (avoid recording a false abandon), not a scope change.
- **Type/name consistency:** `gradeAndSave()` (Task 1) is the single grade+save primitive consumed identically by `submitQuiz()` (Task 1, button path), the `onBeforeRouteLeave` guard (Task 4), matching the exact function name and no-arg signature throughout. `hasSubmitted` (Task 1) is read by both Task 4 and Task 5's guards. Task 5 does not reuse `gradeAndSave()` (that path awaits a response, which isn't available at unload time) — it deliberately duplicates just the payload-building line via `api.saveResultKeepalive`, which is the fire-and-forget variant added in that same task.

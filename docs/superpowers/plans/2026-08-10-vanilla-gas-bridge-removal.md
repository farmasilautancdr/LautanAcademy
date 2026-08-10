# Close Vanilla's Last GAS Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vanilla (`index.html`) stops talking to GAS entirely — staff roster becomes per-outlet (matching the new backend's real shape) and Standard Quiz stops leaking/using the raw `correct` answer field, closing a live answer-key exposure.

**Architecture:** Backend: one endpoint (`GET /auth/staff-roster`) gets a richer response shape (adds `idNote`) to serve both vanilla and Vue's login pickers without a regression. Vanilla: `fetchData()`'s GAS call is replaced with `GET /questions`; staff-roster lookups move from a bulk pre-load to on-demand per-outlet fetches (two call sites); Standard Quiz's answer reveal moves from a local field read to a live per-question backend check, mirroring the AI Practice fix already shipped this session (commit `98fd393`). Vue: `LoginView.vue`'s dropdown adapts to the new response shape, gaining `idNote` display for the first time.

**Tech Stack:** No new dependencies. Plain `fetch` (vanilla, already the pattern everywhere else in the file) and `pg` (backend, existing).

## Global Constraints

- No new frameworks/libraries without asking first (CLAUDE.md hard rule) — this plan introduces none.
- Bilingual EN/MS: not applicable here — no new user-facing copy strings, and vanilla (`index.html`) is English-only by existing convention (unlike the Vue app), so no i18n work is needed for these changes.
- No automated test framework in either repo — verify with curl (backend), a syntax-checked extraction of vanilla's inline script (matches this session's established approach), `npm run build` (Vue), and a final manual browser pass.
- Spec: `docs/superpowers/specs/2026-08-10-vanilla-gas-bridge-removal-design.md` — every task below implements a specific section of it.
- Two separate git repos: backend tasks commit inside `lautan-academy-backend`; vanilla (`index.html`) and Vue (`lautan-academy-frontend/`) tasks commit inside `lautan-academy` (this repo).

---

## Part 1 — Backend (`lautan-academy-backend`)

### Task 1: Extend `GET /auth/staff-roster` to include `idNote`

**Files:**
- Modify: `src/routes/auth.js`

**Interfaces:**
- Produces: `GET /auth/staff-roster?division=X&outlet=Y` → `{ staff: [{ name, idNote }] }` (was `{ staff: [name, ...] }`). `idNote` is `null` when the roster row has none. Task 2 (Vue) and Task 4 (vanilla) both depend on this exact shape.

- [ ] **Step 1: Update the handler**

In `src/routes/auth.js`, find:
```js
authRouter.get('/staff-roster', async (req, res) => {
  const division = (req.query.division || '').toString().trim().toLowerCase();
  const outlet = (req.query.outlet || '').toString().trim().toUpperCase();
  if (!division || !outlet) return res.json({ staff: [] });

  const { rows } = await pool.query(
    'select name from staff_roster where division = $1 and outlet = $2 order by name',
    [division, outlet]
  );
  res.json({ staff: rows.map(r => r.name) });
});
```
Replace the query and response lines with:
```js
authRouter.get('/staff-roster', async (req, res) => {
  const division = (req.query.division || '').toString().trim().toLowerCase();
  const outlet = (req.query.outlet || '').toString().trim().toUpperCase();
  if (!division || !outlet) return res.json({ staff: [] });

  const { rows } = await pool.query(
    'select name, id_note from staff_roster where division = $1 and outlet = $2 order by name',
    [division, outlet]
  );
  res.json({ staff: rows.map(r => ({ name: r.name, idNote: r.id_note || null })) });
});
```

- [ ] **Step 2: Confirm the file still parses**

Run: `node --check src/routes/auth.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Start the backend locally and verify against a real outlet**

Run: `npm run dev` (leave running).
Run: `curl -s "http://localhost:3000/auth/staff-roster?division=retail&outlet=AJ"` (swap `AJ` for any real outlet code with staff seeded).
Expected: `{"staff":[{"name":"...","idNote":null},...]}` — an array of objects, not bare strings. If any row has a real `id_note` value in the DB, confirm it appears as `idNote` (not `null`) for that entry.

- [ ] **Step 4: Commit**

```bash
git add src/routes/auth.js
git commit -m "feat: include idNote in GET /auth/staff-roster response"
```

---

## Part 2 — Vue (`lautan-academy-frontend`, inside the `lautan-academy` repo)

### Task 2: `LoginView.vue` — consume the new staff-roster shape

**Files:**
- Modify: `lautan-academy-frontend/src/views/LoginView.vue`

**Interfaces:**
- Consumes: `GET /auth/staff-roster` new shape (Task 1) via the existing `api.getStaffNames(division, outlet)` — no change to that function's signature, only to what it resolves to.

- [ ] **Step 1: Update the dropdown template**

In `lautan-academy-frontend/src/views/LoginView.vue`, find:
```html
              <option v-for="n in staffNames" :key="n" :value="n">{{ n }}</option>
```
Replace with:
```html
              <option v-for="n in staffNames" :key="n.name" :value="n.name">{{ n.name }}{{ n.idNote ? ' (' + n.idNote + ')' : '' }}</option>
```

- [ ] **Step 2: Confirm no other code in this file assumes `staffNames` holds bare strings**

Run: `grep -n staffNames lautan-academy-frontend/src/views/LoginView.vue`
Expected: only the `ref([])` declaration, the `watch` block's `staffNames.value = data.staff || []` assignment, and the template line just edited. None of these need further changes — the `ref` and assignment are shape-agnostic (just hold whatever `data.staff` is), only the template rendered `n` directly before.

- [ ] **Step 3: Build check**

Run (from `lautan-academy-frontend/`): `npm run build`
Expected: builds clean, no errors.

- [ ] **Step 4: Commit**

```bash
git add lautan-academy-frontend/src/views/LoginView.vue
git commit -m "feat: show IDNote in staff login dropdown (Vue)"
```

---

## Part 3 — Vanilla (`index.html`, in the `lautan-academy` repo root)

All syntax-check steps below use the same extraction command (robust against line-number drift as the file changes across tasks — picks out the largest `<script>...</script>` block, which is always the main app script, not the small head script or the CDN `<script src=...>` tag):

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const biggest = blocks.reduce((a, b) => b.length > a.length ? b : a);
fs.writeFileSync(process.env.SCRATCH + '/vanilla_script_check.js', biggest);
"
node --check "$SCRATCH/vanilla_script_check.js" && echo "SYNTAX OK"
```
(`$SCRATCH` is any writable temp directory — set it once per session, e.g. `export SCRATCH=/tmp` or a project-appropriate scratch path.)

### Task 3: Rewrite `fetchData()` — drop GAS, source questions from the backend

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `allQuestions` now populated from `GET /questions` — each item shaped `{ id, topic, question_en, question_ms, opt1_en..opt4_ms, status }`, **no `correct` field**. This is a breaking change for any code still reading `q.correct` — Task 6 fixes the one remaining read (Standard Quiz's `handleChoice()`); Task 7 fixes `exitQuizWithAutosave()`'s read. `allStaffRoster` global is removed entirely — Task 4 and Task 5 depend on it being gone (they replace its two call sites).

- [ ] **Step 1: Remove the GAS_URL constant and its comment block**

Find:
```js
        // Only fetchData()'s pre-login bulk questions+staffRoster fetch still
        // goes through GAS — the new backend's equivalents (GET /questions,
        // GET /auth/staff-roster) are shaped differently (staff-roster needs
        // division+outlet per call, not one bulk list) and repointing that
        // is a separate piece of work, not part of the Resources/Content
        // bridge this was scoped to. Everything else — login, quiz, results,
        // reports, resources, content, manage staff — now goes through
        // BACKEND_URL exclusively.
        const GAS_URL = "https://script.google.com/macros/s/AKfycbyvioLEJ8tFK3766M8fj7wKxS5_qFDkKEKtniei3MHaP-aNkEq7LcwNqaVhcXgr26wKkg/exec";
        const BACKEND_URL = "https://lautan-academy-backend-production.up.railway.app";
```
Replace with:
```js
        // v1.38: vanilla no longer talks to GAS for anything — the last
        // bridge (this pre-login bulk questions+staffRoster fetch) is gone.
        // Questions come from GET /questions, staff roster is fetched
        // per-outlet on demand (see populateStaffNameOptions and
        // populateOutletMgrDropdowns) instead of one bulk list.
        const BACKEND_URL = "https://lautan-academy-backend-production.up.railway.app";
```

- [ ] **Step 2: Remove the `allStaffRoster` global**

Find:
```js
        let currentWarehouseMgrLocation = '';
        let allStaffRoster = [];
```
Replace with:
```js
        let currentWarehouseMgrLocation = '';
```

- [ ] **Step 3: Rewrite `fetchData()`**

Find:
```js
        async function fetchData() {
            document.getElementById('sync-error').classList.add('hidden');
            setLoader(true, "Loading...");
            try {
                const res = await fetch(GAS_URL + '?_=' + Date.now(), { cache: 'no-store' });
                const dataRaw = await res.json();
                allQuestions = dataRaw.questions || [];
                allStaffRoster = dataRaw.staffRoster || [];
                initDropdowns();
                populateGlobalData();
            } catch (e) {
                setLoader(false);
                document.getElementById('sync-error').classList.remove('hidden');
                return;
            }
            setLoader(false);
        }
```
Replace with:
```js
        async function fetchData() {
            document.getElementById('sync-error').classList.add('hidden');
            setLoader(true, "Loading...");
            try {
                const res = await fetch(BACKEND_URL + '/questions', { cache: 'no-store' });
                const data = await res.json();
                allQuestions = data.questions || [];
                initDropdowns();
                populateGlobalData();
            } catch (e) {
                setLoader(false);
                document.getElementById('sync-error').classList.remove('hidden');
                return;
            }
            setLoader(false);
        }
```

- [ ] **Step 4: Syntax-check**

Run the standard vanilla syntax-check command (top of Part 3).
Expected: `SYNTAX OK`.

- [ ] **Step 5: Confirm no remaining GAS reference**

Run: `grep -c GAS_URL index.html`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: fetchData() sources questions from backend, drop GAS_URL"
```

(Full browser verification of the topic list / bank-count display happens in Task 8 — `q.topic` and `q.status` field names are unchanged between the old GAS shape and the new backend shape, so no other code needs touching for this step alone.)

---

### Task 4: `populateStaffNameOptions()` — per-outlet async fetch

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `GET /auth/staff-roster` new shape (Task 1).
- Produces: same dropdown behavior as before (outlet+division picked → name list populated), now sourced live instead of from the removed `allStaffRoster`.

- [ ] **Step 1: Rewrite the function**

Find:
```js
        function populateStaffNameOptions(division) {
            const outletFieldId = division === 'warehouse' ? 'wh-staff-location' : 'staff-outlet';
            const nameFieldId = division === 'warehouse' ? 'wh-staff-name-select' : 'staff-name-select';
            const outlet = document.getElementById(outletFieldId).value;
            const nameSelect = document.getElementById(nameFieldId);
            if(!outlet) { nameSelect.innerHTML = '<option value="">Select outlet first...</option>'; return; }
            const names = allStaffRoster.filter(r => 
                (r.Division||'').toString().trim().toLowerCase() === division && 
                (r.Outlet||'').toString().trim().toUpperCase() === outlet.toUpperCase()
            );
            nameSelect.innerHTML = names.length 
                ? '<option value="">Select your name...</option>' + names.map(r => `<option value="${r.Name}">${r.Name}${r.IDNote ? ' (' + r.IDNote + ')' : ''}</option>`).join('')
                : '<option value="">No staff added for this outlet yet — ask your manager</option>';
        }
```
Replace with:
```js
        async function populateStaffNameOptions(division) {
            const outletFieldId = division === 'warehouse' ? 'wh-staff-location' : 'staff-outlet';
            const nameFieldId = division === 'warehouse' ? 'wh-staff-name-select' : 'staff-name-select';
            const outlet = document.getElementById(outletFieldId).value;
            const nameSelect = document.getElementById(nameFieldId);
            if(!outlet) { nameSelect.innerHTML = '<option value="">Select outlet first...</option>'; return; }
            nameSelect.innerHTML = '<option value="">Loading...</option>';
            let names = [];
            try {
                const res = await fetch(BACKEND_URL + '/auth/staff-roster?division=' + encodeURIComponent(division) + '&outlet=' + encodeURIComponent(outlet.toUpperCase()));
                const data = await res.json();
                names = data.staff || [];
            } catch (e) { /* leave names empty — falls through to the "no staff" message below */ }
            nameSelect.innerHTML = names.length
                ? '<option value="">Select your name...</option>' + names.map(r => `<option value="${r.name}">${r.name}${r.idNote ? ' (' + r.idNote + ')' : ''}</option>`).join('')
                : '<option value="">No staff added for this outlet yet — ask your manager</option>';
        }
```

- [ ] **Step 2: Syntax-check**

Run the standard vanilla syntax-check command.
Expected: `SYNTAX OK`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: populateStaffNameOptions() fetches per-outlet from backend"
```

---

### Task 5: Outlet Manager Staff Review — `staffReviewRoster` cache

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `GET /auth/staff-roster` new shape (Task 1).
- Produces: a module-level `staffReviewRoster` array, fetched once per outlet-manager dashboard load, consumed synchronously by `renderStaffReviewSummary()` on every filter change (no added network calls per filter tweak).

- [ ] **Step 1: Add the `staffReviewRoster` global**

Find:
```js
        let currentWarehouseMgrLocation = '';
```
(this is the same line Task 3 Step 2 already touched — after that task, it now directly precedes wherever the file's globals section ends). Add directly after it:
```js
        let staffReviewRoster = [];
```
So the two lines read, in order:
```js
        let currentWarehouseMgrLocation = '';
        let staffReviewRoster = [];
```

- [ ] **Step 2: Fetch it before rendering the summary**

Find (inside `populateOutletMgrDropdowns`):
```js
        function populateOutletMgrDropdowns(scope) {
```
Change the function signature line to:
```js
        async function populateOutletMgrDropdowns(scope) {
```

Then find, within the same function:
```js
            if (scope === 'retail') {
                const quizTopics = [...new Set(allResults.filter(r => (r.Outlet||"").toString().trim().toUpperCase() === outlet.toUpperCase()).map(r => (r.Topic||"").toString().trim()))].filter(Boolean).sort();
                const reportTopics = [...new Set(allReports.filter(r => (r.Outlet||"").toString().trim().toUpperCase() === outlet.toUpperCase()).map(r => (r["Training Title"]||"").toString().trim()))].filter(Boolean).sort();
                document.getElementById('staff-review-quiz-topic-filter').innerHTML = '<option value="ALL">All topics</option>' + quizTopics.map(t => `<option value="${t}">${t}</option>`).join('');
                document.getElementById('staff-review-ai-topic-filter').innerHTML = '<option value="ALL">All topics</option>' + outletAITopics.map(t => `<option value="${t}">${t}</option>`).join('');
                document.getElementById('staff-review-report-topic-filter').innerHTML = '<option value="ALL">All topics</option>' + reportTopics.map(t => `<option value="${t}">${t}</option>`).join('');
                renderStaffReviewSummary();
            }
```
Replace with:
```js
            if (scope === 'retail') {
                const quizTopics = [...new Set(allResults.filter(r => (r.Outlet||"").toString().trim().toUpperCase() === outlet.toUpperCase()).map(r => (r.Topic||"").toString().trim()))].filter(Boolean).sort();
                const reportTopics = [...new Set(allReports.filter(r => (r.Outlet||"").toString().trim().toUpperCase() === outlet.toUpperCase()).map(r => (r["Training Title"]||"").toString().trim()))].filter(Boolean).sort();
                document.getElementById('staff-review-quiz-topic-filter').innerHTML = '<option value="ALL">All topics</option>' + quizTopics.map(t => `<option value="${t}">${t}</option>`).join('');
                document.getElementById('staff-review-ai-topic-filter').innerHTML = '<option value="ALL">All topics</option>' + outletAITopics.map(t => `<option value="${t}">${t}</option>`).join('');
                document.getElementById('staff-review-report-topic-filter').innerHTML = '<option value="ALL">All topics</option>' + reportTopics.map(t => `<option value="${t}">${t}</option>`).join('');
                try {
                    const res = await fetch(BACKEND_URL + '/auth/staff-roster?division=retail&outlet=' + encodeURIComponent(outlet.toUpperCase()));
                    const data = await res.json();
                    staffReviewRoster = data.staff || [];
                } catch (e) { staffReviewRoster = []; }
                renderStaffReviewSummary();
            }
```

- [ ] **Step 3: Simplify `renderStaffReviewSummary()` to read the cache**

Find:
```js
            const staffHere = allStaffRoster.filter(r => (r.Division||'').toString().trim().toLowerCase() === 'retail' && (r.Outlet||'').toString().trim().toUpperCase() === outlet);
```
Replace with:
```js
            const staffHere = staffReviewRoster;
```

- [ ] **Step 4: Confirm the rest of `renderStaffReviewSummary()` still matches this shape**

Run: `grep -n -A3 "staffHere.map" index.html`
Expected: the mapping callback reads `s.Name` — this needs updating too, since the new roster shape is `{name, idNote}` not `{Name, Division, Outlet, ...}`. Find:
```js
            list.innerHTML = staffHere.map((s, i) => {
                const name = s.Name.toString().trim().toUpperCase();
```
Replace with:
```js
            list.innerHTML = staffHere.map((s, i) => {
                const name = s.name.toString().trim().toUpperCase();
```

- [ ] **Step 5: Syntax-check**

Run the standard vanilla syntax-check command.
Expected: `SYNTAX OK`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: Outlet Manager Staff Review fetches roster once, not from bulk GAS data"
```

---

### Task 6: `handleChoice()` — Standard Quiz live check, collapse the branch

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `POST /questions/:id/check` (existing backend endpoint, unchanged — `{chosen}` in, `{correct, correctIndex}` out), `q.id` (now present on every `allQuestions` item since Task 3).

- [ ] **Step 1: Rewrite the function**

Find (this is `handleChoice()` as it stands after the AI Practice fix from commit `98fd393`):
```js
        // AI Practice questions never carry `correct` (backend strips it from
        // POST /quiz/redeem — server grades attempts itself, see quiz.js) —
        // parseInt(q.correct) here would always be NaN, so every AI Practice
        // answer used to show as wrong regardless of what was picked. Fixed
        // by asking the backend live per answer, same pattern QuizView.vue
        // already uses. Standard Quiz still reads q.correct locally for
        // now — that data still comes from GAS's bulk fetch, which is a
        // separate, tracked piece of work (see docs/superpowers/specs).
        async function handleChoice(idx, btn, q) {
            const buttons = document.querySelectorAll('.opt-btn');
            buttons.forEach(b => b.style.pointerEvents = 'none');

            let correctIdx;
            if (isAIQuiz) {
                try {
                    const res = await fetch(BACKEND_URL + '/quiz/' + encodeURIComponent(loggedInStaffOutlet) + '/check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionToken },
                        body: JSON.stringify({ passcode: joinedPasscode, index: quizIdx, chosen: idx })
                    });
                    const data = await res.json();
                    correctIdx = data.correctIndex;
                } catch (e) {
                    buttons.forEach(b => b.style.pointerEvents = 'auto');
                    alert("Couldn't check your answer — check your connection and try again.");
                    return;
                }
            } else {
                correctIdx = parseInt(q.correct);
            }

            if (idx === correctIdx) { btn.classList.add('opt-correct'); score++; } else {
                btn.classList.add('opt-wrong'); buttons[correctIdx].classList.add('opt-correct');
                staffWrongs.push({ qText: currentLang === 'en' ? q.question_en : (q.question_ms || q.question_en), userChoice: btn.innerText, correctText: currentLang === 'en' ? q[`opt${correctIdx + 1}_en`] : (q[`opt${correctIdx+1}_ms`] || q[`opt${correctIdx+1}_en`]) });
            }
            if (quizIdx < currentQuizData.length - 1) document.getElementById('next-btn').classList.remove('hidden');
            else document.getElementById('submit-quiz-btn').classList.remove('hidden');
        }
```
Replace with:
```js
        // Neither quiz type carries a local `correct` field anymore —
        // Standard Quiz questions come from GET /questions (backend strips
        // it, same as AI Practice's POST /quiz/redeem) since the GAS bridge
        // was closed. Both paths now ask the backend live, per answer,
        // differing only in which check endpoint and body shape they use.
        async function handleChoice(idx, btn, q) {
            const buttons = document.querySelectorAll('.opt-btn');
            buttons.forEach(b => b.style.pointerEvents = 'none');

            let correctIdx;
            try {
                const res = isAIQuiz
                    ? await fetch(BACKEND_URL + '/quiz/' + encodeURIComponent(loggedInStaffOutlet) + '/check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionToken },
                        body: JSON.stringify({ passcode: joinedPasscode, index: quizIdx, chosen: idx })
                    })
                    : await fetch(BACKEND_URL + '/questions/' + q.id + '/check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionToken },
                        body: JSON.stringify({ chosen: idx })
                    });
                const data = await res.json();
                correctIdx = data.correctIndex;
            } catch (e) {
                buttons.forEach(b => b.style.pointerEvents = 'auto');
                alert("Couldn't check your answer — check your connection and try again.");
                return;
            }

            if (idx === correctIdx) { btn.classList.add('opt-correct'); score++; } else {
                btn.classList.add('opt-wrong'); buttons[correctIdx].classList.add('opt-correct');
                staffWrongs.push({ qText: currentLang === 'en' ? q.question_en : (q.question_ms || q.question_en), userChoice: btn.innerText, correctText: currentLang === 'en' ? q[`opt${correctIdx + 1}_en`] : (q[`opt${correctIdx+1}_ms`] || q[`opt${correctIdx+1}_en`]) });
            }
            if (quizIdx < currentQuizData.length - 1) document.getElementById('next-btn').classList.remove('hidden');
            else document.getElementById('submit-quiz-btn').classList.remove('hidden');
        }
```

- [ ] **Step 2: Syntax-check**

Run the standard vanilla syntax-check command.
Expected: `SYNTAX OK`.

- [ ] **Step 3: Backend verification of the exact call shape used above**

Run (with the local backend running, `npm run dev` in `lautan-academy-backend`): mint a staff token and hit the real endpoint the new code calls, using a real `standard_questions` row's id from your DB:
```bash
node -e "
import('./src/middleware/auth.js').then(({issueToken}) => console.log(issueToken('staff_retail', 'AJ|TEST STAFF')));
" 
```
(run from `lautan-academy-backend`, copy the printed token), then:
```bash
curl -s -X POST http://localhost:3000/questions/<a real id from `select id from standard_questions limit 1`>/check \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"chosen":0}'
```
Expected: `{"correct":<true or false>,"correctIndex":<0-3>}` — confirms the response shape `handleChoice()` now reads (`correctIndex`) is correct.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: Standard Quiz reveal uses live backend check, not local correct field"
```

---

### Task 7: `exitQuizWithAutosave()` — simplify to one path

**Files:**
- Modify: `index.html`

**Interfaces:** none new — internal cleanup following Task 6.

- [ ] **Step 1: Rewrite the loop**

Find:
```js
            for(let i = answeredCount; i < currentQuizData.length; i++) {
                const q = currentQuizData[i];
                // AI Practice questions have no local `correct` field (see
                // handleChoice) — showing the actual right answer here would
                // need a live check call per leftover question for a purely
                // informational summary line, not worth it. Standard Quiz
                // still has it locally, so its exit-early summary is unchanged.
                const correctIdx = isAIQuiz ? null : parseInt(q.correct);
                staffWrongs.push({
                    qText: currentLang === 'en' ? q.question_en : (q.question_ms || q.question_en),
                    userChoice: '(no answer — exited early)',
                    correctText: correctIdx === null ? '(not shown)' : (currentLang === 'en' ? q[`opt${correctIdx + 1}_en`] : (q[`opt${correctIdx + 1}_ms`] || q[`opt${correctIdx + 1}_en`]))
                });
            }
```
Replace with:
```js
            for(let i = answeredCount; i < currentQuizData.length; i++) {
                const q = currentQuizData[i];
                // Neither quiz type has a local `correct` field anymore (see
                // handleChoice) — showing the actual right answer here would
                // need a live check call per leftover question for a purely
                // informational summary line, not worth it either way.
                staffWrongs.push({
                    qText: currentLang === 'en' ? q.question_en : (q.question_ms || q.question_en),
                    userChoice: '(no answer — exited early)',
                    correctText: '(not shown)'
                });
            }
```

- [ ] **Step 2: Syntax-check**

Run the standard vanilla syntax-check command.
Expected: `SYNTAX OK`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "chore: simplify exitQuizWithAutosave, no quiz-type-specific correct-field read left"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Final syntax check**

Run the standard vanilla syntax-check command one more time on the fully-changed file.
Expected: `SYNTAX OK`.

- [ ] **Step 2: Confirm zero GAS references remain**

Run: `grep -in "gas" index.html | grep -v "gasoline\|gastro"` (guards against an unrelated false-positive substring match, though none are expected in this file).
Expected: no matches referencing `GAS_URL` or `script.google.com`.

- [ ] **Step 3: Browser check — Standard Quiz**

Open `index.html` locally (or wherever it's served for testing) against the local backend. Log in as a real staff account. Start a Standard Quiz for a topic with a known question. Answer at least one question correctly and one incorrectly — confirm the reveal (green/red highlight) matches the real answer (cross-check against `select * from standard_questions where id = <the question's id>` in the DB). Submit the quiz, confirm the saved result's score matches what was shown live.

- [ ] **Step 4: Browser check — AI Practice regression guard**

Join an AI Practice quiz (real passcode from an outlet/warehouse manager dashboard). Confirm reveal still works correctly (this was already fixed in commit `98fd393` — just confirming Task 6's refactor of `handleChoice()` didn't break the AI branch).

- [ ] **Step 5: Browser check — staff login dropdown**

On the staff login screen, pick an outlet known to have duplicate staff names (or seed one via `scripts/seed.js` with two staff sharing a name at the same outlet, different `id_note`, then clean up after). Confirm both names show with their distinguishing `IDNote` suffix.

- [ ] **Step 6: Browser check — Outlet Manager Staff Review**

Log in as an Outlet Manager. Open the Staff Review section. Confirm the real roster renders. Open browser devtools' Network tab, change one of the 3 topic filters — confirm no new `/auth/staff-roster` request fires (only the initial dashboard load should have made one).

- [ ] **Step 7: Vue browser check — login dropdown IDNote**

Open the Vue app (`lautan-academy-frontend`, `npm run dev`), same outlet with duplicate names from Step 5. Confirm the dropdown now also shows `IDNote` (new capability, wasn't there before this plan).

- [ ] **Step 8: Update MEMORY.md**

Add a completion entry for this work — mirrors the established pattern in this project (see the i18n batch entries and the Master User subsystem A entry): what shipped, what was verified and how, cross-reference commit hashes from Tasks 1-7.

- [ ] **Step 9: Commit the MEMORY.md update**

```bash
git add MEMORY.md
git commit -m "docs: close out vanilla GAS-bridge removal — verified live"
```

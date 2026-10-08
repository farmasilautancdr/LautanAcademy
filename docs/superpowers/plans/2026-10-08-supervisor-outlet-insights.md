# Supervisor Module Quiz CSV — Dedup, Outlet Tiers, AI Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supervisor's Module Quiz CSV export dedupes staff retakes (first valid attempt only), flags staff whose retakes swung ≥20 points, rolls deduped scores into a per-outlet Top/Middle/Bottom tier, and appends an AI-generated (Gemini), topic-tailored improvement suggestion per outlet tied to that outlet's most commonly missed question.

**Architecture:** A new backend endpoint (`POST /supervisor-insights/outlet-suggestions`) wraps a new `generateOutletSuggestion` function in the existing Gemini service, caching results in the existing `system_settings` key-value table (key includes a hash of the missed question, so it self-invalidates when the weak spot changes). The frontend computes dedup/tiers/most-missed-question client-side from data it already loads, calls the new endpoint once per CSV download (only when a single Topic is selected), and falls back to static generic tier text on any failure.

**Tech Stack:** Node.js/Express/Postgres backend (`farmasilautancdr-lautan-academy-backend-/`), Vue 3 frontend (`lautan-academy-frontend/`), existing Gemini API integration, Vitest + Supertest for backend tests.

**Spec:** `docs/superpowers/specs/2026-10-08-supervisor-outlet-insights-design.md`

## Global Constraints

- Module Quiz CSV only — do not touch `SupervisorReportsView.vue` or `QuizHistoryView.vue`'s CSV exports.
- Dedup grouping key is (Staff Name, Outlet, Topic). Counted entry = earliest attempt with `parseInt(Percentage) >= 30`; if none qualify, fall back to the group's earliest entry regardless of score.
- "Large score gap" = group's `max% - min% >= 20` (only when the group has more than one attempt).
- Tiers (computed off deduped data): `avgPercent >= 95` → top, `>= 85` → middle, else → bottom.
- AI suggestions only generated when a single Topic is selected (not "All Topics"); "All Topics" always uses the static generic tier text, no Gemini call, no cache write.
- Cache: reuse `system_settings` table, no new migration. Key format: `` suggestion:<topic>:<tier>:<8-char hex hash of missedQuestion> ``. A cache row is fresh if `generatedAt` is less than 35 days old.
- English only — no bilingual suggestion text.
- Any Gemini failure (per-key) falls back to the static generic tier text for that key only; it must never fail the whole batch request.
- Static generic tier fallback text (used verbatim, both server- and client-side):
  - top: `"Outlet is performing well on this topic — keep reinforcing correct answers in daily huddles so the standard holds through staff turnover."`
  - middle: `"Outlet is above the minimum bar but inconsistent — review the most-missed question above as a team and re-quiz in a few weeks."`
  - bottom: `"Outlet needs a structured refresher on this topic before the next quiz cycle — start with the most-missed question above."`

---

## Task 1: Gemini service — `generateOutletSuggestion`

**Files:**
- Modify: `farmasilautancdr-lautan-academy-backend-/src/services/gemini.js`
- Test: `farmasilautancdr-lautan-academy-backend-/tests/gemini.suggestionPrompt.test.js`

**Interfaces:**
- Produces: `export function buildSuggestionPrompt(topic, tier, missedQuestion, correctAnswer) -> string` and `export async function generateOutletSuggestion(topic, tier, missedQuestion, correctAnswer) -> Promise<string>`, both from `services/gemini.js`. Task 2 imports `generateOutletSuggestion`.

- [ ] **Step 1: Write the failing test**

Create `farmasilautancdr-lautan-academy-backend-/tests/gemini.suggestionPrompt.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildSuggestionPrompt } from '../src/services/gemini.js';

describe('buildSuggestionPrompt', () => {
  it('includes the topic, a tier description, and the missed question/answer', () => {
    const prompt = buildSuggestionPrompt('Supplements', 'bottom', 'Which vitamin interacts with warfarin?', 'Vitamin K');
    expect(prompt).toContain('Supplements');
    expect(prompt).toContain('struggling');
    expect(prompt).toContain('Which vitamin interacts with warfarin?');
    expect(prompt).toContain('Vitamin K');
  });

  it('falls back to a no-data note when there is no missed question', () => {
    const prompt = buildSuggestionPrompt('Supplements', 'top', '', '');
    expect(prompt).toContain('No specific question data is available');
  });

  it('defaults to the middle tier description for an unrecognized tier value', () => {
    const prompt = buildSuggestionPrompt('Supplements', 'weird-value', 'Q', 'A');
    expect(prompt).toContain('middling');
  });

  it('instructs plain text with no markdown', () => {
    const prompt = buildSuggestionPrompt('Supplements', 'middle', 'Q', 'A');
    expect(prompt).toContain('Plain text only, no markdown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd farmasilautancdr-lautan-academy-backend- && npx vitest run tests/gemini.suggestionPrompt.test.js`
Expected: FAIL — `buildSuggestionPrompt is not a function` (not exported yet).

- [ ] **Step 3: Implement `buildSuggestionPrompt` + `generateOutletSuggestion`, and parameterize `callGemini`**

Modify `farmasilautancdr-lautan-academy-backend-/src/services/gemini.js`.

Replace the existing `callGemini` function:

```js
async function callGemini(prompt) {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is not set in .env');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content.');
  return text;
}
```

with a version that accepts a `generationConfig` override (the rest of the function body is unchanged — only the signature and the `generationConfig` object inside `payload` differ):

```js
async function callGemini(prompt, generationConfig = {}) {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is not set in .env');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      ...generationConfig,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content.');
  return text;
}
```

(`generateQuiz` below is unchanged — it still calls `callGemini(prompt)` with no second argument, so it keeps the JSON defaults exactly as before.)

Add this new code at the end of the file, after `generateQuiz`:

```js
const TIER_LABEL = {
  top: 'top-performing (scoring 95% or higher)',
  middle: 'middling (scoring 85-94%)',
  bottom: 'struggling (scoring 84% or lower)',
};

export function buildSuggestionPrompt(topic, tier, missedQuestion, correctAnswer) {
  const tierLabel = TIER_LABEL[tier] || TIER_LABEL.middle;
  const missedPart = missedQuestion
    ? `The single most commonly missed question at this outlet for this topic was:\n"""\n${missedQuestion}\n"""\nThe correct answer is: "${correctAnswer || '(not recorded)'}"`
    : `No specific question data is available — staff at this outlet got nearly everything right on this topic, or no wrong-answer data was recorded.`;

  return `You are a community pharmacy training specialist in Malaysia, advising a retail pharmacy chain's Supervisor on how one outlet should act on its Module Quiz results.

Topic: "${topic}"
This outlet's staff are ${tierLabel} on this topic.
${missedPart}

Write 2 to 4 sentences of concrete, specific advice for this outlet's manager to act on before the next quiz cycle. If the topic is about a specific product, supplement, or drug class, name concrete cross-sell/upsell pairings and one real counselling point tied directly to the missed question above. Do not write generic filler like "continue to improve" or "leverage your strengths" — every sentence must name a specific action, product, or behavior. Plain text only, no markdown, no headings, no bullet points.`;
}

export async function generateOutletSuggestion(topic, tier, missedQuestion, correctAnswer) {
  const prompt = buildSuggestionPrompt(topic, tier, missedQuestion, correctAnswer);
  const text = await callGemini(prompt, { responseMimeType: 'text/plain', temperature: 0.4, maxOutputTokens: 400 });
  return text.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd farmasilautancdr-lautan-academy-backend- && npx vitest run tests/gemini.suggestionPrompt.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd farmasilautancdr-lautan-academy-backend-
git add src/services/gemini.js tests/gemini.suggestionPrompt.test.js
git commit -m "feat: add generateOutletSuggestion to Gemini service"
```

---

## Task 2: Backend endpoint — `POST /supervisor-insights/outlet-suggestions`

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/src/routes/supervisorInsights.js`
- Modify: `farmasilautancdr-lautan-academy-backend-/src/app.js`
- Test: `farmasilautancdr-lautan-academy-backend-/tests/supervisorInsights.test.js`

**Interfaces:**
- Consumes: `generateOutletSuggestion(topic, tier, missedQuestion, correctAnswer)` from Task 1 (`../services/gemini.js`); `requireAuth`, `requireScope` from `../middleware/auth.js`; `pool` from `../config/db.js`.
- Produces: `export const supervisorInsightsRouter` (Express Router), mounted at `/supervisor-insights`. Route: `POST /outlet-suggestions` → `{ suggestions: { [outletCode]: string } }`.

- [ ] **Step 1: Write the failing tests**

Create `farmasilautancdr-lautan-academy-backend-/tests/supervisorInsights.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';

const generateOutletSuggestion = vi.fn();
vi.mock('../src/services/gemini.js', () => ({ generateOutletSuggestion }));

import { app } from '../src/app.js';
import { pool } from '../src/config/db.js';
import { issueToken } from '../src/middleware/auth.js';

describe('POST /supervisor-insights/outlet-suggestions', () => {
  let supervisorToken, topic, keysUsed;

  beforeEach(async () => {
    generateOutletSuggestion.mockReset();
    generateOutletSuggestion.mockResolvedValue('Generated suggestion text.');
    supervisorToken = await issueToken('supervisor', 'ALL');
    topic = `TESTTOPIC_${randomUUID()}`;
    keysUsed = [];
  });

  afterEach(async () => {
    if (keysUsed.length) await pool.query('delete from system_settings where key = ANY($1)', [keysUsed]);
    await pool.query('delete from sessions where scope_type = $1 and scope_key = $2', ['supervisor', 'ALL']);
  });

  it('refuses a non-supervisor token', async () => {
    const outletToken = await issueToken('outlet_manager', 'R1-001');
    const res = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${outletToken}`)
      .send({ topic, outlets: [{ code: 'R1-001', tier: 'top', missedQuestion: 'Q', correctAnswer: 'A' }] });
    expect(res.status).toBe(403);
    await pool.query('delete from sessions where scope_type = $1 and scope_key = $2', ['outlet_manager', 'R1-001']);
  });

  it('rejects a request with no outlets', async () => {
    const res = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ topic, outlets: [] });
    expect(res.status).toBe(400);
  });

  it('calls Gemini on a cache miss and returns the generated text', async () => {
    const res = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ topic, outlets: [{ code: 'R1-001', tier: 'bottom', missedQuestion: 'Q1', correctAnswer: 'A1' }] });
    expect(res.status).toBe(200);
    expect(res.body.suggestions['R1-001']).toBe('Generated suggestion text.');
    expect(generateOutletSuggestion).toHaveBeenCalledTimes(1);
    expect(generateOutletSuggestion).toHaveBeenCalledWith(topic, 'bottom', 'Q1', 'A1');
    const { rows } = await pool.query(`select key from system_settings where key like $1`, [`suggestion:${topic}:%`]);
    keysUsed = rows.map(r => r.key);
    expect(rows).toHaveLength(1);
  });

  it('reuses a fresh cache entry without calling Gemini again', async () => {
    const first = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ topic, outlets: [{ code: 'R1-001', tier: 'bottom', missedQuestion: 'Q1', correctAnswer: 'A1' }] });
    const { rows } = await pool.query(`select key from system_settings where key like $1`, [`suggestion:${topic}:%`]);
    keysUsed = rows.map(r => r.key);
    generateOutletSuggestion.mockClear();

    const second = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ topic, outlets: [{ code: 'R1-001', tier: 'bottom', missedQuestion: 'Q1', correctAnswer: 'A1' }] });
    expect(second.status).toBe(200);
    expect(second.body.suggestions['R1-001']).toBe(first.body.suggestions['R1-001']);
    expect(generateOutletSuggestion).not.toHaveBeenCalled();
  });

  it('regenerates a stale (>35 day old) cache entry', async () => {
    const first = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ topic, outlets: [{ code: 'R1-001', tier: 'bottom', missedQuestion: 'Q1', correctAnswer: 'A1' }] });
    const { rows } = await pool.query(`select key from system_settings where key like $1`, [`suggestion:${topic}:%`]);
    keysUsed = rows.map(r => r.key);
    const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `update system_settings set value = jsonb_set(value, '{generatedAt}', $1::jsonb) where key = $2`,
      [JSON.stringify(staleDate), rows[0].key]
    );
    generateOutletSuggestion.mockReset();
    generateOutletSuggestion.mockResolvedValue('Fresh regenerated text.');

    const second = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ topic, outlets: [{ code: 'R1-001', tier: 'bottom', missedQuestion: 'Q1', correctAnswer: 'A1' }] });
    expect(second.body.suggestions['R1-001']).toBe('Fresh regenerated text.');
    expect(generateOutletSuggestion).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static tier text when Gemini throws, and still returns 200', async () => {
    generateOutletSuggestion.mockRejectedValue(new Error('Gemini request failed (503)'));
    const res = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ topic, outlets: [{ code: 'R1-001', tier: 'bottom', missedQuestion: 'Q1', correctAnswer: 'A1' }] });
    expect(res.status).toBe(200);
    expect(res.body.suggestions['R1-001']).toContain('structured refresher');
    const { rows } = await pool.query(`select key from system_settings where key like $1`, [`suggestion:${topic}:%`]);
    expect(rows).toHaveLength(0);
  });

  it('dedupes two outlets sharing the same tier and missed question into one Gemini call', async () => {
    const res = await request(app)
      .post('/supervisor-insights/outlet-suggestions')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        topic,
        outlets: [
          { code: 'R1-001', tier: 'top', missedQuestion: 'Same Q', correctAnswer: 'Same A' },
          { code: 'R1-002', tier: 'top', missedQuestion: 'Same Q', correctAnswer: 'Same A' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.suggestions['R1-001']).toBe(res.body.suggestions['R1-002']);
    expect(generateOutletSuggestion).toHaveBeenCalledTimes(1);
    const { rows } = await pool.query(`select key from system_settings where key like $1`, [`suggestion:${topic}:%`]);
    keysUsed = rows.map(r => r.key);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd farmasilautancdr-lautan-academy-backend- && npx vitest run tests/supervisorInsights.test.js`
Expected: FAIL — `Cannot find module '../src/routes/supervisorInsights.js'` (route doesn't exist yet), or 404s once `app.js` is reached, since the router isn't mounted.

- [ ] **Step 3: Create the route**

Create `farmasilautancdr-lautan-academy-backend-/src/routes/supervisorInsights.js`:

```js
import { Router } from 'express';
import { createHash } from 'crypto';
import { pool } from '../config/db.js';
import { requireAuth, requireScope } from '../middleware/auth.js';
import { generateOutletSuggestion } from '../services/gemini.js';

export const supervisorInsightsRouter = Router();

// Cache lives in system_settings (existing key-value table, previously
// only held the maintenance kill-switch) — no migration needed. A cache
// key bakes in a hash of the outlet's most-missed question, so the entry
// naturally invalidates itself the moment that question changes; no
// manual "regenerate" action exists or is needed. See
// docs/superpowers/specs/2026-10-08-supervisor-outlet-insights-design.md.
const CACHE_TTL_MS = 35 * 24 * 60 * 60 * 1000;
const VALID_TIERS = ['top', 'middle', 'bottom'];

// Mirrors the client-side copy in SupervisorDashboard.vue — intentionally
// duplicated, not shared, because the two copies cover different failure
// domains (this one covers a single Gemini call failing; the frontend's
// covers the whole network request to this endpoint failing). Same
// precedent as csvEscape being duplicated per CSV-exporting file already.
const STATIC_FALLBACK = {
  top: 'Outlet is performing well on this topic — keep reinforcing correct answers in daily huddles so the standard holds through staff turnover.',
  middle: 'Outlet is above the minimum bar but inconsistent — review the most-missed question above as a team and re-quiz in a few weeks.',
  bottom: 'Outlet needs a structured refresher on this topic before the next quiz cycle — start with the most-missed question above.',
};

function hash8(text) {
  return createHash('sha256').update(text || '').digest('hex').slice(0, 8);
}

function normalizeTier(tier) {
  return VALID_TIERS.includes(tier) ? tier : 'middle';
}

function cacheKeyFor(topic, tier, missedQuestion) {
  return `suggestion:${topic}:${tier}:${hash8(missedQuestion)}`;
}

supervisorInsightsRouter.post('/outlet-suggestions', requireAuth, requireScope('supervisor'), async (req, res) => {
  const topic = (req.body.topic || '').toString().trim();
  const outlets = Array.isArray(req.body.outlets) ? req.body.outlets : [];
  if (!topic || !outlets.length) {
    return res.status(400).json({ error: 'topic and a non-empty outlets array are required.' });
  }

  // Dedup identical (tier, missedQuestion) combos up front — two outlets
  // sharing both share one Gemini call and one cache row.
  const entries = outlets.map(o => {
    const code = (o.code || '').toString();
    const tier = normalizeTier((o.tier || '').toString());
    const missedQuestion = (o.missedQuestion || '').toString();
    const correctAnswer = (o.correctAnswer || '').toString();
    return { code, tier, missedQuestion, correctAnswer, key: cacheKeyFor(topic, tier, missedQuestion) };
  });
  const uniqueKeys = [...new Set(entries.map(e => e.key))];

  const { rows: cached } = await pool.query('select key, value from system_settings where key = ANY($1)', [uniqueKeys]);
  const cacheByKey = new Map(cached.map(r => [r.key, r.value]));

  const textByKey = new Map();
  for (const key of uniqueKeys) {
    const hit = cacheByKey.get(key);
    const fresh = hit?.generatedAt && (Date.now() - new Date(hit.generatedAt).getTime() < CACHE_TTL_MS);
    if (fresh) {
      textByKey.set(key, hit.text);
      continue;
    }

    const entry = entries.find(e => e.key === key);
    try {
      const text = await generateOutletSuggestion(topic, entry.tier, entry.missedQuestion, entry.correctAnswer);
      textByKey.set(key, text);
      await pool.query(
        `insert into system_settings (key, value, updated_at) values ($1, $2, now())
         on conflict (key) do update set value = $2, updated_at = now()`,
        [key, JSON.stringify({ text, generatedAt: new Date().toISOString() })]
      );
    } catch (e) {
      textByKey.set(key, STATIC_FALLBACK[entry.tier]);
    }
  }

  const suggestions = {};
  for (const entry of entries) suggestions[entry.code] = textByKey.get(entry.key);
  res.json({ suggestions });
});
```

- [ ] **Step 4: Mount the router**

Modify `farmasilautancdr-lautan-academy-backend-/src/app.js`. Add the import near the other route imports (after the `pharmacistComplianceRouter` import on line 21):

```js
import { pharmacistComplianceRouter } from './routes/pharmacistCompliance.js';
import { supervisorInsightsRouter } from './routes/supervisorInsights.js';
import { checkMaintenance } from './middleware/auth.js';
```

Add the mount line after the pharmacist-compliance mount (currently line 48):

```js
app.use('/pharmacist-compliance', checkMaintenance, pharmacistComplianceRouter);
app.use('/supervisor-insights', checkMaintenance, supervisorInsightsRouter);
app.use(masterBackupRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd farmasilautancdr-lautan-academy-backend- && npx vitest run tests/supervisorInsights.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full backend test suite to check for regressions**

Run: `cd farmasilautancdr-lautan-academy-backend- && npm test`
Expected: PASS, all suites (including the pre-existing `quiz.scoping.test.js`, `grading.*.test.js`, `health.test.js`).

- [ ] **Step 7: Commit**

```bash
cd farmasilautancdr-lautan-academy-backend-
git add src/routes/supervisorInsights.js src/app.js tests/supervisorInsights.test.js
git commit -m "feat: add POST /supervisor-insights/outlet-suggestions endpoint"
```

---

## Task 3: Frontend API client method

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js:80`

**Interfaces:**
- Consumes: the `request()` helper already defined in this file.
- Produces: `api.getOutletSuggestions({ topic, outlets }) -> Promise<{ suggestions: Record<string, string> }>`. Task 4 calls this.

- [ ] **Step 1: Add the method**

Modify `lautan-academy-frontend/src/api/client.js`. Immediately after this existing line:

```js
  getPharmacistCompliance: () => request('/pharmacist-compliance'),
```

add:

```js
  getOutletSuggestions: (payload) =>
    request('/supervisor-insights/outlet-suggestions', { method: 'POST', body: JSON.stringify(payload) }),
```

- [ ] **Step 2: Verify the frontend still builds**

Run: `cd lautan-academy-frontend && npm run build`
Expected: builds clean (same pre-existing chunk-size warning as before, no new errors).

- [ ] **Step 3: Commit**

```bash
cd lautan-academy-frontend
git add src/api/client.js
git commit -m "feat: add getOutletSuggestions API client method"
```

---

## Task 4: Frontend — dedup, outlet tiers, AI suggestions in `SupervisorDashboard.vue`

**Files:**
- Modify: `lautan-academy-frontend/src/views/SupervisorDashboard.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json` (`supervisorDashboard` block, currently ends at line 523)
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json` (`supervisorDashboard` block, currently ends at line 523)

**Interfaces:**
- Consumes: `api.getOutletSuggestions` from Task 3; `data.wrongAnswers` (already returned by the existing `GET /data/scoped-data` for `scopeType === 'supervisor'`, just not currently read by this file).

- [ ] **Step 1: Add i18n keys**

Modify `lautan-academy-frontend/src/i18n/locales/en.json`. Replace:

```json
    "activityLog": "Activity Log",
    "noActivity": "No activity in this window."
  },
```

(inside the `supervisorDashboard` block) with:

```json
    "activityLog": "Activity Log",
    "noActivity": "No activity in this window.",
    "generatingSuggestions": "Generating suggestions...",
    "suggestionsDegraded": "AI suggestions unavailable this time — showing generic tips."
  },
```

Modify `lautan-academy-frontend/src/i18n/locales/ms.json`. Replace:

```json
    "activityLog": "Log Aktiviti",
    "noActivity": "Tiada aktiviti dalam tempoh ini."
  },
```

with:

```json
    "activityLog": "Log Aktiviti",
    "noActivity": "Tiada aktiviti dalam tempoh ini.",
    "generatingSuggestions": "Menjana cadangan...",
    "suggestionsDegraded": "Cadangan AI tidak tersedia kali ini — memaparkan tip generik."
  },
```

- [ ] **Step 2: Verify JSON is still valid**

Run: `cd lautan-academy-frontend && node -p "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')) && 'ok'"` and the same for `ms.json`.
Expected: both print `ok`.

- [ ] **Step 3: Load `wrongAnswers` and add the dedup/tier/suggestion logic**

Modify `lautan-academy-frontend/src/views/SupervisorDashboard.vue`.

Replace:

```js
const results = ref([])
```

with:

```js
const results = ref([])
const wrongAnswers = ref([])
const downloading = ref(false)
const status = ref('')
const statusOk = ref(false)
```

Replace the existing `load()` function:

```js
async function load() {
  loading.value = true
  try {
    const data = await api.getScopedData(windowMonths.value)
    results.value = data.results || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}
```

with:

```js
async function load() {
  loading.value = true
  try {
    const data = await api.getScopedData(windowMonths.value)
    results.value = data.results || []
    wrongAnswers.value = data.wrongAnswers || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}
```

Immediately after the existing `outletRegion` computed (ends with the `csvEscape`/`CSV_COLUMNS` section — insert this new block right before the `const CSV_COLUMNS = [` line), add:

```js
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
```

- [ ] **Step 4: Extend `CSV_COLUMNS` and rewrite `downloadCsv`**

Replace the existing `CSV_COLUMNS` array:

```js
const CSV_COLUMNS = [
  ['Timestamp', r => new Date(r.Timestamp).toISOString()],
  ['Region', r => outletRegion.value[r.Outlet] || ''],
  ['Outlet', r => r.Outlet],
  ['Staff Name', r => r.Name],
  ['Quiz Type', () => 'Module Quiz'],
  ['Topic', r => r.Topic],
  ['Score', r => (r.Score || '').replace('/', ' of ')],
  ['Percentage', r => r.Percentage],
]
```

with:

```js
const CSV_COLUMNS = [
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
```

Replace the existing `downloadCsv` function:

```js
function downloadCsv() {
  const header = CSV_COLUMNS.map(([label]) => csvEscape(label)).join(',')
  const rows = filteredModuleQuiz.value.map(r => CSV_COLUMNS.map(([, get]) => csvEscape(get(r))).join(','))
  // BOM so Excel opens the bilingual (EN/MS) text as UTF-8 instead of guessing wrong.
  const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `module-quiz-results-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
```

with:

```js
async function downloadCsv() {
  downloading.value = true
  status.value = ''
  try {
    const header = CSV_COLUMNS.map(([label]) => csvEscape(label)).join(',')
    const rows = dedupedModuleQuiz.value.map(r => CSV_COLUMNS.map(([, get]) => csvEscape(get(r))).join(','))

    let summaries = outletSummaries.value
    let suggestionByOutlet = {}
    if (topicFilter.value !== 'ALL' && summaries.length) {
      try {
        const { suggestions } = await api.getOutletSuggestions({
          topic: topicFilter.value,
          outlets: summaries.map(s => ({ code: s.outlet, tier: s.tier, missedQuestion: s.missedQuestion, correctAnswer: s.correctAnswer })),
        })
        suggestionByOutlet = suggestions || {}
      } catch (e) {
        status.value = t('supervisorDashboard.suggestionsDegraded')
        statusOk.value = false
      }
    }

    const summaryHeader = ['Outlet', 'Region', 'Average %', 'Tier', 'Entries Counted', 'Most Missed Question', 'Suggestion'].map(csvEscape).join(',')
    const summaryRows = summaries.map(s => {
      const suggestion = suggestionByOutlet[s.outlet] || STATIC_FALLBACK[s.tier]
      const missed = s.missedQuestion ? `${s.missedQuestion} (missed by ${s.missedCount} staff)` : ''
      return [s.outlet, s.region, `${s.avgPercent}%`, TIER_DISPLAY[s.tier], s.entriesCounted, missed, suggestion].map(csvEscape).join(',')
    })

    const csvBody = [header, ...rows, '', 'OUTLET SUMMARY', summaryHeader, ...summaryRows].join('\r\n')
    // BOM so Excel opens the bilingual (EN/MS) text as UTF-8 instead of guessing wrong.
    const blob = new Blob(['﻿' + csvBody], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `module-quiz-results-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } finally {
    downloading.value = false
  }
}
```

- [ ] **Step 5: Update the template — button state and status line**

Replace:

```html
        <button type="button" @click="downloadCsv" :disabled="filteredModuleQuiz.length === 0"
          class="ml-auto bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40">
          {{ t('supervisorDashboard.downloadCsv') }}
        </button>
      </div>
```

with:

```html
        <button type="button" @click="downloadCsv" :disabled="downloading || dedupedModuleQuiz.length === 0"
          class="ml-auto bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40">
          {{ downloading ? t('supervisorDashboard.generatingSuggestions') : t('supervisorDashboard.downloadCsv') }}
        </button>
      </div>

      <p v-if="status" class="text-xs mb-4" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
```

- [ ] **Step 6: Verify the frontend builds clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: builds clean, same pre-existing chunk-size warning, no new errors.

- [ ] **Step 7: Manual browser verification**

Run: `cd lautan-academy-frontend && npm run dev` and (in another terminal) `cd farmasilautancdr-lautan-academy-backend- && npm run dev` (needs a real `.env` with `DATABASE_URL`/`JWT_SECRET`/`GEMINI_API_KEY` — use whatever the Supervisor normally uses for local dev, not the test DB).

In the browser, log in as Supervisor and open Module Quiz Review:
1. Pick a single Topic that has at least one staff member with more than one attempt. Click Download CSV. Confirm the button briefly reads "Generating suggestions..." then re-enables. Open the downloaded file: raw rows show one row per staff/topic/outlet (not one per attempt), `Duplicate Attempts`/`Large Score Gap` columns populated correctly for the known retake, and an `OUTLET SUMMARY` block appears below a blank line with a plausible tier per outlet and a suggestion that specifically references the topic and the listed most-missed question (not boilerplate).
2. Switch the Topic filter to "All Topics" and download again. Confirm the summary block still appears, every `Suggestion` cell is exactly one of the three static fallback strings, and (via browser devtools Network tab) no request was made to `/supervisor-insights/outlet-suggestions`.
3. Temporarily stop the backend (or rename `GEMINI_API_KEY` in `.env` to something invalid) and download again with a single Topic selected. Confirm the CSV still downloads (summary rows use the static fallback text) and the on-screen status line shows the "AI suggestions unavailable" message.

- [ ] **Step 8: Commit**

```bash
cd lautan-academy-frontend
git add src/views/SupervisorDashboard.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: dedupe retakes, add outlet tiers and AI suggestions to Module Quiz CSV"
```

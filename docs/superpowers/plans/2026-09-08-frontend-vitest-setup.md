# Frontend Vitest + @vue/test-utils Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Stand up a working vitest + @vue/test-utils test harness in `lautan-academy-frontend/` — installed, configured, and proven with one smoke test that exercises the real Pinia/Vue Router/vue-i18n stack together (no real component/store test suites written here — that's future work).

**Architecture:** `vitest` (jsdom environment, `@vitejs/plugin-vue`) mounts the real `App.vue` via `@vue/test-utils`, against a real `i18n` instance (imported as-is from `src/i18n/index.js`), a minimal one-route test-only router (not the real `router/index.js`, which eagerly imports the whole app), and `@pinia/testing`'s `createTestingPinia({ stubActions: true })` so the real `useAuthStore`/`useMaintenanceStore` state/getters run but their actions (which call `fetch`) are auto-mocked no-ops.

**Tech Stack:** vitest, @vue/test-utils, jsdom, @pinia/testing, existing `vue`/`vue-router`/`vue-i18n`/`pinia`/`@vitejs/plugin-vue` stack (no new production dependencies).

**Spec:** `docs/superpowers/specs/2026-09-08-frontend-vitest-setup-design.md`

## Global Constraints

- Harness only — no real component/store/composable test suites in this plan (spec: "No real test coverage... deliberately separate future work").
- `vitest` version pinned to the `^5.0.0` family, matching the backend's `lautan-academy-backend` for consistency (spec: "Dependencies").
- No `setupFiles` — jsdom provides `localStorage` natively; the real `i18n` module and `store/auth.js`'s state factory both work unmodified under it (spec: "Config").
- Test router must NOT import the real `src/router/index.js` — build a minimal one-route memory-history router instead (spec: "eagerly imports every view in the app... would make this smoke test a full-app integration test").
- No `pretest` script — no disposable DB or other precondition to spin up, unlike the backend (spec: "Script").
- Out of scope: frontend CI workflow, wiring `npm test` into the existing repo-root `.husky/pre-push` (build-only today), backend auth/lockout tests.
- All work happens inside `lautan-academy-frontend/` — do not touch the repo-root `package.json`/`.husky/pre-push` (frontend build-only hook, added by the prior grading-test-suite plan's Task 9).

---

## Task 1: Install Test Harness Dependencies

**Files:**
- Modify: `lautan-academy-frontend/package.json`

**Interfaces:**
- Produces: `vitest`, `@vue/test-utils`, `jsdom`, `@pinia/testing` available as dev dependencies for every later task in this plan.

- [x] **Step 1: Install the dependencies**

Run (from `lautan-academy-frontend/`):
```bash
npm install --save-dev vitest@^5.0.0 @vue/test-utils jsdom @pinia/testing
```

- [x] **Step 2: Verify install**

Run: `npm ls vitest @vue/test-utils jsdom @pinia/testing`
Expected: all four listed with resolved versions, no `UNMET DEPENDENCY` errors.

- [x] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "test: install vitest, @vue/test-utils, jsdom, @pinia/testing"
```

---

## Task 2: Vitest Config + App.vue Smoke Test

**Files:**
- Create: `lautan-academy-frontend/vitest.config.js`
- Create: `lautan-academy-frontend/tests/App.smoke.test.js`
- Modify: `lautan-academy-frontend/package.json`

**Interfaces:**
- Consumes: `App.vue` (`../src/App.vue`, unmodified), `i18n` default export (`../src/i18n/index.js`, unmodified).
- Produces: `npm test` runnable from `lautan-academy-frontend/`, 1 passing test — the harness later component/store tests will build on.

- [x] **Step 1: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
  },
});
```

- [x] **Step 2: Add the `test` script to `package.json`**

Add to the `"scripts"` block:
```json
"test": "vitest run"
```

- [x] **Step 3: Write the smoke test — `tests/App.smoke.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createTestingPinia } from '@pinia/testing';
import App from '../src/App.vue';
import i18n from '../src/i18n';

describe('App.vue smoke test', () => {
  it('mounts with router+pinia+i18n and renders the unauthenticated router-view', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div>stub</div>' } }],
    });
    router.push('/');
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [
          router,
          i18n,
          createTestingPinia({ stubActions: true }),
        ],
      },
    });

    expect(wrapper.text()).toContain('stub');
  });
});
```

- [x] **Step 4: Run the test**

Run: `npm test` (from `lautan-academy-frontend/`)
Expected: `Test Files 1 passed (1)`, `Tests 1 passed (1)`.

If it fails, do not modify `App.vue`, `store/auth.js`, or `store/maintenance.js` to make it pass — those are unmodified production files per this plan's scope. Diagnose the test/config instead (e.g. a jsdom/Node version mismatch, a missing plugin) and report if the fix isn't obvious from the error.

- [x] **Step 5: Verify the Pinia action-stubbing is actually load-bearing**

This is a one-off manual check, not a permanent test — it proves `stubActions: true` is doing real work, not just present as boilerplate.

Temporarily edit `tests/App.smoke.test.js`, changing:
```js
createTestingPinia({ stubActions: true }),
```
to:
```js
createTestingPinia({ stubActions: false }),
```

Run: `npm test`
Expected: the test now fails or produces a `fetch is not defined` / network error — because `App.vue`'s `onMounted` calls the real `maintenance.check()`, which calls the real `api.getMaintenanceStatus()`, which calls `fetch` — undefined/unmockable under plain jsdom with no server to hit.

Revert the edit back to `stubActions: true`:
```bash
git checkout -- tests/App.smoke.test.js
```

Run: `npm test` again.
Expected: back to `Tests 1 passed (1)`.

- [x] **Step 6: Commit**

```bash
git add vitest.config.js tests/App.smoke.test.js package.json
git commit -m "test: add vitest+@vue/test-utils harness, App.vue smoke test"
```

---

## Post-plan note

This closes the "frontend vitest setup" item of the three deferred from `docs/superpowers/plans/2026-09-08-grading-test-suite.md`'s post-plan note. Remaining, explicitly deferred: backend auth/lockout tests, frontend CI workflow (which should follow this plan, now that a frontend test suite exists to actually run) — each its own future brainstorm→spec→plan cycle.

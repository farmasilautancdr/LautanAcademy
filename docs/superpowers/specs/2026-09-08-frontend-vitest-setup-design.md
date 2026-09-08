# Frontend Vitest + @vue/test-utils Setup — Design

**Status:** Approved, not yet planned/implemented.

**Context:** The grading-first backend test suite (`docs/superpowers/specs/2026-09-08-grading-test-suite-design.md`, merged 2026-09-08) explicitly deferred three items: backend auth/lockout tests, frontend `vitest`+`@vue/test-utils`, and a frontend CI workflow. This spec covers the second item only. The other two are separate future spec→plan cycles — sequencing decision: frontend vitest setup first (unlocks frontend test-writing), then backend auth/lockout tests, then frontend CI (which needs a frontend test suite to actually run before it's meaningful).

## Goal

Stand up a working frontend test harness — `vitest` + `@vue/test-utils` installed and configured, one smoke test proving the full stack (Pinia, Vue Router, vue-i18n) can be exercised in a test — mirroring how the backend's Task 2 (`src/app.js` split + one `/health` test) proved out the harness before any real test-writing began. No real component/store test suites are written as part of this — that's deliberately separate future work, same pattern as the backend split.

## Scope

**In scope:**
- Install `vitest`, `@vue/test-utils`, `jsdom`, `@pinia/testing` as dev dependencies in `lautan-academy-frontend/`.
- `vitest.config.js` (jsdom environment, `@vitejs/plugin-vue`).
- One smoke test: mount `App.vue` with a real `i18n` instance, a minimal test-only router, and `createTestingPinia({ stubActions: true })`.
- `"test": "vitest run"` script in `lautan-academy-frontend/package.json`.

**Out of scope:**
- Any real component/store/composable test suite — future work.
- Frontend CI workflow — separate future spec (item 3 of the deferred backlog), needs this harness to exist first.
- Wiring this into the existing frontend pre-push hook (currently build-only, `.husky/pre-push` at repo root) — not requested; revisit once a real test suite exists, otherwise every push pays a needless vitest cost for zero real coverage.
- Backend auth/lockout tests — unrelated repo, separate future spec.

## Design

### Dependencies

Added to `lautan-academy-frontend/package.json` devDependencies:
- `vitest` — test runner, matches the version already used on the backend (`^5.0.0` family) for consistency.
- `@vue/test-utils` — official Vue 3 component mounting/testing library.
- `jsdom` — DOM environment for vitest (Vue components need a DOM to mount into).
- `@pinia/testing` — provides `createTestingPinia`, which creates a real Pinia instance with real state/getters but auto-mocked (no-op) actions by default. Needed because `useMaintenanceStore().check()` fires on `App.vue`'s `onMounted` and calls `fetch` via `api/client.js` — without stubbing, every mount of `App.vue` (now and in any future test) would attempt a real network call.

### Config — `lautan-academy-frontend/vitest.config.js`

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

No `setupFiles` needed: jsdom provides `localStorage` natively (both `store/auth.js` and `src/i18n/index.js` read it at module-init time, which works unmodified under jsdom), and there's no `.env`-equivalent secret-loading step like the backend's `.env.test` — the frontend has no env-gated required config for this smoke test to work around.

### Smoke test — `lautan-academy-frontend/tests/App.smoke.test.js`

Mounts the real `App.vue` against:
- **Real i18n**: import the actual `i18n` instance from `src/i18n/index.js` as-is. It's a plain, side-effect-light module (reads `localStorage.getItem('lautan_lang')`, defaults to `'en'` when absent — which it will be under jsdom). Using the real instance instead of a fake one proves the real plugin wiring works, for free.
- **Minimal test-only router**: `createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div>stub</div>' } }] })`. Deliberately NOT importing the real `src/router/index.js` — that file eagerly imports every view in the app (30+ files), which would make this "smoke test" a full-app integration test, slow and brittle against unrelated view changes. A one-route stub is enough to satisfy `<router-view>` in `App.vue`'s template.
- **`createTestingPinia({ stubActions: true })`**: real `useAuthStore`/`useMaintenanceStore` state shape and getters (so `hasSession` computes correctly off real getter logic), actions replaced with no-op spies (so `maintenance.check()` on mount does nothing instead of calling `fetch`).

Assertion: the component mounts without throwing, and — since `hasSession` is `false` by default (no token in a clean jsdom `localStorage`) — the stub route's content (`<div>stub</div>`) renders via the `v-else` `<router-view>` branch, proving the router/pinia/i18n stack all wired up correctly together.

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

### Script

Add to `lautan-academy-frontend/package.json` `"scripts"`:
```json
"test": "vitest run"
```

No `pretest` (unlike the backend, there's no disposable DB to spin up first).

## Testing

- `npm test` in `lautan-academy-frontend/` → 1 passed test.
- Manually confirm the test actually exercises the mocking (e.g. temporarily remove `stubActions: true` and confirm the test now attempts/fails on a real `fetch` under jsdom, then restore) — proves the stub is load-bearing, not just present.

## Non-goals / explicitly deferred

- Real test coverage of any component, store, or composable.
- Frontend CI workflow (separate spec).
- Adding `npm test` to the existing frontend pre-push hook.

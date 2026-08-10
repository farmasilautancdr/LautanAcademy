# Master Subsystem D — Maintenance Kill-Switch

Date: 2026-08-11
Status: Approved, pending plan

## Problem

Master User / Super Admin build (see `2026-08-10-master-admin-subsystem-a-design.md`) is decomposed into 8 subsystems (A-H). Subsystem D is a global maintenance kill-switch: a way for Master to take the whole app offline for regular staff/managers (e.g. during a risky DB migration or backend redeploy) without needing shell/Railway access, while Master's own session stays usable so they can flip it back off.

## Scope decisions (this session)

**Block scope:** when ON, every route 503s for non-master sessions **except** `/auth/*` (staff/manager login still works — they can authenticate, they just can't do anything after) and `/master/*` (so Master can log in and toggle the switch). `GET /health` and the new public status route also stay open.

**Storage:** new generic `system_settings` key-value table, not a single-purpose `maintenance_mode` table — future subsystems (D onward) can reuse it without a new migration each time. One row for this feature, key `maintenance`.

**Custom message:** Master can type a free-text message when enabling (reason/ETA). Shown to blocked users wrapped in a fixed bilingual template (not a second EN/MS input field — one message, same text both languages, wrapped by static translated chrome).

**Frontend scope:** Vue app only. Vanilla `index.html` (GitHub Pages) is not touched — a maintenance window there just shows as a generic failed-fetch error, acceptable since vanilla is legacy and windows should be short/rare.

**Overlay recovery:** manual "Try Again" button, no background polling. User clicks it, frontend re-checks status; if now off, reloads.

**Out of scope:** scheduled/timed maintenance windows (start/end time), per-role or per-outlet partial maintenance, vanilla frontend changes, any change to `requireScope`/`requireAuth`.

## Design

### Data model

New table:

```sql
create table if not exists system_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
```

This subsystem uses one row: `key = 'maintenance'`, `value = { "enabled": boolean, "message": string }`.

### Backend

New file `routes/maintenance.js`:

```
GET  /maintenance-status                 (public, no auth)
POST /master/maintenance                 (requireAuth, requireMaster)
```

- `GET /maintenance-status` — reads the `maintenance` row (default `{ enabled: false, message: '' }` if no row exists yet), returns `{ enabled, message }`. Used by the frontend on app load and by the overlay's retry button — deliberately outside `requireMaster` since blocked staff need to read it too.
- `POST /master/maintenance` — body `{ enabled: boolean, message: string }`, upserts the row, sets `updated_by` to the master session's username. Also used by the Master Panel tab to both read current state (on mount, via the same public GET) and write new state.

New middleware `checkMaintenance` in `middleware/auth.js`:

```js
export async function checkMaintenance(req, res, next) {
  const { rows } = await pool.query(
    `select value from system_settings where key = 'maintenance'`
  );
  const enabled = rows[0]?.value?.enabled === true;
  if (enabled) {
    return res.status(503).json({
      authorized: false,
      maintenance: true,
      message: rows[0].value.message || '',
    });
  }
  next();
}
```

Queried per-request (no cache), same pattern as the existing `rate_limits` checks — consistent with how this codebase already handles low-traffic, correctness-over-throughput checks. Mounted in `index.js` ahead of every router except `/auth`, `/master`, `/health`, and the new `/maintenance-status`:

```js
app.use('/quiz', checkMaintenance, quizRouter);
app.use('/data', checkMaintenance, dataRouter);
app.use('/content', checkMaintenance, contentRouter);
app.use('/reports', checkMaintenance, reportsRouter);
app.use('/staff-roster-manage', checkMaintenance, staffRouter);
app.use('/resources', checkMaintenance, resourcesRouter);
app.use('/questions', checkMaintenance, questionsRouter);
// /auth, /master/purge, /master/maintenance, /health, /maintenance-status: no checkMaintenance
```

`master/purge` (Subsystem C) and the new `master/maintenance` route both stay exempt since they're already gated behind `requireMaster` — Master's own actions are never blocked by this switch.

### Frontend

- `stores/maintenance.js` (Pinia) — `{ active: boolean, message: string }`, plus a `check()` action that calls the new `GET /maintenance-status` and sets state.
- `App.vue` — calls `maintenanceStore.check()` once on mount, so a user opening the app while maintenance is already on sees the block immediately, not only after their first failed action.
- `api/client.js`'s `request()` — on a response where `res.status === 503 && data.maintenance === true`, sets `maintenanceStore.active = true` / `message` (via a direct store import, matching how other cross-cutting concerns are handled) instead of throwing the generic `Error(data.error)` path. Non-maintenance errors are unaffected.
- `MaintenanceOverlay.vue` — new component, mounted once in `App.vue` alongside the router view, `v-if="maintenanceStore.active"`. Full-screen fixed overlay above everything (including the Master panel drawer is unaffected since Master's session never triggers `active`). Shows fixed bilingual wrapper text + Master's free-text message, "Try Again" button that calls `maintenanceStore.check()` again and reloads the page if `active` comes back `false`.
- `MasterMaintenance.vue` — new tab component, wired into `MasterPanel.vue`'s existing `maintenanceMode` tab (currently disabled/"Coming Soon", id already reserved in `TABS`; add to `ENABLED_TABS`). On mount, calls `GET /maintenance-status` to show current state. Toggle switch (on/off) + message textarea (enabled only when toggling on) + Save button, calls `POST /master/maintenance` with `masterAuth.token`. Shows last-updated-by/when after a successful save.
- `api/client.js` additions: `getMaintenanceStatus()` (no auth), `setMaintenanceStatus(enabled, message, masterToken)`.
- Bilingual EN/MS strings under `masterPanel.maintenanceMode.*` (tab UI) and a new top-level `maintenanceOverlay.*` namespace (the block screen itself, since it's not inside the Master Panel drawer).

## Error handling

- `GET /maintenance-status` with no row yet in `system_settings` → treated as `{ enabled: false, message: '' }`, not an error (first-ever call before Master has ever touched this feature).
- `POST /master/maintenance` with missing/invalid `enabled` → 400.
- `checkMaintenance` middleware itself failing (DB error) → fails open (calls `next()`, logs the error) rather than accidentally locking out the whole app if `system_settings` is briefly unreachable — availability of the check itself must not become a second outage vector.
- `requireMaster` failure on `POST /master/maintenance` → 403, existing middleware behavior, unchanged.

## Testing / verification plan

- curl: `GET /maintenance-status` before any row exists (defaults correctly), `POST /master/maintenance` toggling on with a message (non-master 403s, master 200s), `GET /maintenance-status` reflects the new state, a blocked route (e.g. `GET /data/scoped-data` with a valid staff token) now 503s with `{ maintenance: true, message }`, `/auth/staff-login` and `/master/purge/*` still work while ON, toggle back off, confirm the same blocked route 200s again.
- Frontend: `npm run build` clean after each task. Live browser click-through: toggle on via Master Panel, confirm a logged-in staff session immediately shows the overlay on next action, confirm login screen itself still works while ON, confirm Master Panel itself stays reachable and usable while ON, toggle off, confirm "Try Again" clears the overlay, EN + MS text check on both the overlay and the Master Panel tab.

## Out-of-scope confirmation

Scheduled/timed windows, per-role or per-outlet partial maintenance, vanilla `index.html` changes, and any change to `requireScope`/`requireAuth` are explicitly not part of this subsystem. Subsystems E-H remain untouched, each gets its own brainstorm/spec/plan cycle in the agreed build order.

# Master Subsystem B — Supervisor PIN Reset

Date: 2026-08-11
Status: Approved, pending plan

## Problem

Master User / Super Admin build (see `2026-08-10-master-admin-subsystem-a-design.md`) is decomposed into 8 subsystems (A-H). Subsystem B was originally scoped as "PIN reset override + master bypass on existing permission checks" — this session narrowed that scope (see Scope decisions below).

Current PIN recovery paths, by role:
- Staff (`staff_roster.pin_hash`): recoverable by that outlet's own Outlet/Warehouse Manager via `POST /staff/reset-pin`.
- Outlet/Warehouse/Area Manager shared PIN (`manager_pins`): recoverable by Supervisor via `POST /auth/rotate-master-pin` (`requireScope('supervisor')`).
- Outlet/Warehouse/Area Manager personal password (`manager_credentials`): self-service via `POST /auth/manager-register`, proven by today's shared master PIN.
- **Supervisor's own shared PIN (`manager_pins` where `role='supervisor'`): no recovery path exists.** `rotate-master-pin` and `manager-register` both explicitly exclude `supervisor` from `validRoles`. If the Supervisor PIN is lost, nobody in the existing system can reset it.

This is the one real gap. Subsystem B closes it.

## Scope decisions (this session)

- **In scope:** Master resets the Supervisor role's shared PIN only.
- **Out of scope:** staff PIN reset bypass, Master resetting Outlet/Warehouse/Area Manager's `manager_pins` (already recoverable via Supervisor), `manager_credentials` force-clear, Master's own `master_users` account reset, any change to `requireScope` or a general "Master bypasses every scope check" mechanism. If a future subsystem needs broader bypass, it gets its own brainstorm/spec cycle — not bundled here.

## Design

### Backend

New route in `routes/auth.js`:

```
POST /auth/master-reset-supervisor-pin
Gate: requireMaster only (no requireScope — Master's own auth is sufficient proof)
Body: { newPin: string }
```

Validation: `newPin.length >= 6` (matches `rotate-master-pin`'s existing rule for consistency — Supervisor's PIN is freeform, not the 4-digit-numeric rule staff PINs use).

Rate limiting: reuse the existing `rate_limits` table (`isLockedOut` / `recordFailure` / `clearFailures` from `middleware/rateLimit.js`), same 5-fail/5-min pattern used everywhere else in this codebase. Counter key: `` `master_reset_supervisor_${req.session.scopeKey}` `` (`scopeKey` is the master username from the JWT). A failure here is a validation failure (bad input), not a wrong-guess — counted anyway so a leaked/compromised master token can't be hammered against this endpoint indefinitely.

On success: bcrypt-hash the new PIN, then:
```sql
insert into manager_pins (role, pin_hash) values ('supervisor', $1)
on conflict (role) do update set pin_hash = excluded.pin_hash
```
Identical upsert shape to `rotate-master-pin`. Write-only, same as the existing endpoint — no "current value" is ever returned or needed.

Response: `{ status: 'ok' }` on success, `{ status: 'error', error }` on validation/lockout failure.

### Frontend

- `MasterPanel.vue`'s `pinReset` tab (currently a disabled "Coming Soon" row) becomes clickable and opens a new view/panel for this one action.
- Single field: new Supervisor PIN, using the existing `PasswordField.vue` component (already has the show/hide toggle — no new component needed), submit button, inline success/error message.
- Auth: `masterAuth` store's existing token (`lautan_master_token`), sent as `Authorization: Bearer`.
- Bilingual EN/MS strings added to `src/i18n/locales/{en,ms}.json` under a `masterPanel.pinReset.*` (or similar) namespace, following the existing flat-namespace-per-view convention.

## Error handling

- Invalid/missing `newPin` or too short → 400, clear message, does not touch `manager_pins`.
- Lockout after 5 failures in 5 min → 429, same message shape as every other lockout in this codebase.
- `requireMaster` failure (expired/missing/non-master token) → 403, handled by existing middleware, no new code.

## Testing / verification plan

- curl: valid reset (confirm `manager_pins` row updated, bcrypt hash changes), too-short PIN (400, row untouched), 5x rapid calls (429 on 6th), non-master token against this route (403).
- End-to-end: Supervisor logs in with old PIN (fails after reset), logs in with new PIN (succeeds) — proves the write actually lands where `manager-login`'s supervisor path reads from.
- Frontend: `npm run build` clean, live browser click-through (Master login → panel → PIN Reset tab → submit → success message, EN + MS), confirm toggle show/hide works on the new field.

## Out-of-scope confirmation

Nothing else in the existing permission-check surface (`requireScope`, `requireAuth`, any route) changes as part of this subsystem. Subsystems C-H remain untouched, each gets its own brainstorm/spec/plan cycle in the agreed build order.

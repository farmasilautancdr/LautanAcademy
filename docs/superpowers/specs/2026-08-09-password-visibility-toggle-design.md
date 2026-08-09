# Password/PIN visibility toggle — Manager, Area Manager, Supervisor

Date: 2026-08-09
Status: Approved design, implementing now

## Problem

Manager, Area Manager, and Supervisor PIN/password fields are all
`type="password"` with no way to check what was typed before submitting —
easy to fat-finger a PIN or new password blind, especially the centered
6-char PIN fields.

## Scope

All password/PIN inputs where Manager, Area Manager, or Supervisor enter
their own credential — 7 files, 10 input instances:

- `ManagerLoginView.vue` — Manager PIN
- `AreaManagerLoginView.vue` — Manager PIN
- `SupervisorLoginView.vue` — Supervisor PIN
- `ManagerRegisterView.vue` — Master PIN, New Password, Confirm Password
- `AreaManagerRegisterView.vue` — Master PIN, New Password, Confirm Password
- `SupervisorManagerAccessView.vue` — new master PIN + confirm, ×3 roles
  (`v-for`)

Excluded: `ManageStaffPanel.vue` staff PIN reset — manager entering a
*staff member's* PIN, not their own credential, out of stated scope.

## Design

One new component, `src/components/PasswordField.vue`: wraps `<input>`,
owns a local `showPassword` ref, toggles `type` between `password`/`text`,
renders an eye/eye-slash SVG button absolutely-positioned at the input's
right edge. `v-model` passthrough via `modelValue`/`update:modelValue`.
Props: `id`, `placeholder`, `autofocus`, `inputClass` (each call site keeps
its existing Tailwind classes — centered/large-tracking PIN style vs.
left-aligned password style are not unified, just get the toggle added).

Centered PIN fields (`text-center tracking-[0.3em]`) get symmetric
`pl-10 pr-10` added via `inputClass` so the PIN stays visually centered
once the button occupies the right edge. Left-aligned password fields get
`pr-10` only.

Button: `type="button"` (won't submit the form), `tabindex="-1"` (skip tab
order), `aria-label` toggles "Show password"/"Hide password". Icon color
`text-slate` default, `hover:text-aqua` — matches existing muted/link
convention (`tailwind.config.js`).

`SupervisorManagerAccessView.vue`'s `v-for` gets independent show/hide
state per row for free — each `v-for` component instance owns its own
local ref.

## Non-goals

- No backend/auth changes — pure frontend display toggle.
- No visual restructuring beyond adding the button and matching padding.
- Not applied to `ManageStaffPanel.vue` (out of scope, see above).

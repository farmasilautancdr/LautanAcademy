# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are frontline staff at Farmasi Lautan, a Malaysian retail
pharmacy chain (50+ retail outlets across regions R1-R9, plus warehouse
locations). They log in on a shop-floor device (shared or personal
smartphone) during or between work, work primarily in Bahasa Malaysia, and
complete short quiz- and video-based training modules in between serving
customers.

A second tier of users are the chain's own management hierarchy, who use
the same app for oversight rather than training-taking: Outlet Manager
(single outlet), Warehouse Manager (single warehouse location), Area
Manager (a region's outlets, R1-R9), and Supervisor (company-wide). A
top-level Master/Super Admin role exists for system administration
(outlet/area management, staff purge, session control, backups) rather
than day-to-day training oversight.

Among frontline staff, a subset are registered pharmacists who, in
addition to the training every staff member does, must also complete
pharmacist-specific clinical courses (e.g. minor ailment management, blood
test result interpretation) as part of their professional obligations —
these are more demanding than the general staff training load.

## Product Purpose

Lautan Academy (formerly PharmAcademy) is the chain's staff training and
compliance-tracking platform. It replaced a semi-manual Google Apps
Script + Sheets system (migration to Vue/Node/Postgres completed
2026-08-11) that could not scale to the chain's real staffing/outlet
structure or support the auditable, role-scoped tracking the business
actually needs.

Training here is **mandatory, compliance-driven, not voluntary
upskilling** — staff are expected to hit a fixed 60-hour/calendar-year
training target, and pharmacist staff carry additional mandatory clinical
courses on top of that. Success for the product means: every staff member
can be shown, at any time, exactly how much of their required training
they've completed and what remains; managers at every tier can see who on
their team is behind; and the record of who completed what, when, and with
what score is real and auditable — not self-reported.

## Positioning

What a generic off-the-shelf LMS (Coursera for Business, TalentLMS, and
similar) cannot truthfully replicate: this system's access and reporting
structure **is** Farmasi Lautan's real organizational chart, not a
configurable abstraction bolted on top of one. Outlets, regions (R1-R9),
warehouse locations, and the Outlet/Warehouse/Area Manager/Supervisor
hierarchy are the actual data model staff and manager accounts are scoped
by — a manager only ever sees their own outlet's or region's real staff
and real results because that's how the company is actually organized,
not because someone configured a generic LMS's permission tree to
approximate it.

## Operating Context

Used on the retail/warehouse floor, interspersed with real customer-facing
work — staff get interrupted mid-task constantly (a documented product
constraint: the app's own anti-fraud "leaving mid-quiz" handling
deliberately does not treat simple app-backgrounding as abandonment,
specifically because staff getting called away mid-quiz is routine, not
exceptional). Login is by outlet + name + a short numeric passcode (no
staff email addresses), not the manager-tier's separate PIN/password
login.

Bilingual by requirement: all staff-facing UI and quiz content ships in
both English and Bahasa Malaysia, kept in sync as a hard rule, since real
staff communication at this chain happens primarily in Bahasa Malaysia.

## Capabilities and Constraints

- Stack: Vue 3 + Vite + Tailwind (frontend, PWA), Node.js/Express +
  Postgres on Supabase (backend), JWT-based sessions, bcrypt-hashed
  passcodes/PINs.
- Real production system for a real business — not a demo/toy project.
  Verification for changes is manual browser click-through + build checks;
  no automated test suite exists yet (a known, deferred gap).
- Quiz/training content types: Module (Standard) Quiz (fixed question
  bank per topic), AI Practice (ephemeral AI-generated practice quizzes,
  explicitly not assessed/tracked toward compliance), and Video Training
  (in development as of this record — watch a video, then a timed quiz;
  contributes toward the 60hr target).
- No configurable/tenant-specific behavior — this is a single-tenant
  internal system built for this one chain's real structure, not a
  product sold to other businesses.
- Undecided/not yet built: the pharmacist-specific mandatory-course
  tracking and the `is_pharmacist` staff tag it depends on (brainstormed,
  not yet spec'd in full); a formalized accessibility standard has not
  been set — no known specific device/connectivity constraint has been
  raised as of this record.

## Brand Commitments

Name: **Lautan Academy** ("lautan" = "ocean" in Bahasa Malaysia).
Logo mark: two hands forming a heart, one side cool blue, the other warm
orange/red — this is the literal source of the app's color tokens (not an
arbitrary palette choice): deep blue (`deepsea`), primary blue (`aqua`),
light blue fills (`aqualight`, `seafoam`), and a sparingly-used warm
orange/red accent (`coral`) for emphasis (streaks, "resume" actions, warm
CTAs). Display typeface: Space Grotesk; body: Inter.

## Evidence on Hand

Real production data: real staff rosters, real outlets/regions, real quiz
results and training history going back to the pre-migration GAS system.
No fabricated testimonials, case studies, or benchmarks exist or should be
introduced — any example content in future design work must be marked
clearly as placeholder, not presented as real chain data.

## Product Principles

1. **The org chart is the data model, not a config layer on top of one.**
   Every access/visibility decision should map to a real
   outlet/region/role relationship in the business, not an invented
   generic permission concept.
2. **Compliance must be real, not self-reported.** Training completion,
   scores, and hours are always server-computed from actual attempt
   records — never a value the client asserts and the server trusts.
3. **Design for constant interruption, not focused study time.** Staff
   use this between real customer-facing tasks; flows should tolerate
   getting abandoned and resumed rather than assuming an uninterrupted
   session.
4. **Bilingual is not an afterthought.** EN/MS parity is a hard
   requirement on every user-facing string, not a nice-to-have localized
   later.
5. **Ship what's real, not what looks complete.** Existing product
   conventions explicitly avoid UI for data that doesn't exist yet
   (no fabricated "upcoming schedule," no fake completion states) —
   honesty about what the system actually knows outranks a more
   "finished-looking" mockup.

## Accessibility & Inclusion

No specific accessibility standard or device/connectivity constraint has
been established as a requirement — assume standard modern smartphone
usage with typical mobile connectivity until a real need is identified.

# QA and Test Coverage

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index.

## Automated tests

### Unit / component tests
**None exist.** Confirmed by grep across the entire repository: no `*.test.ts(x)`, no `*.spec.ts(x)` outside the `tests/e2e/` directory, no `__tests__` directories, no Jest or Vitest configuration anywhere.

### End-to-end tests
**A real, substantial Playwright suite exists**, at `tests/e2e/`, with its own `playwright.config.ts` at the repository root:

| File | Lines | Apparent purpose (from filename/structure) |
|---|---|---|
| `auth-roles.spec.ts` | 302 | Role-based authentication/authorization coverage |
| `full-uat.spec.ts` | 245 | Full user-acceptance-testing flows |
| `module-uat.spec.ts` | 548 | Per-module user-acceptance testing |
| `supabase-rls.spec.ts` | 404 | Direct Row-Level Security verification |

**~1,499 lines total.** Configuration targets `http://127.0.0.1:4176` by default (overridable via `E2E_BASE_URL`), runs headless Chrome, single worker, no retries, 45-second timeout.

**No CI workflow found** — no `.github/` directory with workflow files anywhere in the repository that would run this suite automatically on push or on a schedule. The suite exists and appears to genuinely target exactly the kind of role/RLS questions raised throughout this documentation set, but:
- Whether it has ever been run successfully against a live or local Supabase instance is **unconfirmed**.
- Whether it currently passes against the **current** state of the database (given how many migrations are drafted-but-unapplied, and how many RLS policies have been redefined multiple times) is **unknown** and should not be assumed either way.

**Recommendation**: running this suite once, locally, against a disposable Supabase instance would resolve a large number of the "cannot verify statically" items flagged throughout this documentation set — particularly in `SECURITY_AUDIT.md` and `ROLE_PERMISSION_MATRIX.md`. This was not done as part of this discovery pass (explicitly out of scope — read-only, no execution).

## TypeScript diagnostics

One known, pre-existing TypeScript error exists: `src/routes/goals.tsx` around line 153, caused by the project's own `exactOptionalPropertyTypes: true` strictness setting interacting with an optional-property type mismatch. This has been confirmed present, unrelated to any specific feature, and harmless (does not affect runtime behavior) across every type-check performed throughout this entire session's prior work. No other TypeScript errors were found during this documentation pass's own type-checks of the current codebase state.

## Build and lint status

Not independently re-verified as part of this specific documentation pass (this pass was read-only research; a full build/lint run was not re-executed here). Prior sessions' work on this codebase consistently found no *new* lint errors introduced by changes, with pre-existing CRLF/Prettier formatting noise present across most files (a long-standing, cosmetic, non-blocking issue, not something this documentation pass re-counted).

## Validation coverage

Confirmed genuinely implemented, not just promised:
- Employee creation: email domain check, employee code format, duplicate email/code (client pre-check + server unique-constraint catch).
- CRM lead import: first-name length validation (client pre-flight + server-side per-row exception handling, so one bad row never aborts an entire batch), Hot/Warm/Cold value validation, phone/email duplicate and match detection.
- Expense/leave/goal forms: client-side numeric-range and required-field checks (react-hook-form + zod schemas where a dedicated schema file exists, e.g. onboarding).
- Database-level validation (not just frontend): several real `check` constraints found and relied upon throughout this session's own work (`crm_leads_first_name_check`, `announcements_target_shape_check`), plus trigger-enforced business rules (deal stage forcing probability/`closed_at`, leave rejection-cannot-become-approval).

## Role-based test coverage

The Playwright `auth-roles.spec.ts` and `supabase-rls.spec.ts` files appear designed specifically for this, but their actual current pass/fail status against this codebase's live database is unconfirmed (see above). The **CRM module's** role boundaries were separately, directly verified this session by hand-written SQL execution against a disposable local Postgres instance (not the Playwright suite) — see `SECURITY_AUDIT.md` for exactly what was proven that way. No other module's role boundaries were verified by actual execution during this documentation effort; all other role-permission claims in `ROLE_PERMISSION_MATRIX.md` are code-level findings only.

## Important regression risks

- **Any work touching the RLS policies or RPCs flagged throughout this documentation set as "redefined multiple times, live status unclear"** carries a real risk of accidentally reverting or duplicating a fix, precisely because the repository alone cannot definitively answer "which version is live" for files older than the "written to disk only" convention.
- **The Beta destructive-reset tool** (see `SECURITY_AUDIT.md`, C1) is the single highest-consequence action in the entire system if its authorization boundary is ever weaker than assumed — any future change near that code path warrants extra care and, ideally, a dedicated test before and after.
- **Payroll's point-in-time salary snapshot design** means a bug in `startRun()`'s snapshot logic could silently misattribute which salary structure applies to a given payroll period, and because it never re-reads the live structure, such a bug could persist invisibly across many pay periods before being noticed.

## What was NOT tested as part of this documentation pass

Everything in this entire discovery effort was **read-only static code research**, except for the few items explicitly marked in `SECURITY_AUDIT.md` as "verified by actual execution" (CRM-specific, performed in an **earlier** session, not during this documentation pass itself). No code was run, no database was queried, no migration was applied, and the Playwright suite was not executed, as part of producing this set of 11 documents.

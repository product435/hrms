# Technical Architecture

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index.

## Frameworks and libraries (exact versions from `package.json`)

- **Framework**: React 19.2.0 + TanStack Start 1.169.4 (SSR meta-framework) + TanStack Router 1.170.46 + TanStack Query 5.101.1
- **Build**: Vite 8.2.0, Nitro 3.0.260603-beta for server/preview
- **Styling**: Tailwind CSS 4.2.1 (via `@tailwindcss/vite`), `tailwind-merge`, `class-variance-authority`
- **UI primitives**: Radix UI (20+ individual `@radix-ui/react-*` packages) **and** `@heroui/react` 3.2.6 — two component libraries coexist in this codebase.
- **Forms**: `react-hook-form` 7.71.2 + `@hookform/resolvers` 5.2.2 + `zod` 3.24.2 — real schema-validated forms, confirmed by the presence of dedicated schema files (e.g. `src/lib/onboarding-schema.ts`), not manual validation only.
- **Database client**: `@supabase/supabase-js` 2.112.3, `@supabase/ssr` 0.12.4 — confirms genuine SSR-aware Supabase integration, not client-only.
- **Rich text**: `@tiptap/*` 3.31.4 (DWR and CRM rich-text fields).
- **Spreadsheets/export**: `xlsx` 0.18.5, `papaparse` 5.7.1 (CRM import), `pdf-lib` 1.17.1 (payslip generation).
- **Charts**: `recharts` 2.15.4.
- **Telephony**: `@exotel-npm-dev/exotel-ip-calling-crm-websdk` 2.0.0 (browser calling SDK).
- **Sanitization**: `isomorphic-dompurify` 3.19.0, with a deliberate `overrides` pin on `dompurify@^3.4.17` (a security-patch override).
- **Linting/formatting**: ESLint 9.32.0 + typescript-eslint 8.56.1 + Prettier 3.7.3.
- **Dev platform**: `@lovable.dev/vite-tanstack-config` 2.15.0 — the project is scaffolded/maintained through Lovable's tooling (confirmed, matches the project's own `AGENTS.md`).
- **TypeScript**: 5.8.3. `tsconfig.json` is strict: `strict: true` plus `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and **`exactOptionalPropertyTypes: true`**. The last flag is the cause of one known, pre-existing, harmless TypeScript error at `src/routes/goals.tsx` around line 153 — confirmed present across every type-check this entire session, unrelated to any of the work described in this documentation, not a new or urgent issue.

## Application entry points and route architecture

- File-based routing via TanStack Router, one file per route under `src/routes/`. 38 route files, covering both business modules and auth/utility pages (sign-in/up, forgot/reset-password, unauthorized).
- Route guarding is centralized in `src/lib/auth-guard.ts` (see Authentication Flow below) rather than scattered per-route checks.

## Component architecture

- A mix of hand-built components (`src/components/common/`, module-specific folders like `src/components/crm/`) and the two UI primitive libraries (Radix, HeroUI).
- Shared common components confirmed in use across modules: `DataTable`, `FilterBar`, `StatusBadge`, `IconAction`, `SectionCard`, `StatCard`, `EmptyState`/`ErrorState`/`CardsSkeleton`.

## Hooks and state management

- TanStack Query for all server-state (fetching, caching, mutation, invalidation) — no separate global state library (Redux, Zustand) was found in use.
- `src/hooks/useSession.tsx` — a React Context wrapping `authService`, exposing `user`, `role`, `isAuthenticated`, `isLoading`, `signOut()`, `can(roles[])`. `signOut()` explicitly cancels and clears the entire TanStack Query cache, preventing stale cross-user data from leaking into the next session on the same browser.
- `src/hooks/usePermissions.ts` — derives role-boolean convenience flags (`isSuperAdmin`, `isGeneralManager`, `isHr`, `isDeptHead`, `isTeamLead`, `isLead`, `isEmployee`) and a few composed capability flags (`canManageTeam`, `canDecideApprovals`) from the session role — confirmed, from this session's own direct work, to be a thin convenience layer only; the actual enforcement is always the database policy/function, never this hook alone.

## Service layer

- One service file per module under `src/services/` (22 files total), each wrapping Supabase table queries and RPC calls, returning typed results to the route components.
- **Consistent, but duplicated, error-handling pattern**: a small `fail(error)` helper — `if (error) throw new Error(error.message || "<fallback>")` — is defined independently in at least 4 service files (`crmService.ts`, `kraService.ts`, `onboardingService.ts`, `roleService.ts`) rather than imported from one shared module. Functionally consistent, but a real duplication worth consolidating.
- Several services (e.g. `employeeService.ts`, `insightsService.ts`) fall back to static fixture data when `isSupabaseConfigured` is false — an offline/local-dev convenience, not a production behavior.

## Authentication flow

- Supabase Auth (JWT-based) handles signup/login/session.
- **Isomorphic session resolution, confirmed genuinely dual-path, not client-only**: `getIsomorphicSession()` in `src/lib/auth-guard.ts` uses `createIsomorphicFn()` — on the **server** (a fresh SSR request, e.g. hard refresh) it builds a request-scoped Supabase client from incoming cookies (`src/lib/supabase-server`) and calls `client.auth.getUser()`; on the **client** it uses the existing `authService.initialize()` browser flow. Both converge on the same `sessionForUser()` lookup, so role/profile resolution is identical regardless of entry path.
- **Route guarding**: `requireAuth()` redirects to `/sign-in` (preserving the original path as a redirect parameter) if there's no session. `requireAuthForPath(pathname)` additionally checks a per-route role allowlist (`rolesForPath()`) and, for CRM routes specifically, `requiresCrmAccess(pathname)` against `session.user.crm?.hasAccess`.
- **Onboarding gate, enforced at the route-guard level on every protected route**: if the employee's status is `pending_approval` or `profile_changes_requested`, `enforceOnboardingGate()` force-redirects to `/complete-profile`; `rejected` redirects to `/profile-status`.
- **A distinct "employment blocked" state** exists (`isEmploymentAccessError`/`hasEmploymentBlockNotice`/`consumeEmploymentBlockNotice`), redirecting to `/sign-in?blocked=employment` — implies a separate access-denial path (likely terminated/suspended employment), not independently confirmed in this pass.
- **Signup trigger** (`handle_new_user()`, confirmed by direct read of its latest version, `20260926120000_auth_security.sql:111-249`): on signup, first tries to link the new auth user to a pre-existing, HR-created `employees` row by matching email; if none exists, creates a new `employees` row with `employment_status = 'pending_approval'`. Both paths seed an `onboarding_submissions` row. See `BUSINESS_WORKFLOWS.md` for the full diagram.
- **Admin-initiated password set**: separate from self-service reset — the `admin-set-employee-password` edge function lets a Super Admin directly set (or create, if none exists) another employee's Supabase Auth password.

## Error handling and validation patterns

- Service-layer: the `fail()` pattern described above, turning a Supabase error into a thrown JS `Error` with a safe fallback message.
- Form-level: `react-hook-form` + `zod` schemas, confirmed real (not just present in `package.json`) by the existence of dedicated schema files.

## File upload/download handling

- Uploads validated client-side (type + size) before reaching storage; the `documents` private bucket is the only confirmed storage location, used by both the Documents module and Payroll's payslip PDFs.
- Downloads always go through short-lived (120-second) signed URLs, never a permanent public link — confirmed as a deliberate security pattern in both Documents and Payroll.

## Background jobs and scheduled tasks

Not independently confirmed in this pass — no pg_cron or similar scheduled-job definitions were specifically searched for across all 117 migrations; this should be treated as unverified rather than "none exist."

## Notifications and messaging

- Purely in-app, confirmed by grep across every service and edge function for any email/push-sending pattern (Resend, SendGrid, nodemailer, web-push) — zero matches found anywhere in the codebase. Announcements and Notifications are both in-app only.
- CRM's WhatsApp integration is the one genuine external-messaging channel, via the Meta WhatsApp Business Cloud API (send + inbound webhook).

## Third-party integrations

| Integration | Purpose | Edge function / file |
|---|---|---|
| Google Gemini | CRM Sales Forecasting AI insights | `forecast-ai-insights` |
| OpenAI (GPT) | Daily Work Report narrative analysis | `analyze-dwr` |
| WhatsApp Business Cloud API (Meta) | CRM customer messaging | `whatsapp-send`, `whatsapp-webhook` |
| Exotel | Browser-based calling for CRM | `exotel-call-token`, `@exotel-npm-dev/exotel-ip-calling-crm-websdk` |

## Environment variables and configuration requirements

Variable **names** only — no values inspected or disclosed:
- Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or equivalent `VITE_`-prefixed client-side names), `SUPABASE_SERVICE_ROLE_KEY` for server/edge-function contexts.
- `GEMINI_API_KEY`, optional `GEMINI_MODEL` (edge function secrets, per `forecast-ai-insights`'s own header comment — confirmed this session the function correctly returns a 503 "not configured" response rather than fabricating a result if the key is absent).
- OpenAI key for `analyze-dwr` (exact variable name not independently confirmed in this pass).
- Exotel and WhatsApp provider credentials for their respective edge functions (exact variable names not independently confirmed in this pass).

## Testing (summary — full detail in `QA_AND_TEST_COVERAGE.md`)

- No unit/component tests exist anywhere in the repository.
- A real, substantial Playwright end-to-end suite exists at `tests/e2e/` (4 spec files, ~1,500 lines total, named for role-based auth, full UAT, per-module UAT, and direct RLS verification), with its own `playwright.config.ts` at the repository root — but **no CI workflow** (`.github/` directory with workflow files) was found that would run it automatically, and whether it has ever been successfully run against a live instance is unconfirmed.

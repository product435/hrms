# Project Overview

> Part of the As-Built Discovery documentation set. See `MASTER_AS_BUILT_PRD.md` for the full index.

## What this project is

This is **JeeVijay HRMS** — a multi-module Human Resources Management System with an attached Sales CRM, built for a single organization (multi-org schema exists, but the app is used by one company in practice). It covers the employee lifecycle from signup through exit, day-to-day workforce operations (attendance, leave, daily work reports, goals/KPIs, performance reviews), back-office operations (payroll, assets, expenses, helpdesk, documents, recruitment), and a separate Sales CRM for lead-to-deal pipeline management.

## Business problem it solves

Before a system like this, an HR/operations team would track attendance, leave, performance, payroll, and sales pipeline across spreadsheets, paper forms, and ad hoc tools — with no single source of truth, no audit trail, and no role-based access control. This HRMS centralizes all of that into one application with:
- A real database (Postgres via Supabase) with row-level security enforcing who can see and change what.
- One login, one employee record, one source of truth across every module.
- Built-in approval chains (leave, expenses, onboarding, KRA reviews) instead of email/paper sign-off.
- A Sales CRM sharing the same employee/role model, so sales reporting lines match the org chart.

## Target users and departments

Everyone in the organization uses it, with different capabilities by role:
- **Employees** — self-service: check in/out, apply for leave, submit daily work reports, view their own payslips/documents/goals.
- **Team Leads / Department Heads** — the above, plus visibility and approval authority over their own team or department (attendance corrections, leave decisions, DWR review, expense/helpdesk approval for their people).
- **HR** — organization-wide employee data management, onboarding approval, payroll runs, most back-office modules. Notably, HR has **no CRM access by default**.
- **General Manager** — a newer role added specifically for cross-department oversight (organization-wide *read* access to work reports, attendance, leave, goals, projects, KPIs), deliberately kept **without** org-wide write/approval authority unless they are also personally a sales-department member or a direct manager.
- **Super Admin** — full access everywhere, the only role that can change other people's roles, run destructive maintenance tools, and manage system settings.
- **Sales team members** (any role, gated by department membership, not by HR role) — use the CRM module for leads/deals/accounts/contacts/activities.

## Main business workflows

- **Hire-to-active**: a candidate signs up (or is pre-created by HR) → an `onboarding_submissions` record is created → HR reviews and approves/requests changes → the employee becomes `active` and gains full self-service access.
- **Daily attendance**: check in/check out, computed into present/late/half-day/WFH status, with a correction-request workflow for disputes.
- **Daily Work Report (DWR)**: each employee submits what they worked on that day; their lead reviews and rates it.
- **Leave**: apply → lead/HR/admin decides → leave ledger (balance) updates automatically.
- **Goals / KRA / KPI**: goals are set and tracked; KRA templates define what's measured; KPI scores are computed from real attendance/DWR/task data plus manual entries, feeding into a performance index.
- **Performance review cycles**: self-rating + manager-rating per cycle, informed by (but not automatically driven by) KRA/KPI data.
- **Payroll**: monthly run generated from each employee's effective salary structure, approved, then turned into real downloadable PDF payslips.
- **CRM lead-to-deal**: import or manually create a lead → qualify → convert to an account/contact/deal → move the deal through pipeline stages → won/lost.
- **Operational support**: asset requests/assignment, expense claims, helpdesk tickets, document storage, recruitment pipeline — all with their own lightweight approval/status chains.

## Core capabilities (at a glance)

Employee directory & lifecycle · Attendance & shifts · Leave & balances · Daily Work Reports · Goals, KRA & KPI scoring · Performance reviews · Payroll & payslips · Assets · Expenses · Helpdesk · Document storage · Recruitment · Projects & tasks · Sales CRM (Leads/Deals/Accounts/Contacts/Activities/Forecasting) · Announcements · Notifications · Audit log · Organization-wide dashboards (Insights, Reports, Org Overview).

## Technology stack and architecture (summary — full detail in `TECHNICAL_ARCHITECTURE.md`)

- **Frontend**: React 19 + TanStack Start/Router/Query, TypeScript (strict mode), Tailwind CSS 4, a mix of Radix UI and HeroUI components, react-hook-form + zod for forms.
- **Backend**: Supabase (Postgres + Row-Level Security + Postgres functions/RPCs + 6 Edge Functions), accessed directly from the frontend via the Supabase JS client — there is no separate custom backend server beyond Supabase itself and the edge functions.
- **Database**: 117 migration files, almost entirely hand-written SQL (tables, RLS policies, triggers, and business-logic functions all live in Postgres, not just in the application layer).
- **Integrations**: Google Gemini (CRM forecast AI insights), OpenAI (DWR narrative analysis), WhatsApp Business Cloud API, Exotel (browser-based calling).

## Authentication and authorization approach

Supabase Auth handles signup/login/session (JWT-based). A Postgres trigger (`handle_new_user()`) automatically creates or links an `employees` row on signup. Authorization is enforced in **two layers that are each checked and should each be verified independently**: frontend route guards and UI gating (convenience, not security), and Postgres Row-Level Security policies plus security-definer functions (the actual enforcement). This documentation set treats a frontend role check and a database RLS policy as two separate facts, never assuming one implies the other.

## External integrations and third-party services

Google Gemini, OpenAI, WhatsApp Business Cloud API, Exotel calling — see `TECHNICAL_ARCHITECTURE.md` and `SECURITY_AUDIT.md` for configuration requirements and known limitations of each.

## Current development and deployment status

This project is actively under development, connected to Lovable (per the project's own `AGENTS.md`), with git history showing continuous feature work. A real but currently-unused Playwright end-to-end test suite exists (`tests/e2e/`, ~1,500 lines across 4 spec files) with no CI workflow wiring it to run automatically. **A recurring, important pattern in this codebase**: many migration files are drafted and committed to the repository but deliberately **not yet applied** to the live database — each such file carries an explicit header comment ("This file is written to disk only. It is NOT executed...") stating so. This convention is real and consistently followed, but only from roughly the last few days of this project's migration history onward — for older files, the *absence* of that marker is not strong evidence either way. Every document in this set states explicitly, per fact, whether something is "confirmed in code," "confirmed applied to the live database," or "cannot be verified without a live database check" — never conflating the three.

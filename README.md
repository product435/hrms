# Kinetix HR Suite

Build a modern, professional and production-style HRMS web application called Kinetix using React + Vite + TypeScript.

This is a frontend-first application. The backend will be implemented separately using Supabase. Do not create a fake backend or hardcoded business logic.

User Roles

Support four roles:

Admin

HR

Manager

Employee

The UI and navigation should be role-aware and designed for each role.

Core HRMS Modules

Create frontend pages and reusable components for:

Dashboard

Employee Management

Employee 360° Profile

Departments & Designations

Attendance

Shift Management

Leave Management

Payroll

Asset Management

Recruitment

Onboarding

Performance & Goals

Documents

Expenses

HR Helpdesk / Requests

Announcements

Notifications

Reports & Analytics

Settings

Audit / Activity History

Attendance

Design UI for:

Check-in / Check-out

Present / Absent / Late / Half-day

WFH

Overtime

Shift information

Attendance corrections

Attendance history

Monthly attendance reports

Keep the architecture ready for future biometric/device/API integration.

Asset Management

Support:

Laptop

Desktop

Monitor

Mobile

Keyboard

Mouse

ID Card

Other company assets

Show asset assignment, return, repair, replacement, condition and history.

Employee 360° Profile

Create a professional employee profile with sections/tabs for:

Personal information

Employment information

Attendance

Leave

Payroll

Assets

Documents

Goals

Performance

Activity history

Role-based Dashboards

Admin:
Company-wide overview, employees, attendance, leave, payroll, assets, recruitment, analytics and settings.

HR:
Employees, attendance, leave, recruitment, onboarding, documents, payroll and reports.

Manager:
My Team, team attendance, leave approvals, goals and performance.

Employee:
My Profile, My Attendance, My Leave, My Payroll, My Assets, My Documents, My Goals and Requests.

UI / UX

Create a unique and premium enterprise SaaS design.

Requirements:

Professional modern HRMS appearance

Light and Dark themes

Global theme toggle

Responsive sidebar

Top navigation

Search

Notifications

User profile menu

Cards

Tables

Charts

Filters

Searchable lists

Forms

Modals

Confirmation dialogs

Toast notifications

Loading states

Empty states

Error states

Skeleton loaders

Responsive mobile/tablet layouts

Avoid a generic/basic admin dashboard.

Use consistent spacing, typography, icons, component styling and visual hierarchy.

Architecture

Use a clean scalable React architecture:

components

pages

layouts

hooks

services

types

utils

lib

Use React Router for navigation.

Create reusable components rather than duplicating UI.

Create service-layer placeholders so that later the application can connect to Supabase cleanly.

Expected Supabase integration structure:

src/lib/supabase.ts

src/services/employeeService.ts

src/services/attendanceService.ts

src/services/leaveService.ts

src/services/payrollService.ts

src/services/assetService.ts

Do not put database credentials directly into source code.

Use environment variables.

Important

The application must be designed so that static frontend data can later be replaced by real Supabase data without redesigning the UI.

The final result should look like a real company HRMS product suitable for a professional demonstration, portfolio project and future production development.

Do not generate unnecessary fake backend APIs.
Keep the frontend clean and ready for Supabase integration.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://flowhuman-core.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b75e5ddc-70e5-47e1-9511-0f9ca2c044cc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

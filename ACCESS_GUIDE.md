# How to Get Full Access to Your Kinetix Dashboard

## Problem
The RLS (Row Level Security) policy on the `profiles` table is blocking authenticated users from accessing their own profile data, even though the data exists and the authentication works.

## Solution

Follow these steps to regain full access:

### Step 1: Open Supabase SQL Editor
1. Go to your Supabase dashboard: https://app.supabase.com
2. Navigate to your project (Kinetix)
3. Click on **SQL Editor** in the left sidebar
4. Click **+ New Query**

### Step 2: Run the Fix SQL
Copy and paste this SQL into the editor:

```sql
-- Fix RLS policies for profiles table
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;

CREATE POLICY profiles_user_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);
```

Then click the **Execute** button (or press `Ctrl+Enter`).

### Step 3: Verify the Fix
You should see: `Success. No rows returned.`

### Step 4: Test Sign-In
1. Go back to your Kinetix app at http://localhost:8080
2. Try signing in with:
   - **Email:** admin@test.com
   - **Password:** Admin@1234

## What This Fix Does
- **Removes** the overly restrictive RLS policy that was checking for `organization_id`
- **Creates** a simple RLS policy that allows each user to access ONLY their own profile
- **Maintains security** by ensuring users cannot see other users' profiles

## Test Users Available
After signing in, you'll be able to access the dashboard based on your role:

| Email | Password | Role | Dashboard Access |
|-------|----------|------|-----------------|
| admin@test.com | Admin@1234 | Admin | Full system access |
| hr@test.com | Hr@12345 | HR | HR modules (recruitment, payroll, etc.) |
| manager@test.com | Manager@1234 | Manager | Team management modules |
| employee@test.com | Employee@1234 | Employee | Employee self-service modules |

## If It Still Doesn't Work
If you still can't sign in after running the SQL:

1. **Verify the migration ran:**
   ```sql
   SELECT * FROM public.profiles LIMIT 5;
   ```
   Should show at least 5 profiles with roles: admin, hr, manager, employee, and others

2. **Check RLS status:**
   ```sql
   SELECT schemaname, tablename, rowsecurity 
   FROM pg_tables 
   WHERE tablename = 'profiles';
   ```
   Should show `rowsecurity = true`

3. **List current policies:**
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'profiles';
   ```
   Should show the `profiles_user_select` policy

## Access the Dashboard
Once signed in:
- **Admin Dashboard:** Full system access with all modules
- **HR Dashboard:** Access to recruitment, payroll, employees, etc.
- **Manager Dashboard:** Team management, attendance, performance reviews
- **Employee Dashboard:** Personal info, leave requests, expenses, goals

Enjoy your Kinetix HRMS!

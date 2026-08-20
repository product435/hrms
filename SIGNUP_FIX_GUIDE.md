# 🔧 FIX SIGN-UP ERROR - Complete Steps

## Problem
When you create a new account, it shows:
- ❌ "Could not create account - Supabase user created, but the application profile could not be loaded"
- Next time: "User already registered" (because auth user exists but profile RLS is blocking it)

## Root Cause
The RLS (Row Level Security) policy on `profiles` table blocks new users from reading their own profile immediately after signup.

---

## ✅ SOLUTION - 3 Simple Steps

### Step 1️⃣ Open Supabase SQL Editor
1. Open: **https://app.supabase.com/project/usmnqczzxdmfpeppsede/sql/new**
2. Or navigate: Supabase Dashboard → SQL Editor → New Query

### Step 2️⃣ Copy & Paste This Exact SQL

```sql
-- Fix RLS policies for profiles table
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;

CREATE POLICY profiles_user_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY profiles_user_update ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
```

### Step 3️⃣ Execute & Done! 
- Click **Execute** button (or press `Ctrl+Enter`)
- You should see: ✅ "Success. No rows returned."

---

## ✅ Now Test The Sign-Up

1. **Go to:** http://localhost:8080/sign-up
2. **Fill in:**
   - Full name: `sandeep patel`
   - Work email: `sandeep@yahoo.com`
   - Password: `Sandeep@123` (or any password meeting the requirements)
   - Confirm password: `Sandeep@123`

3. **Click "Create account"** ✅ Should work now!

---

## ✅ Test Sign-In After Creation

Try signing in with your new account:
- **Email:** sandeep@yahoo.com
- **Password:** Sandeep@123

---

## 📊 Also Test These Pre-Made Accounts

After the RLS fix, these accounts should also work:

| Email | Password | Role | Status |
|-------|----------|------|--------|
| admin@test.com | Admin@1234 | Admin | ✅ Ready |
| hr@test.com | Hr@12345 | HR | ✅ Ready |
| manager@test.com | Manager@1234 | Manager | ✅ Ready |
| employee@test.com | Employee@1234 | Employee | ✅ Ready |
| sandeep@yahoo.com | Sandeep@123 | Employee | ✅ After you sign up |
| maan@yahoo.com | (use set password) | Employee | ✅ Ready |

---

## 🆘 If It Still Doesn't Work

### Check 1: Verify RLS Policies Are Fixed
Run this in SQL Editor:
```sql
SELECT * FROM pg_policies WHERE tablename = 'profiles' ORDER BY policyname;
```

Should show policies like:
- ✅ `profiles_user_select`
- ✅ `profiles_user_update`

### Check 2: Verify Profile Exists
If you signed up with `sandeep@yahoo.com`, run:
```sql
SELECT * FROM public.profiles WHERE email = 'sandeep@yahoo.com';
```

Should show a row with your data.

### Check 3: Verify RLS is Enabled
```sql
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'profiles';
```

Should show: `rowsecurity = true`

---

## 🎯 Expected Behavior After Fix

✅ **Sign-Up:** New users can create accounts → Get redirected to dashboard  
✅ **Sign-In:** Existing users can login → See dashboard with their role  
✅ **Dashboard:** Shows different pages based on user role:
- **Admin:** All modules
- **HR:** Recruitment, Payroll, Employees
- **Manager:** Team, Attendance, Performance  
- **Employee:** Self-service (Leave, Expenses, Goals)

---

## 💡 Quick Links

- **Supabase SQL Editor:** https://app.supabase.com/project/usmnqczzxdmfpeppsede/sql/new
- **Supabase Auth Users:** https://app.supabase.com/project/usmnqczzxdmfpeppsede/auth/users
- **Your App:** http://localhost:8080

Good luck! 🚀

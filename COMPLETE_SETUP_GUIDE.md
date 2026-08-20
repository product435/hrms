# 🚀 KINETIX - Complete Setup & Access Guide

## Current Status
✅ Database schema created  
✅ Test users created (admin, hr, manager, employee)  
✅ New user signup triggered  
❌ **RLS Policy blocking access** ← FIX NEEDED

---

## 📋 What's Happening Now

When you try to **Sign Up** or **Sign In**:
1. ✅ Supabase creates the authentication user
2. ✅ Database trigger creates the profile record
3. ❌ **RLS policy blocks your app from reading it back**
4. ❌ Error: "Supabase user created, but the application profile could not be loaded"

---

## 🔧 THE FIX (5 Minutes)

### Step 1: Open Supabase Dashboard
```
https://app.supabase.com/project/usmnqczzxdmfpeppsede/sql/new
```

### Step 2: Run This SQL (Copy & Paste)
```sql
-- Remove restrictive policies
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;

-- Create permissive policies for user access
CREATE POLICY profiles_user_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY profiles_user_update ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
```

### Step 3: Click Execute ✅
Should show: "Success. No rows returned."

---

## ✅ Test Your Fix

Run this command to verify all accounts work:
```bash
cd c:\Users\ADMIN\Downloads\flowhuman-core-main\flowhuman-core-main
$env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzbW5xY3p6eGRtZnBlcHBzZWRlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzAzODc5NCwiZXhwIjoyMTAyNjE0Nzk0fQ.Q8nWNkXccS825TIS7c9L76S8h-lRofBcA2B9oQfksBU"; node supabase/scripts/test-all-accounts.mjs
```

Expected output:
```
🔍 Testing All Accounts After RLS Fix

Testing admin@test.com... ✅ SUCCESS
Testing hr@test.com... ✅ SUCCESS
Testing manager@test.com... ✅ SUCCESS
Testing employee@test.com... ✅ SUCCESS
Testing sandeep@yahoo.com... ✅ SUCCESS

📊 Results: 5 ✅ working, 0 ❌ failed

🎉 ALL TESTS PASSED! Your app is ready to use!
```

---

## 🎯 Available Test Accounts

After applying the RLS fix, use these credentials:

### Pre-Created Admin Account
```
Email:    admin@test.com
Password: Admin@1234
Role:     Admin (full system access)
```

### Pre-Created HR Account
```
Email:    hr@test.com
Password: Hr@12345
Role:     HR (recruitment, payroll, employees)
```

### Pre-Created Manager Account
```
Email:    manager@test.com
Password: Manager@1234
Role:     Manager (team, attendance, performance)
```

### Pre-Created Employee Account
```
Email:    employee@test.com
Password: Employee@1234
Role:     Employee (self-service)
```

### Your New Account (from signup)
```
Email:    sandeep@yahoo.com
Password: Sandeep@123
Role:     Employee (auto-assigned)
```

---

## 📊 What Each Dashboard Shows

### 🔐 ADMIN Dashboard (admin@test.com)
- 👥 Employees (CRUD operations)
- 🏢 Departments
- 📋 Designations
- ⏰ Shifts & Attendance
- 🎓 Onboarding
- 🎯 Recruitment
- 💰 Payroll
- 📈 Reports & Analytics
- 🔍 Audit Logs

### 👔 HR Dashboard (hr@test.com)
- 👥 Employees
- 📋 Designations
- ⏰ Attendance
- ✈️ Leave Management
- 🎯 Recruitment (Candidates, Interviews, Offers)
- 💰 Payroll & Salary Structures
- 🎓 Onboarding

### 👨‍💼 MANAGER Dashboard (manager@test.com)
- 👥 Team Members
- ⏰ Attendance & Shifts
- ✈️ Leave Approvals
- 🎯 Goals & Performance Reviews
- 📊 Team Reports

### 👤 EMPLOYEE Dashboard (employee@test.com)
- 📋 My Profile
- ⏰ Attendance
- ✈️ Leave Requests
- 💸 Expenses
- 🎯 My Goals
- 📊 Performance Reviews
- 📄 Documents

---

## 🚀 How to Use

### 1. Start Development Server (if not running)
```bash
cd c:\Users\ADMIN\Downloads\flowhuman-core-main\flowhuman-core-main
npm run dev
```

### 2. Open in Browser
```
http://localhost:8080
```

### 3. Sign In or Create Account
- **Sign In Page:** http://localhost:8080/sign-in
- **Sign Up Page:** http://localhost:8080/sign-up

### 4. Use Your Account
After signing in, you'll see your role-based dashboard automatically!

---

## 🆘 Troubleshooting

### "Still Getting Profile Error"
Run the test script to see which accounts work:
```bash
node supabase/scripts/test-all-accounts.mjs
```

If it shows all ❌, the RLS fix wasn't applied. Go back to Step 1-3 in the FIX section.

### "Invalid Login Credentials"
- Check email spelling (case-sensitive in Supabase)
- Verify password is correct
- Make sure you're using the right account from the table above

### "User Already Registered"
This means the auth user exists but profile wasn't accessible during signup.
- Run the RLS fix (Step 1-3 above)
- Try signing in with: `sandeep@yahoo.com` / `Sandeep@123`

### "Blank Dashboard"
- Clear browser cookies/cache
- Try incognito/private window
- Reload the page

---

## 📞 Quick Reference

| What | Link |
|------|------|
| **Supabase SQL Editor** | https://app.supabase.com/project/usmnqczzxdmfpeppsede/sql |
| **Supabase Auth Users** | https://app.supabase.com/project/usmnqczzxdmfpeppsede/auth/users |
| **App Home** | http://localhost:8080 |
| **Sign In** | http://localhost:8080/sign-in |
| **Sign Up** | http://localhost:8080/sign-up |

---

## ✨ You're All Set!

After applying the RLS fix:
1. ✅ Sign-in works for all pre-created accounts
2. ✅ Sign-up works for new users
3. ✅ Dashboards show role-based content
4. ✅ All HRMS features available

**Enjoy Kinetix! 🎉**

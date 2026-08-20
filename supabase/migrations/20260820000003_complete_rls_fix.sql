-- Complete RLS Fix for Signup and Signin
-- This migration fixes Row Level Security policies to allow users to access their profiles
-- Run this AFTER the existing migrations in Supabase SQL Editor

-- ========================================
-- DROP OLD POLICIES THAT ARE TOO RESTRICTIVE
-- ========================================

-- Drop the old organization-based policies that don't work for new users
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;

-- ========================================
-- CREATE NEW WORKING POLICIES
-- ========================================

-- Policy 1: Users can SELECT their own profile (needed for signin/signup)
CREATE POLICY profiles_user_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy 2: Users can UPDATE their own profile
CREATE POLICY profiles_user_update ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy 3: Admins/HR can see all profiles in organization (optional - for admin panels)
CREATE POLICY profiles_admin_select ON public.profiles
  FOR SELECT
  USING (auth.role() = 'authenticated' AND 'admin' IN (
    SELECT COALESCE(role, 'employee')
    FROM public.profiles
    WHERE id = auth.uid()
  ));

-- ========================================
-- VERIFY THE FIX
-- ========================================

-- Check policies are in place
SELECT * FROM pg_policies WHERE tablename = 'profiles';

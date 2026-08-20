-- FIX RLS POLICIES FOR PROFILE ACCESS
-- Run this in Supabase SQL Editor to fix signup and signin

-- Drop the old restrictive policies
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;

-- Create policies that work for both signin and signup

-- Allow users to read their own profile
CREATE POLICY profiles_user_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Allow users to update their own profile
CREATE POLICY profiles_user_update ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow users to insert their profile during signup
CREATE POLICY profiles_user_insert ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

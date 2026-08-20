-- Fix RLS policies for profiles table
-- Run this in Supabase SQL Editor to allow users to access their profiles

-- Drop the restrictive policy that's blocking access
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;

-- Create a simple policy that allows users to access their own profile
CREATE POLICY profiles_user_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Keep the update policy for self updates
-- (the old profiles_self_update should already exist)

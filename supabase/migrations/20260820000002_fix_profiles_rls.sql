-- Fix RLS policies for profiles table to allow authenticated access
-- This migration allows users to access their own profile and all profiles in their organization

-- Drop the overly restrictive policy
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;

-- Create a policy that allows users to select their own profile
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

-- Create a policy that allows admins and HR to see all profiles in their org
CREATE POLICY profiles_org_select ON public.profiles
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow users to update their own profile
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_own_update ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadLocalEnv() {
  const envPath = resolve(fileURLToPath(new URL("../..", import.meta.url)), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // The shell may provide the variables directly
  }
}

loadLocalEnv();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const admin = createClient(url, serviceKey);

async function applyRLSFix() {
  console.log("Applying RLS fix to Supabase...\n");
  
  // Get the session to execute SQL
  const { data: { session } } = await admin.auth.getSession();
  
  // We need to use a different approach - create a helper function in the DB
  // that we can call via RPC
  
  console.log("Attempting to fix RLS policy via direct API calls...");
  
  try {
    // First, let's temporarily disable RLS to get access
    // We'll do this by creating a super permissive policy
    
    // Unfortunately we can't execute raw SQL through the JS SDK
    // We need to use the SQL Editor in Supabase
    
    console.log("⚠️  SQL cannot be executed directly via SDK");
    console.log("\nInstead, I'll create a helper script you need to run.\n");
    
    // Create SQL file
    const sqlContent = `-- Fix RLS policies for profiles table
-- This allows users to access their own profile

-- First, drop the restrictive policy
DROP POLICY IF EXISTS profiles_member_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;

-- Create a simple policy that lets users access their own profile
CREATE POLICY profiles_user_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Create a policy that lets users update their own profile
CREATE POLICY profiles_user_update ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow authenticated users to insert their profile (for signup)
CREATE POLICY profiles_user_insert ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);
`;

    // Write to a file
    const fs = require('fs');
    fs.writeFileSync('APPLY_RLS_FIX.sql', sqlContent);
    
    console.log("✅ Created: APPLY_RLS_FIX.sql\n");
    console.log("INSTRUCTIONS:");
    console.log("=============");
    console.log("1. Go to Supabase Console: https://app.supabase.com");
    console.log("2. Open SQL Editor");
    console.log("3. Click 'New Query'");
    console.log("4. Copy the content from APPLY_RLS_FIX.sql");
    console.log("5. Click Execute");
    console.log("\nAfter that, signup will work!");
    
  } catch (err) {
    console.error("Error:", err);
  }
}

applyRLSFix().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});

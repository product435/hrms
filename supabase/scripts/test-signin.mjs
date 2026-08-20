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
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    "Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
}

// Use the anon key for authentication (like the browser does)
const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function testSignIn() {
  console.log("Testing sign-in flow for admin@test.com...\n");
  
  // Step 1: Sign in
  console.log("Step 1: Signing in with admin@test.com / Admin@1234");
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: "admin@test.com",
    password: "Admin@1234",
  });
  
  if (authError) {
    console.error("❌ Sign-in failed:", authError.message);
    return;
  }
  
  console.log("✅ Sign-in successful!");
  console.log(`   User ID: ${authData.user?.id}`);
  console.log(`   Email: ${authData.user?.email}\n`);
  
  // Step 2: Fetch profile
  console.log("Step 2: Fetching profile");
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id, email, role, full_name, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  
  if (profileError) {
    console.error("❌ Profile fetch failed:", profileError.message);
    return;
  }
  
  if (!profile) {
    console.error("❌ No profile found");
    return;
  }
  
  console.log("✅ Profile fetched!");
  console.log(`   Full Name: ${profile.full_name || "(empty)"}`);
  console.log(`   Role: ${profile.role}`);
  console.log(`   Active: ${profile.is_active}\n`);
  
  // Step 3: Fetch employee info
  console.log("Step 3: Fetching employee info");
  const { data: employee, error: employeeError } = await client
    .from("employees")
    .select("id, first_name, last_name, email, organization_id")
    .eq("profile_id", authData.user.id)
    .maybeSingle();
  
  if (employeeError) {
    console.log("⚠️  Employee fetch note:", employeeError.message);
  } else if (!employee) {
    console.log("⚠️  No employee record found (not needed for sign-in)");
  } else {
    console.log("✅ Employee found!");
    console.log(`   Name: ${employee.first_name} ${employee.last_name}`);
    console.log(`   Organization: ${employee.organization_id}\n`);
  }
  
  console.log("=== SIGN-IN TEST PASSED ===");
  console.log("\nYou should now be able to sign in successfully!");
  console.log("The dashboard will load based on your role: " + profile.role.toUpperCase());
}

testSignIn().catch((err) => {
  console.error("Test error:", err.message);
  process.exit(1);
});

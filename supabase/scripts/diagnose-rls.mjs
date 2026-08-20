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
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function diagnoseRLS() {
  console.log("Diagnosing RLS policy issue...\n");
  
  // Sign in with anon key
  console.log("Step 1: Signing in with admin@test.com");
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: "admin@test.com",
    password: "Admin@1234",
  });
  
  if (authError) {
    console.error("❌ Sign-in failed:", authError.message);
    return;
  }
  
  console.log("✅ Sign-in successful!");
  console.log(`   User ID: ${authData.user.id}\n`);
  
  // Try with authenticated client
  console.log("Step 2: Fetching profile with authenticated client");
  const { data: authProfile, error: authProfileError } = await client
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();
  
  if (authProfileError) {
    console.error("❌ Authenticated fetch failed:", authProfileError.message);
  } else if (!authProfile) {
    console.error("❌ No profile found with authenticated client");
  } else {
    console.log("✅ Profile fetched with authenticated client:");
    console.log(JSON.stringify(authProfile, null, 2));
  }
  
  // Try with service role (should always work)
  console.log("\nStep 3: Fetching profile with service role");
  const { data: serviceProfile, error: serviceProfileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();
  
  if (serviceProfileError) {
    console.error("❌ Service role fetch failed:", serviceProfileError.message);
  } else if (!serviceProfile) {
    console.error("❌ No profile found with service role");
  } else {
    console.log("✅ Profile fetched with service role:");
    console.log(JSON.stringify(serviceProfile, null, 2));
  }
  
  // Check all profiles
  console.log("\nStep 4: Checking all profiles (service role)");
  const { data: allProfiles } = await admin.from("profiles").select("id, email, role");
  console.log(`Found ${allProfiles?.length} profiles:`);
  allProfiles?.forEach(p => console.log(`  - ${p.email} (${p.role})`));
}

diagnoseRLS().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

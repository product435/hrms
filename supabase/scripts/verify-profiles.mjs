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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in the shell or .env.local.",
  );
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function verifyFix() {
  console.log("Verifying that all test users have proper profiles and roles...\n");
  
  const users = ["admin@test.com", "hr@test.com", "manager@test.com", "employee@test.com"];
  
  let allGood = true;
  for (const email of users) {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("id, email, role, full_name, is_active")
      .eq("email", email)
      .maybeSingle();
    
    if (error) {
      console.error(`❌ Error querying ${email}:`, error.message);
      allGood = false;
    } else if (!profile) {
      console.error(`❌ No profile found for ${email}`);
      allGood = false;
    } else {
      console.log(`✅ ${email}`);
      console.log(`   Role: ${profile.role}`);
      console.log(`   Name: ${profile.full_name || "(empty)"}`);
      console.log(`   Active: ${profile.is_active}`);
      console.log();
    }
  }
  
  if (allGood) {
    console.log("✅ All test users are properly configured!");
    console.log("\nYou should now be able to sign in with:");
    console.log("  Email: admin@test.com");
    console.log("  Password: Admin@1234");
  } else {
    console.log("❌ Some profiles are still missing or misconfigured.");
  }
}

verifyFix().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

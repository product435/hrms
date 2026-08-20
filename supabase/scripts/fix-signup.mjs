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
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function fixSignUpIssue() {
  console.log("Checking auth users and profiles...\n");
  
  // Get all auth users
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 100 });
  
  console.log("Auth Users vs Profiles:\n");
  
  for (const authUser of authData.users) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, role")
      .eq("id", authUser.id)
      .maybeSingle();
    
    const hasProfile = profile ? "✅" : "❌";
    console.log(`${hasProfile} ${authUser.email} (${authUser.id})`);
    if (!profile) {
      console.log(`   → Missing profile for auth user!`);
    }
  }
  
  // Find sandeep@yahoo.com
  console.log("\n\nChecking sandeep@yahoo.com specifically:");
  const sandeepAuth = authData.users.find(u => u.email === "sandeep@yahoo.com");
  
  if (!sandeepAuth) {
    console.log("❌ sandeep@yahoo.com not found in auth users");
    return;
  }
  
  console.log(`✅ Found in auth: ${sandeepAuth.email} (ID: ${sandeepAuth.id})`);
  
  // Check if profile exists
  const { data: sandeepProfile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", sandeepAuth.id)
    .maybeSingle();
  
  if (!sandeepProfile) {
    console.log("❌ No profile found - this is the problem!");
    console.log("\nCreating profile for sandeep@yahoo.com...");
    
    const { error: insertError } = await admin
      .from("profiles")
      .insert({
        id: sandeepAuth.id,
        full_name: "Sandeep Patel",
        email: "sandeep@yahoo.com",
        role: "employee",
        is_active: true,
      });
    
    if (insertError) {
      console.error("Failed to create profile:", insertError);
    } else {
      console.log("✅ Profile created successfully!");
    }
  } else {
    console.log(`✅ Profile exists:`);
    console.log(JSON.stringify(sandeepProfile, null, 2));
  }
}

fixSignUpIssue().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

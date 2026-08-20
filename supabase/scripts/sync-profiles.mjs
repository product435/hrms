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

async function syncProfiles() {
  console.log("Fetching all auth users...");
  const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (authError) throw authError;
  
  console.log(`Found ${authData.users.length} auth users`);
  
  console.log("Fetching existing profiles...");
  const { data: existingProfiles, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .limit(10000);
  if (profileError) throw profileError;
  
  const existingIds = new Set(existingProfiles?.map(p => p.id) || []);
  console.log(`Found ${existingIds.size} existing profiles`);
  
  // Create profiles for auth users that don't have one
  let created = 0;
  for (const authUser of authData.users) {
    if (!existingIds.has(authUser.id)) {
      const { error: insertError } = await admin
        .from("profiles")
        .insert({
          id: authUser.id,
          full_name: authUser.user_metadata?.full_name || authUser.email?.split("@")[0] || "User",
          email: authUser.email,
          role: "employee", // Default role
          is_active: true,
        });
      
      if (insertError) {
        console.error(`Failed to create profile for ${authUser.email}:`, insertError);
      } else {
        console.log(`Created profile for ${authUser.email}`);
        created++;
      }
    }
  }
  
  console.log(`\nSync complete! Created ${created} new profiles.`);
}

syncProfiles().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

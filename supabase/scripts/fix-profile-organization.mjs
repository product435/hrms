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

async function fixProfilesWithOrg() {
  console.log("Setting organization_id for all test user profiles...\n");
  
  // Get the demo organization
  const { data: orgs, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .limit(1);
  
  if (orgError) throw orgError;
  if (!orgs || orgs.length === 0) {
    throw new Error("No organization found. Run the seed migration first.");
  }
  
  const orgId = orgs[0].id;
  console.log(`Using organization: ${orgId}\n`);
  
  // Get all profiles
  const { data: profiles, error: fetchError } = await admin
    .from("profiles")
    .select("id, email, organization_id")
    .limit(1000);
  
  if (fetchError) throw fetchError;
  
  console.log(`Found ${profiles?.length || 0} profiles`);
  
  let updated = 0;
  if (profiles) {
    for (const profile of profiles) {
      if (!profile.organization_id) {
        console.log(`Updating ${profile.email} with organization_id`);
        const { error: updateError } = await admin
          .from("profiles")
          .update({ organization_id: orgId })
          .eq("id", profile.id);
        
        if (updateError) {
          console.error(`Failed to update profile ${profile.email}:`, updateError);
        } else {
          updated++;
        }
      } else {
        console.log(`${profile.email} already has organization_id`);
      }
    }
  }
  
  console.log(`\nUpdated ${updated} profiles with organization_id!`);
}

fixProfilesWithOrg().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

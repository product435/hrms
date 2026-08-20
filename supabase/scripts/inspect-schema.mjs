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

async function inspectSchema() {
  console.log("Inspecting profiles table structure...\n");
  
  // Get one profile to see what columns exist
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .limit(1);
  
  if (error) {
    console.error("Error fetching profiles:", error);
    return;
  }
  
  if (data && data.length > 0) {
    const profile = data[0];
    console.log("Profile columns found:");
    console.log(JSON.stringify(profile, null, 2));
    console.log("\nAvailable keys:");
    console.log(Object.keys(profile));
  } else {
    console.log("No profiles found");
  }
}

inspectSchema().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

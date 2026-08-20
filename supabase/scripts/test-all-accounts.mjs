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
    // silent
  }
}

loadLocalEnv();

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local");
}

const client = createClient(url, anonKey);

async function testAllAccounts() {
  console.log("🔍 Testing All Accounts After RLS Fix\n");
  console.log("=".repeat(60));
  
  const accounts = [
    { email: "admin@test.com", password: "Admin@1234", role: "Admin" },
    { email: "hr@test.com", password: "Hr@12345", role: "HR" },
    { email: "manager@test.com", password: "Manager@1234", role: "Manager" },
    { email: "employee@test.com", password: "Employee@1234", role: "Employee" },
    { email: "sandeep@yahoo.com", password: "Sandeep@123", role: "Employee (New)" },
  ];
  
  let successCount = 0;
  let failCount = 0;
  
  for (const account of accounts) {
    process.stdout.write(`Testing ${account.email}... `);
    
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      
      if (error) {
        console.log(`❌ FAILED: ${error.message}`);
        failCount++;
        continue;
      }
      
      if (!data.user) {
        console.log(`❌ FAILED: No user returned`);
        failCount++;
        continue;
      }
      
      // Try to fetch profile
      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("id, email, role, full_name")
        .eq("id", data.user.id)
        .maybeSingle();
      
      if (profileError) {
        console.log(`❌ FAILED: ${profileError.message}`);
        failCount++;
      } else if (!profile) {
        console.log(`❌ FAILED: No profile found (RLS blocking)`);
        failCount++;
      } else {
        console.log(`✅ SUCCESS`);
        console.log(`   Email: ${profile.email}`);
        console.log(`   Role: ${profile.role || "not set"}`);
        console.log(`   Name: ${profile.full_name || "empty"}`);
        successCount++;
      }
      
      // Sign out
      await client.auth.signOut();
      
    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
      failCount++;
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 Results: ${successCount} ✅ working, ${failCount} ❌ failed\n`);
  
  if (successCount === accounts.length) {
    console.log("🎉 ALL TESTS PASSED! Your app is ready to use!\n");
    console.log("Next steps:");
    console.log("  1. Open http://localhost:8080");
    console.log("  2. Sign in with any account above");
    console.log("  3. Explore your role-based dashboard");
  } else if (successCount === 0) {
    console.log("❌ RLS Fix hasn't been applied yet.");
    console.log("\nRun this SQL in Supabase SQL Editor:");
    console.log("  https://app.supabase.com/project/usmnqczzxdmfpeppsede/sql/new\n");
    console.log("DROP POLICY IF EXISTS profiles_member_select ON public.profiles;");
    console.log("DROP POLICY IF EXISTS profiles_self_update ON public.profiles;");
    console.log("CREATE POLICY profiles_user_select ON public.profiles");
    console.log("  FOR SELECT USING (auth.uid() = id);");
    console.log("CREATE POLICY profiles_user_update ON public.profiles");
    console.log("  FOR UPDATE USING (auth.uid() = id)");
    console.log("  WITH CHECK (auth.uid() = id);");
  } else {
    console.log("⚠️  Some accounts work, some don't.");
    console.log("This might mean profiles are partially created.");
  }
}

testAllAccounts().catch((err) => {
  console.error("Test error:", err.message);
  process.exit(1);
});

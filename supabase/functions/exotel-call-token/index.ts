// exotel-call-token: mints a short-lived, per-user Exotel CRM WebSDK access
// token for the signed-in sales employee, so the browser never holds the
// organisation's raw Exotel account credentials.
//
// Why this exists: the official @exotel-npm-dev/exotel-ip-calling-crm-websdk
// package's own code sends its `accessToken` straight from the browser to
// Exotel's icore API on every SDK call (Initialize/MakeCall/etc -- see
// node_modules/@exotel-npm-dev/exotel-ip-calling-crm-websdk/src/*.ts). That
// is Exotel's own SDK design, not a choice made here, and it cannot be
// changed from this codebase. What this function controls is what kind of
// token the browser gets: never the Exotel Account SID / API Key / API
// Token / Customer Secret / AppSecret that could mint tokens for any user
// or be used outside the SDK's narrow icore endpoints -- only the scoped,
// expiring per-user access token the SDK itself expects, generated here
// from those real secrets, through whatever "Create Authentication Token"
// flow Exotel's account activation provides.
//
// Secrets (set with `supabase secrets set`, never in the browser, never in
// a VITE_ environment variable, never committed) -- names are provisional
// until Exotel account activation confirms the exact credential shape
// (this account is on a trial, and Exotel's own docs require contacting an
// account manager for CRM WebSDK access, so this cannot be guessed):
//   EXOTEL_API_KEY            required -- HTTP Basic auth username
//   EXOTEL_API_TOKEN          required -- HTTP Basic auth secret
//   EXOTEL_ACCOUNT_SID        required -- account identifier (not secret, but internal)
//   EXOTEL_APP_ID             required -- the registered CRM WebSDK application's AppID
//   EXOTEL_CUSTOMER_SECRET    required -- used to mint the customer-level token in step 1
//     of the documented flow (customer token -> app token -> user access token);
//     exact param names are confirmed only once Exotel grants trial/account access.
// SUPABASE_URL / SUPABASE_ANON_KEY are injected by Supabase.
//
// Caller: a signed-in sales employee (JWT). This function only ever mints a
// token scoped to that employee's own Exotel app user -- it does not accept
// or trust any employee/user id from the request body.
//
// NOT YET VERIFIED: the exact "Create Authentication Token" request shape
// (endpoint, params) is undocumented in the public README/docs reachable
// without an Exotel account manager contact. The placeholder request below
// follows the account/app/user token chain described at
// https://developer.exotel.com/docs/ip-pstn-webrtc/overview, but every field
// name must be confirmed against the real API once credentials exist, before
// this function can mint a real token. Until then it fails closed with a
// clear 503, never a fabricated token.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("EXOTEL_API_KEY");
  const apiToken = Deno.env.get("EXOTEL_API_TOKEN");
  const accountSid = Deno.env.get("EXOTEL_ACCOUNT_SID");
  const appId = Deno.env.get("EXOTEL_APP_ID");
  const customerSecret = Deno.env.get("EXOTEL_CUSTOMER_SECRET");
  if (!supabaseUrl || !anonKey) return json({ error: "Server is not configured." }, 500);
  if (!apiKey || !apiToken || !accountSid || !appId || !customerSecret) {
    return json(
      {
        error:
          "Exotel is not configured on the server. This organisation's Exotel account " +
          "credentials (EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID, EXOTEL_APP_ID, " +
          "EXOTEL_CUSTOMER_SECRET) must be set as Edge Function secrets before browser calling " +
          "can work. Confirm CRM WebSDK access and the exact token API with your Exotel account " +
          "manager first -- this is required even to finish this function's implementation.",
      },
      503,
    );
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const userRes = await userClient.auth.getUser(token);
  if (userRes.error || !userRes.data.user) return json({ error: "Not signed in." }, 401);

  const employeeRes = await userClient
    .from("employees")
    .select("id, email, first_name, last_name")
    .eq("profile_id", userRes.data.user.id)
    .maybeSingle();
  if (employeeRes.error || !employeeRes.data) {
    return json({ error: "No employee record found for this account." }, 403);
  }

  // Not implemented: the real Exotel token-minting call. Deliberately not
  // written against guessed endpoint/param names -- that would risk silently
  // failing in a way indistinguishable from this explicit "not ready" state,
  // or worse, calling an unintended endpoint with real account credentials.
  // Replace this block with the verified Exotel API call once confirmed.
  return json(
    {
      error:
        "Exotel credentials are present, but the Create Authentication Token API call has not " +
        "been implemented yet -- its exact request shape is undocumented without Exotel account " +
        "manager confirmation. See the comment at the top of this file.",
    },
    501,
  );
});

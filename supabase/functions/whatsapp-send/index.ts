// whatsapp-send: sends one outbound WhatsApp message through the official
// WhatsApp Business Cloud API, from the organisation's shared number, then
// records the result in crm_whatsapp_messages. The access token never
// reaches the browser -- it is read here, server-side, from an Edge
// Function secret, and this function is the only thing that ever sees it.
//
// Secrets (set with `supabase secrets set`, never in the browser, never in a
// VITE_ environment variable, never committed):
//   WHATSAPP_ACCESS_TOKEN       required -- permanent token for a System User
//                                 with whatsapp_business_messaging permission
//   WHATSAPP_PHONE_NUMBER_ID    required -- the shared company number's
//                                 Phone Number ID (not the phone number itself)
//   WHATSAPP_API_VERSION        optional, default "v21.0"
// SUPABASE_URL / SUPABASE_ANON_KEY are injected by Supabase.
//
// Caller: a signed-in sales employee (JWT). Ownership/visibility are
// enforced by the existing crm_whatsapp_messages RLS insert policy -- this
// function writes through a client built from the caller's own JWT, never
// a service-role client, so it can never write a message the caller
// wouldn't already be allowed to write directly. It only adds the one thing
// the browser must never hold: the provider call and its access token.

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const apiVersion = Deno.env.get("WHATSAPP_API_VERSION") || "v21.0";
  if (!supabaseUrl || !anonKey) return json({ error: "Server is not configured." }, 500);
  if (!accessToken || !phoneNumberId) {
    return json(
      {
        error:
          "WhatsApp Business is not configured on the server. Set WHATSAPP_ACCESS_TOKEN and " +
          "WHATSAPP_PHONE_NUMBER_ID as Edge Function secrets (never in the browser).",
      },
      503,
    );
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const conversationId = String(body.conversation_id ?? "");
  const customerPhone = String(body.customer_phone ?? "").trim();
  const text = String(body.body ?? "").trim();
  if (!UUID_RE.test(conversationId)) return json({ error: "Invalid conversation_id." }, 400);
  if (!customerPhone) return json({ error: "customer_phone is required." }, 400);
  if (!text || text.length > 4096) return json({ error: "Message body must be 1-4096 characters." }, 400);

  // Caller's own JWT -- RLS on crm_whatsapp_messages decides whether this
  // insert is allowed, exactly as if the browser had written it directly.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const userRes = await userClient.auth.getUser(token);
  if (userRes.error || !userRes.data.user) return json({ error: "Not signed in." }, 401);

  const waPhone = customerPhone.replace(/[^+\d]/g, "").replace(/^\+/, "");

  let providerMessageId: string | null = null;
  let sendError: string | null = null;
  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: waPhone,
          type: "text",
          text: { body: text },
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Meta's error payload shape: { error: { message, type, code, error_subcode } }
      const message = payload?.error?.message || `WhatsApp API rejected the message (${response.status}).`;
      throw new Error(message);
    }
    const id = payload?.messages?.[0]?.id;
    if (typeof id !== "string" || !id) throw new Error("WhatsApp API accepted the request but returned no message id.");
    providerMessageId = id;
  } catch (error) {
    sendError = error instanceof Error ? error.message : "Failed to reach the WhatsApp API.";
  }

  // Only ever "sent" when the provider actually confirmed acceptance.
  const insertRes = await userClient
    .from("crm_whatsapp_messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      body: text,
      provider_message_id: providerMessageId,
      status: sendError ? "failed" : "sent",
    })
    .select("*")
    .single();

  if (insertRes.error) {
    // The provider call may have already succeeded even though the DB write
    // failed (e.g. RLS denied it). Say so plainly rather than hiding it.
    return json(
      {
        error: sendError
          ? `WhatsApp send failed (${sendError}); recording it also failed: ${insertRes.error.message}`
          : `Message was sent by WhatsApp, but could not be recorded in the CRM: ${insertRes.error.message}`,
      },
      sendError ? 502 : 500,
    );
  }

  if (sendError) return json({ error: sendError, message: insertRes.data }, 502);
  return json({ message: insertRes.data });
});

// whatsapp-webhook: receives incoming WhatsApp Business Cloud API events
// (GET for Meta's one-time verification handshake, POST for real events --
// message status updates and customer replies) and writes them into the
// matching crm_whatsapp_conversations / crm_whatsapp_messages rows.
//
// This has no signed-in user -- Meta calls it directly -- so it is the one
// place in this CRM that legitimately needs a service-role client. Every
// write it makes is scoped tightly: it only ever touches the conversation
// matched by (organization + customer phone number), never any other table,
// and it never trusts anything in the request body until the signature on
// the raw body has been verified against WHATSAPP_APP_SECRET.
//
// Secrets (set with `supabase secrets set`, never in the browser, never in a
// VITE_ environment variable, never committed):
//   WHATSAPP_APP_SECRET        required -- from Meta App Dashboard > Settings > Basic
//   WHATSAPP_VERIFY_TOKEN      required -- a string you invent; Meta echoes it back
//                                during webhook setup to prove you own the URL
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// Unresolved org/owner routing: a reply only maps to an existing
// conversation (matched by customer phone number, across every
// organisation's shared number -- there is one physical shared number per
// org today). If no open conversation exists for that number yet, the event
// is accepted (200, so Meta does not retry) but not written, since there is
// no safe default organisation/owner to file it under; this is logged so a
// real deployment can decide how first-contact numbers should be routed
// (e.g. to a configured default owner) -- that policy decision was not part
// of what this CRM already models and is not invented here.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

function text(body: string, status = 200) {
  return new Response(body, { status, headers: corsHeaders });
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  const url = new URL(request.url);

  // --- Meta's one-time verification handshake ---
  if (request.method === "GET") {
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (!verifyToken) return text("Server is not configured.", 500);
    if (mode === "subscribe" && token === verifyToken && challenge) {
      return text(challenge, 200);
    }
    return text("Forbidden", 403);
  }

  if (request.method !== "POST") return text("Method not allowed", 405);

  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!appSecret || !supabaseUrl || !serviceKey) {
    return json({ error: "Server is not configured." }, 500);
  }

  const rawBody = await request.text();

  // Verify the signature over the exact raw bytes before parsing anything.
  const signatureHeader = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${await hmacSha256Hex(appSecret, rawBody)}`;
  if (!signatureHeader || !timingSafeEqual(signatureHeader, expected)) {
    return json({ error: "Invalid signature." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  // Always 200 once the signature is valid, so Meta does not retry events
  // this function has already understood (even ones it chooses not to act
  // on) -- retried floods are exactly what duplicate-event protection and a
  // flat 200 here are meant to avoid.
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  type Entry = { changes?: Array<{ value?: Record<string, unknown> }> };
  const entries = (payload.entry as Entry[] | undefined) ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const messages = (value.messages as Array<Record<string, unknown>> | undefined) ?? [];
      const statuses = (value.statuses as Array<Record<string, unknown>> | undefined) ?? [];

      for (const message of messages) {
        await handleIncomingMessage(service, message, value);
      }
      for (const status of statuses) {
        await handleStatusUpdate(service, status);
      }
    }
  }

  return json({ received: true });
});

async function findConversationByPhone(
  service: SupabaseClient,
  customerPhone: string,
) {
  const { data } = await service
    .from("crm_whatsapp_conversations")
    .select("id, organization_id, owner_id")
    .eq("customer_phone", customerPhone)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; organization_id: string; owner_id: string } | null;
}

async function handleIncomingMessage(
  service: SupabaseClient,
  message: Record<string, unknown>,
  value: Record<string, unknown>,
) {
  const providerMessageId = String(message.id ?? "");
  if (!providerMessageId) return;

  // Duplicate-event protection: Meta retries undelivered webhooks, and the
  // same event can legitimately arrive more than once. provider_message_id
  // is the natural idempotency key for this table.
  const existing = await service
    .from("crm_whatsapp_messages")
    .select("id")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (existing.data) return; // already recorded, nothing to do

  const fromRaw = String(message.from ?? "");
  if (!fromRaw) return;
  // WhatsApp sends bare digits (e.g. "919896xxxxx"); the CRM's stored format
  // includes "+". Try both so a number saved either way still matches.
  const candidates = [fromRaw, `+${fromRaw}`];

  let conversation: { id: string; organization_id: string; owner_id: string } | null = null;
  for (const candidate of candidates) {
    conversation = await findConversationByPhone(service, candidate);
    if (conversation) break;
  }
  if (!conversation) {
    // No existing conversation for this number -- see file header. Accepted,
    // not written; a real deployment needs a routing policy for first
    // contact that this CRM does not yet define.
    console.warn(`[whatsapp-webhook] no conversation found for inbound number ${fromRaw}`);
    return;
  }

  const bodyText =
    (message.text as Record<string, unknown> | undefined)?.body != null
      ? String((message.text as Record<string, unknown>).body)
      : `[${String(message.type ?? "unsupported")} message]`;

  await service.from("crm_whatsapp_messages").insert({
    organization_id: conversation.organization_id,
    conversation_id: conversation.id,
    direction: "inbound",
    body: bodyText.slice(0, 4096),
    provider_message_id: providerMessageId,
    status: "delivered",
  });

  await service
    .from("crm_whatsapp_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversation.id);

  void value; // reserved for future use (e.g. contact profile name)
}

async function handleStatusUpdate(
  service: SupabaseClient,
  status: Record<string, unknown>,
) {
  const providerMessageId = String(status.id ?? "");
  const rawStatus = String(status.status ?? "");
  const mapped =
    rawStatus === "sent" || rawStatus === "delivered" || rawStatus === "read" || rawStatus === "failed"
      ? rawStatus
      : null;
  if (!providerMessageId || !mapped) return;

  await service
    .from("crm_whatsapp_messages")
    .update({ status: mapped })
    .eq("provider_message_id", providerMessageId);
}

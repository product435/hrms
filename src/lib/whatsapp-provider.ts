/**
 * WhatsApp Business API provider adapter.
 *
 * The access token and app secret live only as Supabase Edge Function
 * secrets (`whatsapp-send`, `whatsapp-webhook` -- see supabase/functions/),
 * never in frontend code and never in a VITE_-prefixed variable. This
 * module's only job is to invoke the `whatsapp-send` Edge Function with the
 * signed-in user's own session, so the function can enforce the exact same
 * crm_whatsapp_messages RLS/ownership rules the browser would otherwise be
 * subject to directly. Sending is "configured" from the browser's point of
 * view whenever Supabase itself is configured -- whether the Edge Function
 * can actually reach WhatsApp depends on server-side secrets this module
 * cannot see, so a missing-secret response from the function (503) is
 * surfaced as a normal error, not assumed in advance.
 */

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

export const isWhatsappConfigured = isSupabaseConfigured;

export function getWhatsappConfigStatus() {
  return { configured: isWhatsappConfigured };
}

export interface SendMessageResult {
  providerMessageId: string | null;
  recordedMessage: unknown;
}

/**
 * Turns whatever `supabase.functions.invoke` rejected with into one clear,
 * specific sentence -- never the SDK's generic "Failed to send a request to
 * the Edge Function", which tells you nothing about whether the function is
 * undeployed, unreachable, or returned a real error. The three error
 * classes come from `@supabase/functions-js` via `@supabase/supabase-js`;
 * their `context` is a `Response` for Http/Relay errors (readable, since
 * 4xx/5xx/relay responses from the gateway are real HTTP responses, not
 * network failures) and the raw fetch failure for Fetch errors (not a
 * Response at all -- true offline/CORS/DNS failure, with nothing to parse).
 */
async function describeFunctionsError(error: unknown, invokeData: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const response = error.context as Response | undefined;
    if (response && typeof response.clone === "function") {
      try {
        const payload = (await response.clone().json()) as Record<string, unknown>;
        const reason =
          (typeof payload["error"] === "string" && payload["error"]) ||
          (typeof payload["message"] === "string" && payload["message"]);
        if (reason) {
          return response.status === 404
            ? `The whatsapp-send Edge Function is not deployed to this Supabase project (404: ${reason}).`
            : reason;
        }
      } catch {
        // body wasn't JSON -- fall through to the status-based message below
      }
      return `WhatsApp send failed: the Edge Function responded with HTTP ${response.status}.`;
    }
    return error.message;
  }
  if (error instanceof FunctionsFetchError) {
    return (
      "Could not reach the whatsapp-send Edge Function (network error). Check that it is " +
      "deployed and that this browser has network access to Supabase."
    );
  }
  if (invokeData && typeof invokeData === "object" && "error" in invokeData) {
    const reason = (invokeData as { error?: unknown }).error;
    if (typeof reason === "string" && reason) return reason;
  }
  return error instanceof Error ? error.message : "WhatsApp send failed.";
}

async function sendMessage(
  conversationId: string,
  customerPhone: string,
  body: string,
): Promise<SendMessageResult> {
  if (!supabase) {
    throw new Error("Supabase is not configured, so WhatsApp sending is unavailable.");
  }
  const { data, error } = await supabase.functions.invoke("whatsapp-send", {
    body: { conversation_id: conversationId, customer_phone: customerPhone, body },
  });
  if (error) {
    throw new Error(await describeFunctionsError(error, data));
  }
  const result = data as { error?: string; message?: { provider_message_id?: string | null } };
  if (result?.error) throw new Error(result.error);
  return {
    providerMessageId: result?.message?.provider_message_id ?? null,
    recordedMessage: result?.message ?? null,
  };
}

export const whatsappProvider = { sendMessage };

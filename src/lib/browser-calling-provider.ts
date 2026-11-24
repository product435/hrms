/**
 * Browser (WebRTC) calling provider adapter, backed by Exotel's official
 * CRM WebSDK (`@exotel-npm-dev/exotel-ip-calling-crm-websdk`).
 *
 * This SDK's own code sends its access token directly from the browser to
 * Exotel's icore API on every call (see
 * node_modules/@exotel-npm-dev/exotel-ip-calling-crm-websdk/src/*.ts) --
 * that is how Exotel designed it, not a choice made here. What this module
 * controls is what kind of token the browser ever holds: never the
 * organisation's raw Exotel account credentials (API Key, API Token,
 * Account SID, Customer Secret, AppSecret), only a short-lived, per-user
 * access token minted server-side by the `exotel-call-token` Edge Function
 * from the signed-in employee's own session -- the same shape as
 * whatsapp-provider.ts's relationship to the whatsapp-send Edge Function.
 *
 * `exotel-call-token` is not yet able to mint a real token (Exotel account
 * credentials are not configured, and the exact token-minting API call is
 * unconfirmed without Exotel account-manager access -- see that function's
 * header comment). Until it is, every method here surfaces that function's
 * real error, never a fabricated success.
 */

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import ExotelCRMWebSDK, {
  type ExotelWebPhoneSDK,
} from "@exotel-npm-dev/exotel-ip-calling-crm-websdk";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

export const isBrowserCallingConfigured = isSupabaseConfigured;

export function getBrowserCallingConfigStatus() {
  return {
    configured: isBrowserCallingConfigured,
    missing: [
      "Exotel account credentials as exotel-call-token Edge Function secrets " +
        "(EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID, EXOTEL_APP_ID, " +
        "EXOTEL_CUSTOMER_SECRET)",
      "Confirmation from Exotel account activation of the exact Create Authentication Token " +
        "API request shape (undocumented publicly; requires an Exotel account manager)",
      "A shared company Caller ID / ExoPhone configured on the Exotel account",
    ],
  } as const;
}

export type CallState = "idle" | "connecting" | "ringing" | "in-call" | "ended" | "failed";

export interface ActiveCall {
  phone: ExotelWebPhoneSDK;
  phoneNumber: string;
}

export type CallListener = (
  event: "incoming" | "connected" | "callEnded",
  data: Record<string, unknown>,
) => void;

async function describeFunctionsError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const response = error.context as Response | undefined;
    if (response && typeof response.clone === "function") {
      try {
        const payload = (await response.clone().json()) as Record<string, unknown>;
        const reason =
          (typeof payload["error"] === "string" && payload["error"]) ||
          (typeof payload["message"] === "string" && payload["message"]);
        if (reason) return reason;
      } catch {
        // body wasn't JSON -- fall through
      }
      return `Could not get an Exotel call token: the Edge Function responded with HTTP ${response.status}.`;
    }
    return error.message;
  }
  if (error instanceof FunctionsFetchError) {
    return (
      "Could not reach the exotel-call-token Edge Function (network error). Check that it is " +
      "deployed and that this browser has network access to Supabase."
    );
  }
  return error instanceof Error ? error.message : "Failed to get an Exotel call token.";
}

async function requestMicrophoneAccess(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone access (getUserMedia unavailable).");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

interface CallTokenResponse {
  accessToken: string;
  userId: string;
}

async function fetchCallToken(): Promise<CallTokenResponse> {
  if (!supabase) {
    throw new Error("Supabase is not configured, so browser calling is unavailable.");
  }
  const { data, error } = await supabase.functions.invoke("exotel-call-token", { method: "POST" });
  if (error) throw new Error(await describeFunctionsError(error));
  const result = data as { error?: string; accessToken?: string; userId?: string };
  if (result?.error) throw new Error(result.error);
  if (!result?.accessToken || !result?.userId) {
    throw new Error("exotel-call-token did not return an access token.");
  }
  return { accessToken: result.accessToken, userId: result.userId };
}

/**
 * Initializes the Exotel CRM WebSDK for the signed-in employee and places
 * an outbound call. Requires exotel-call-token to actually mint a token --
 * until Exotel credentials are configured, this throws that function's own
 * clear error rather than connecting a fake call.
 */
async function startCall(phoneNumber: string, onEvent: CallListener): Promise<ActiveCall> {
  await requestMicrophoneAccess();
  const { accessToken, userId } = await fetchCallToken();

  const crmSdk = new ExotelCRMWebSDK(accessToken, userId, true);
  const webPhone = await crmSdk.Initialize((event: string, data: unknown) => {
    if (event === "incoming" || event === "connected" || event === "callEnded") {
      onEvent(event, data as Record<string, unknown>);
    }
  });
  if (!webPhone) {
    throw new Error("Exotel CRM WebSDK failed to initialize (no phone object returned).");
  }

  await new Promise<void>((resolve, reject) => {
    webPhone
      .MakeCall(phoneNumber, (status, data) => {
        if (status === "success") resolve();
        else
          reject(
            new Error(
              (data as { message?: string })?.message ?? "Exotel rejected the call request.",
            ),
          );
      })
      .catch(reject);
  });

  return { phone: webPhone, phoneNumber };
}

function endCall(call: ActiveCall): void {
  call.phone.HangupCall();
}

export const browserCallingProvider = { requestMicrophoneAccess, startCall, endCall };

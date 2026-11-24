/**
 * Telephony/dialer provider adapter. No provider is configured in this
 * environment: there is no VITE_TELEPHONY_PROVIDER_URL or API key anywhere
 * in this repo. Click-to-call falls back to a plain `tel:` link (the
 * browser/OS dialer) wherever this adapter is not configured -- that is a
 * real, working feature, not a simulation. Placing a tracked call through a
 * provider, or fetching a recording, requires real credentials this
 * environment does not have, so those throw rather than pretend to succeed.
 */

export const TELEPHONY_PROVIDER_URL = import.meta.env["VITE_TELEPHONY_PROVIDER_URL"] as
  | string
  | undefined;

export const isTelephonyConfigured = Boolean(TELEPHONY_PROVIDER_URL);

export function getTelephonyConfigStatus() {
  return { configured: isTelephonyConfigured };
}

export interface PlaceCallResult {
  providerCallId: string;
}

async function placeCall(_phoneNumber: string): Promise<PlaceCallResult> {
  if (!isTelephonyConfigured) {
    throw new Error(
      "No telephony provider is configured. Add VITE_TELEPHONY_PROVIDER_URL and the provider's " +
        "credentials to enable tracked calling and recording.",
    );
  }
  throw new Error(
    "A telephony provider URL is set, but no provider integration has been implemented yet.",
  );
}

async function fetchRecording(_providerCallId: string): Promise<string> {
  if (!isTelephonyConfigured) {
    throw new Error("No telephony provider is configured. Call recordings are unavailable.");
  }
  throw new Error(
    "A telephony provider URL is set, but no provider integration has been implemented yet.",
  );
}

export const telephonyProvider = { placeCall, fetchRecording };

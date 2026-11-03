import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};

/**
 * Baseline security headers on every server response.
 *
 * Clickjacking: production may only be framed by itself. Lovable preview
 * hosts (*.lovable.app / *.lovableproject.com) may also be framed by the
 * Lovable editor on lovable.dev. Never allow-list *.lovable.app as a parent:
 * anyone can publish a page there. A full script/connect CSP is left out on
 * purpose: SSR hydration uses inline scripts, so it needs nonces first.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(self), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

const LOVABLE_PREVIEW_HOST = /\.(lovable\.app|lovableproject\.com)$/i;

function frameAncestors(request: Request): string {
  let host = "";
  try {
    host = new URL(request.url).hostname;
  } catch {
    // fall through to the strict policy
  }
  return LOVABLE_PREVIEW_HOST.test(host)
    ? "'self' https://lovable.dev https://*.lovable.dev"
    : "'self'";
}

function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const policy = `frame-ancestors ${frameAncestors(request)}; base-uri 'self'; object-src 'none'`;
  for (const [name, value] of Object.entries({
    ...SECURITY_HEADERS,
    "Content-Security-Policy": policy,
  })) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

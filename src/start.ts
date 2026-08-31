import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
//
// Built lazily inside the createStart() factory rather than at module top
// level: the production SSR bundle splits createCsrfMiddleware's real
// implementation into a separate chunk that circularly imports back from
// this one, so calling it eagerly during this module's own top-level
// evaluation can race that chunk's initialization and see an unresolved
// binding (TypeError: createCsrfMiddleware is not a function). The
// createStart factory itself already runs lazily (after all modules have
// finished loading), so building the middleware inside it sidesteps the
// circular-import timing window entirely.
export const startInstance = createStart(() => ({
  requestMiddleware: [
    errorMiddleware,
    createCsrfMiddleware({
      filter: (ctx) => ctx.handlerType === "serverFn",
    }),
  ],
}));

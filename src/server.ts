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
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

// Diagnostic temporaire — lit la valeur RUNTIME de SUPABASE_URL telle que
// réellement liée au Worker (pas ce que la CI a calculé/validé, ni un log
// susceptible d'être masqué : la source de vérité du binding lui-même).
// Ne renvoie que le nom d'hôte, jamais de clé. À retirer une fois la
// confusion de projet Supabase clarifiée.
function debugEnvResponse(env: unknown): Response {
  const raw = (env as { SUPABASE_URL?: string } | null)?.SUPABASE_URL;
  let supabaseUrlHost: string;
  if (!raw) {
    supabaseUrlHost = "(SUPABASE_URL absent du binding runtime)";
  } else {
    try {
      supabaseUrlHost = new URL(raw).host;
    } catch {
      supabaseUrlHost = "(SUPABASE_URL présent mais n'est pas une URL valide)";
    }
  }
  return new Response(
    JSON.stringify({ supabaseUrlHost, commit: __BUILD_SHA__, checkedAt: new Date().toISOString() }, null, 2),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

// Marqueur de diagnostic temporaire (voir __BUILD_SHA__/__BUILD_TIME__ dans
// vite.config.ts) — permet de confirmer que le Worker exécute bien le
// dernier déploiement, sans passer par le routage SSR ni aucun cache
// d'assets. À retirer une fois la confusion de projet Supabase clarifiée.
function healthResponse(): Response {
  return new Response(
    JSON.stringify(
      {
        status: "ok",
        commit: __BUILD_SHA__,
        builtAt: __BUILD_TIME__,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") return healthResponse();
    if (pathname === "/api/debug-env") return debugEnvResponse(env);
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};

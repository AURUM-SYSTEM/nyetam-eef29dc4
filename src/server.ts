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

// Diagnostic temporaire — lit SUPABASE_URL exactement comme le fait le
// vrai code applicatif (client.server.ts : process.env.SUPABASE_URL), pas
// via le paramètre `env` brut du Worker Cloudflare. Ce fichier server.ts
// n'est PAS le point d'entrée réel du Worker (Nitro génère son propre
// wrapper et n'y transmet jamais `env` — il alimente process.env par un
// autre mécanisme interne), donc lire `env` ici donnait un faux négatif.
// Ne renvoie que le nom d'hôte, jamais de clé. À retirer une fois la
// confusion de projet Supabase clarifiée.
function debugEnvResponse(): Response {
  const raw = process.env.SUPABASE_URL;
  let supabaseUrlHost: string;
  if (!raw) {
    supabaseUrlHost = "(process.env.SUPABASE_URL absent)";
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
    if (pathname === "/api/debug-env") return debugEnvResponse();
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

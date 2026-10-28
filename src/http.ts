#!/usr/bin/env node
/**
 * Titan Email MCP server — hosted (Streamable HTTP + OAuth 2.1) entry point, for use as a
 * remote connector in Claude. Titan has no OAuth of its own, so this server is its own
 * authorization server: the user signs in with their mailbox address and password on
 * /authorize, the login is checked against the provider's IMAP server, and the settings
 * are sealed into the tokens (see tokens.ts). Nothing is stored server-side.
 *
 * Env:
 *   TOKEN_SECRET            required, 32+ random characters; rotating it revokes all tokens
 *   PUBLIC_BASE_URL         the public https:// origin, e.g. https://titan-mcp.example.com
 *   PORT                    default 3000
 *   ALLOWED_REDIRECT_HOSTS  comma-separated; default claude.ai,claude.com,localhost,127.0.0.1
 *   TRUST_PROXY             Express "trust proxy" hops for client IPs; default 1
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { ImapFlow } from "imapflow";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { configFromCredentials, PROVIDER_PRESETS, type Credentials } from "./config.js";
import { createServer, SERVER_VERSION } from "./server.js";
import { Sealer, verifyPkce } from "./tokens.js";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const ALLOWED_REDIRECT_HOSTS = (process.env.ALLOWED_REDIRECT_HOSTS ?? "claude.ai,claude.com,localhost,127.0.0.1")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const CODE_TTL = 2 * 60;

if (!process.env.TOKEN_SECRET || process.env.TOKEN_SECRET.length < 32) {
  console.error("TOKEN_SECRET must be set to at least 32 random characters, e.g. `openssl rand -base64 48`.");
  process.exit(1);
}
const sealer = new Sealer(process.env.TOKEN_SECRET);

const RESOURCE = `${BASE_URL}/mcp`;
const RESOURCE_METADATA_URL = `${BASE_URL}/.well-known/oauth-protected-resource`;

interface Client {
  redirectUris: string[];
  name: string;
}
interface Code {
  creds: Credentials;
  clientId: string;
  redirectUri: string;
  challenge: string;
}
interface Refresh {
  creds: Credentials;
  clientId: string;
}

// ---------- helpers ----------

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Redirects may only go to allowlisted hosts (Claude's callbacks), over https except on loopback. */
function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.has(host))) return false;
  return ALLOWED_REDIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function issueTokens(creds: Credentials, clientId: string) {
  return {
    access_token: sealer.seal("access", creds, ACCESS_TTL),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: sealer.seal("refresh", { creds, clientId } satisfies Refresh, REFRESH_TTL),
    scope: "mailbox",
  };
}

/** Logs in to the provider's IMAP server and immediately logs out, to vet credentials before issuing a code. */
async function checkLogin(creds: Credentials): Promise<void> {
  const cfg = configFromCredentials(creds);
  const client = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  await client.connect();
  await client.logout().catch(() => client.close());
}

interface AuthParams {
  clientId: string;
  client: Client;
  redirectUri: string;
  state?: string;
  challenge: string;
}

/**
 * Validates an authorization request. Problems with the client or redirect URI are shown
 * to the user (never redirected, per RFC 6749 §4.1.2.1); everything else is redirected back.
 */
function parseAuthRequest(q: Record<string, unknown>, res: Response): AuthParams | null {
  const clientId = str(q.client_id) ?? "";
  const client = sealer.open<Client>("client", clientId);
  if (!client) {
    page(res, 400, "Unknown client", "<p>This sign-in link isn't valid. Start the connection again from Claude.</p>");
    return null;
  }
  const redirectUri = str(q.redirect_uri) ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri) || !redirectAllowed(redirectUri)) {
    page(res, 400, "Invalid redirect", "<p>This sign-in link has an invalid redirect address.</p>");
    return null;
  }
  const state = str(q.state);
  const fail = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    res.redirect(302, u.toString());
    return null;
  };
  if (q.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = str(q.code_challenge);
  if (!challenge || q.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with S256 is required.");
  return { clientId, client, redirectUri, state, challenge };
}

function page(res: Response, status: number, title: string, body: string): void {
  res
    .status(status)
    .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
    .set("X-Frame-Options", "DENY")
    .set("Cache-Control", "no-store")
    .type("html")
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Titan Email for Claude</title><style>
:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:440px;margin:40px auto;padding:0 16px}
label{display:block;margin:14px 0 4px;font-weight:600}input,select{width:100%;padding:9px;font:inherit;box-sizing:border-box;border:1px solid #8888;border-radius:6px}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400}.check input{width:auto;margin-top:5px}
button{margin-top:20px;width:100%;padding:11px;font:inherit;font-weight:600;border:0;border-radius:6px;background:#4f46e5;color:#fff;cursor:pointer}
.err{background:#fee2e2;color:#991b1b;padding:10px;border-radius:6px}.note{font-size:14px;opacity:.75}code{font-size:90%}
</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`);
}

function signInForm(res: Response, p: AuthParams, values: { email?: string; provider?: string; fromName?: string; error?: string } = {}) {
  const hidden = { client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state ?? "", code_challenge: p.challenge };
  const options = Object.keys(PROVIDER_PRESETS)
    .map((k) => `<option value="${k}"${(values.provider ?? "titan") === k ? " selected" : ""}>${k === "godaddy" ? "GoDaddy-hosted Titan" : "Titan Email"}</option>`)
    .join("");
  page(
    res,
    values.error ? 401 : 200,
    "Connect your mailbox",
    `<p><strong>${esc(p.client.name)}</strong> (${esc(new URL(p.redirectUri).host)}) wants access to your Titan mailbox to read, search, organize, draft and — if you allow it — send email.</p>
${values.error ? `<p class="err">${esc(values.error)}</p>` : ""}
<form method="post" action="/authorize">
${Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("\n")}
<label for="email">Mailbox address</label><input id="email" name="email" type="email" autocomplete="username" required value="${esc(values.email)}">
<label for="password">Mailbox password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<label for="provider">Provider</label><select id="provider" name="provider">${options}</select>
<label for="from_name">Sender display name <span class="note">(optional)</span></label><input id="from_name" name="from_name" value="${esc(values.fromName)}">
<label class="check"><input type="checkbox" name="allow_send" value="1"> Allow Claude to send email and replies. Leave off to allow drafts only.</label>
<button type="submit">Connect</button>
</form>
<p class="note">Turn on <em>Settings → Enable Titan on other apps</em> in Titan webmail first. Your password is checked with your mail provider and then kept only inside the encrypted token held by Claude — this server doesn't store it. To change these settings later, disconnect and reconnect.</p>`,
  );
}

// ---------- app ----------

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

// Browser-based MCP clients (e.g. MCP Inspector) call these cross-origin; the sign-in page itself is same-origin.
const api = cors({ origin: true, exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"], maxAge: 600 });

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, version: SERVER_VERSION });
});

app.get("/", (_req, res) => {
  page(
    res,
    200,
    "Titan Email for Claude",
    `<p>This is a remote MCP server that connects Claude to a Titan Email (or GoDaddy-hosted Titan) mailbox over IMAP/SMTP.</p>
<p>Add it in Claude as a custom connector with the URL <code>${esc(RESOURCE)}</code>.</p>
<p><a href="https://github.com/qmmughal/titan-email-mcp">Documentation and source</a> · <a href="/privacy">Privacy policy</a></p>`,
  );
});

let privacyText = "See https://github.com/qmmughal/titan-email-mcp/blob/main/PRIVACY.md";
try {
  privacyText = readFileSync(fileURLToPath(new URL("../PRIVACY.md", import.meta.url)), "utf8");
} catch {
  // PRIVACY.md missing from this install; fall back to the link.
}
app.get("/privacy", (_req, res) => {
  page(res, 200, "Privacy policy", `<pre style="white-space:pre-wrap;font:inherit">${esc(privacyText)}</pre>`);
});

// RFC 9728 protected-resource metadata, at the root and at the path-suffixed location.
const resourceMetadata = (_req: Request, res: Response) => {
  res.json({
    resource: RESOURCE,
    authorization_servers: [BASE_URL],
    scopes_supported: ["mailbox"],
    bearer_methods_supported: ["header"],
    resource_name: "Titan Email",
    resource_documentation: "https://github.com/qmmughal/titan-email-mcp",
  });
};
app.get("/.well-known/oauth-protected-resource", api, resourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", api, resourceMetadata);

// RFC 8414 authorization-server metadata.
app.get("/.well-known/oauth-authorization-server", api, (_req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mailbox"],
    service_documentation: "https://github.com/qmmughal/titan-email-mcp",
  });
});

// RFC 7591 dynamic client registration. The client ID is the sealed registration itself.
app.post("/register", api, express.json({ limit: "16kb" }), (req, res) => {
  const uris = req.body?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && redirectAllowed(u))) {
    res.status(400).json({
      error: "invalid_redirect_uri",
      error_description: `redirect_uris must be https (or loopback http) URLs on: ${ALLOWED_REDIRECT_HOSTS.join(", ")}`,
    });
    return;
  }
  const name = (str(req.body.client_name) ?? "An MCP client").slice(0, 100);
  res.status(201).json({
    client_id: sealer.seal("client", { redirectUris: uris, name } satisfies Client),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

app.get("/authorize", (req, res) => {
  const p = parseAuthRequest(req.query, res);
  if (p) signInForm(res, p);
});

// Each attempt is a real IMAP login, so throttle per IP to keep this from being a password-guessing proxy.
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => page(res, 429, "Too many attempts", "<p>Too many sign-in attempts. Wait 15 minutes and try again.</p>"),
});

app.post("/authorize", express.urlencoded({ extended: false, limit: "16kb" }), signInLimiter, async (req, res) => {
  const p = parseAuthRequest({ ...req.body, response_type: "code", code_challenge_method: "S256" }, res);
  if (!p) return;
  const email = (str(req.body.email) ?? "").trim();
  const provider = str(req.body.provider) ?? "titan";
  const fromName = (str(req.body.from_name) ?? "").trim().slice(0, 100);
  const creds: Credentials = {
    user: email,
    pass: str(req.body.password) ?? "",
    provider: PROVIDER_PRESETS[provider] ? provider : "titan",
    fromName,
    allowSend: req.body.allow_send === "1",
  };
  if (!email || !creds.pass) {
    signInForm(res, p, { email, provider, fromName, error: "Enter your mailbox address and password." });
    return;
  }
  try {
    await checkLogin(creds);
  } catch {
    signInForm(res, p, {
      email,
      provider,
      fromName,
      error: "Couldn't sign in to that mailbox. Check the address, password and provider, and that “Enable Titan on other apps” is on.",
    });
    return;
  }
  const code = sealer.seal("code", { creds, clientId: p.clientId, redirectUri: p.redirectUri, challenge: p.challenge } satisfies Code, CODE_TTL);
  const u = new URL(p.redirectUri);
  u.searchParams.set("code", code);
  if (p.state) u.searchParams.set("state", p.state);
  u.searchParams.set("iss", BASE_URL);
  res.redirect(302, u.toString());
});

app.post("/token", api, express.urlencoded({ extended: false, limit: "64kb" }), express.json({ limit: "64kb" }), (req, res) => {
  res.set("Cache-Control", "no-store");
  const b = req.body ?? {};
  const grant = (error: string, description: string) => res.status(400).json({ error, error_description: description });

  if (b.grant_type === "authorization_code") {
    const code = sealer.open<Code>("code", str(b.code));
    if (!code) return void grant("invalid_grant", "Authorization code is invalid or expired.");
    if (str(b.client_id) && b.client_id !== code.clientId) return void grant("invalid_grant", "Code was issued to another client.");
    if (str(b.redirect_uri) && b.redirect_uri !== code.redirectUri) return void grant("invalid_grant", "redirect_uri mismatch.");
    if (!verifyPkce(str(b.code_verifier), code.challenge)) return void grant("invalid_grant", "PKCE verification failed.");
    res.json(issueTokens(code.creds, code.clientId));
    return;
  }

  if (b.grant_type === "refresh_token") {
    const r = sealer.open<Refresh>("refresh", str(b.refresh_token));
    if (!r) return void grant("invalid_grant", "Refresh token is invalid or expired. Reconnect the mailbox.");
    if (str(b.client_id) && b.client_id !== r.clientId) return void grant("invalid_grant", "Token was issued to another client.");
    res.json(issueTokens(r.creds, r.clientId));
    return;
  }

  grant("unsupported_grant_type", "Use authorization_code or refresh_token.");
});

// ---------- MCP endpoint (stateless Streamable HTTP) ----------

function unauthorized(res: Response, invalid: boolean): void {
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}"${invalid ? ', error="invalid_token", error_description="Token is invalid or expired"' : ""}`,
    )
    .json({ error: invalid ? "invalid_token" : "unauthorized" });
}

app.options("/mcp", api);
app.post("/mcp", api, express.json({ limit: "8mb" }), async (req, res) => {
  const header = req.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  if (!token) return void unauthorized(res, false);
  const creds = sealer.open<Credentials>("access", token);
  if (!creds) return void unauthorized(res, true);

  // One server + transport per request: no sessions, so any instance behind a load balancer can serve it.
  const server = createServer(configFromCredentials(creds));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request failed:", e instanceof Error ? e.message : e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get("/mcp", api, methodNotAllowed);
app.delete("/mcp", api, methodNotAllowed);

app.listen(PORT, () => {
  console.error(`titan-email MCP (HTTP) v${SERVER_VERSION} listening on :${PORT} — public URL ${RESOURCE}`);
});

# Titan Email MCP

[![npm version](https://img.shields.io/npm/v/titan-email-mcp.svg)](https://www.npmjs.com/package/titan-email-mcp)
[![npm downloads](https://img.shields.io/npm/dm/titan-email-mcp.svg)](https://www.npmjs.com/package/titan-email-mcp)
[![CI](https://github.com/qmmughal/titan-email-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/qmmughal/titan-email-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/titan-email-mcp.svg)](LICENSE)

Connect Claude — Desktop, Code, Cursor, or any [MCP](https://modelcontextprotocol.io) client — directly to a **Titan Email** mailbox, so it can read, search, triage, and send mail on your behalf.

Package: [npmjs.com/package/titan-email-mcp](https://www.npmjs.com/package/titan-email-mcp) · Source: [github.com/qmmughal/titan-email-mcp](https://github.com/qmmughal/titan-email-mcp) · Listed on the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.qmmughal/titan-email-mcp) as `io.github.qmmughal/titan-email-mcp`, and on [Smithery](https://smithery.ai/servers/qmmughal/titan-email-mcp)

[![Titan Email MCP server](https://mcprush.com/badge/titan-email-mcp/card.svg)](https://mcprush.com/to/titan-email-mcp?ref=badge)

Titan Email (the mailbox product bundled with many domain registrars, including **GoDaddy**) has no public REST API. This server bridges that gap by talking to Titan's standard **IMAP** and **SMTP** endpoints instead, so your AI assistant gets real mailbox access without any vendor integration work.

**Contents:** [Why use this](#why-use-this) · [Supported providers](#supported-providers) · [Tools](#tools) · [Quick start](#quick-start) · [Claude Code plugin](#claude-code-plugin) · [Hosted connector](#hosted-connector-remote-mcp) · [GoDaddy users — ready-to-paste config](#godaddy-users--ready-to-paste-config) · [Configuration](#configuration) · [Security notes](#security-notes) · [Troubleshooting](#troubleshooting) · [Development](#development) · [Contributing](#contributing) · [License](#license)

## Why use this

- **Your inbox becomes an agent tool.** Ask Claude to summarize unread mail, draft replies in your voice, triage by sender, or find "that invoice from last March" — in plain English, in the same conversation you're already having.
- **✅ Tested and confirmed working with GoDaddy-hosted Titan mailboxes.** If you bought your domain and mailbox through GoDaddy, your email is very likely running on Titan's infrastructure under the hood. One `TITAN_PROVIDER` setting handles the different server hostnames — see [Supported providers](#supported-providers).
- **Safe by default.** Sending is gated behind `TITAN_ALLOW_SEND` (default **on**, but trivially switched **off**) so you can run Claude in read-only / draft-only mode until you trust it.
- **No middleman service.** Credentials go straight from your MCP client's local config to Titan's own IMAP/SMTP servers over TLS. Nothing is proxied through a third party, cached, or logged to disk.
- **One process, ten focused tools.** No bloated API surface — just the operations you actually do in a mailbox (see [Tools](#tools) below).
- **Published on npm.** Run it with `npx titan-email-mcp` — no cloning or building required for everyday use.
- **Discoverable.** Listed on the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.qmmughal/titan-email-mcp) and on [Smithery](https://smithery.ai/servers/qmmughal/titan-email-mcp), so MCP clients and directories that browse those registries can find and install it directly.

## Supported providers

Titan Email is used directly (`imap.titan.email` / `smtp.titan.email`) and resold under other brands with different hostnames. Set `TITAN_PROVIDER` to pick the right defaults — no need to remember hostnames:

| `TITAN_PROVIDER` | IMAP host | SMTP host | Use when... |
|---|---|---|---|
| `titan` (default) | `imap.titan.email` | `smtp.titan.email` | You signed up for Titan Email directly, or your registrar just says "Titan Email". |
| `godaddy` | `imap.secureserver.net` | `smtpout.secureserver.net` | Your domain **and mailbox** were purchased through GoDaddy. |

`godaddy` has been tested against a live GoDaddy-hosted Titan mailbox and confirmed working.

If your reseller uses yet another hostname, leave `TITAN_PROVIDER` unset and override `TITAN_IMAP_HOST` / `TITAN_IMAP_PORT` / `TITAN_SMTP_HOST` / `TITAN_SMTP_PORT` directly — check your provider's welcome email or webmail settings page for the exact values. Explicit host/port variables always win over the preset.

## Tools

| Tool | What it does |
|---|---|
| `test_connection` | Verifies IMAP + SMTP login without touching any mail. **Run this first.** |
| `list_folders` | Folders with message / unread counts. |
| `list_emails` | Latest emails in a folder (optionally unread only). |
| `search_emails` | Filter by from, to, subject, text, date range, unread. |
| `read_email` | Full message by UID: headers, text body, attachment list. |
| `send_email` | Send new mail (copy saved to Sent). Disabled when `TITAN_ALLOW_SEND=false`. |
| `reply_email` | Threaded reply / reply-all, or save the reply as a draft instead of sending. |
| `save_draft` | Save to Drafts without sending — always available, even in read-only mode. |
| `move_email` | Move messages to another folder (Archive, Trash, etc.). |
| `set_flags` | Mark read/unread, flag/unflag. |

## Quick start

**1. Enable IMAP/SMTP access** — in Titan webmail (or your reseller's equivalent, e.g. GoDaddy's Email & Office settings): **Settings → Enable Titan on other apps**. This is required; without it, logins from this server will be rejected even with the correct password.

**2. Get the server** — either works, pick one:

- **npx (no install step)** — your MCP client runs `npx titan-email-mcp` directly; npm fetches it on first use and caches it. This is the path used in the config examples below.
- **Clone and build**, if you want to read/modify the source first:
  ```bash
  git clone https://github.com/qmmughal/titan-email-mcp.git
  cd titan-email-mcp/titan-mcp
  npm install
  npm run build
  ```
  This produces `dist/index.js` — point your client's `args` at its **absolute path** instead of using `npx`.

**3. Register it with your MCP client** — pick your client below, plug in your credentials, then restart the client.

**4. Verify.** In a new conversation, ask Claude to run `test_connection`. You should get back `"status": "ok"` for both `imap` and `smtp`. If not, see [Troubleshooting](#troubleshooting).

### Claude Desktop

Edit your `claude_desktop_config.json` ([config file location](https://modelcontextprotocol.io/quickstart/user)):

```json
{
  "mcpServers": {
    "titan-email": {
      "command": "npx",
      "args": ["-y", "titan-email-mcp"],
      "env": {
        "TITAN_EMAIL": "you@yourdomain.com",
        "TITAN_PASSWORD": "your-password",
        "TITAN_PROVIDER": "titan",
        "TITAN_FROM_NAME": "Your Name",
        "TITAN_ALLOW_SEND": "false"
      }
    }
  }
}
```

Built from source instead? Swap `"command": "npx", "args": ["-y", "titan-email-mcp"]` for `"command": "node", "args": ["/absolute/path/to/titan-email-mcp/titan-mcp/dist/index.js"]`.

### Claude Code

```bash
claude mcp add titan-email --scope user \
  -e TITAN_EMAIL=you@yourdomain.com \
  -e TITAN_PASSWORD=your-password \
  -e TITAN_PROVIDER=titan \
  -e TITAN_FROM_NAME="Your Name" \
  -e TITAN_ALLOW_SEND=false \
  -- npx -y titan-email-mcp
```

Use `--scope project` instead of `--scope user` to make it available only inside one repo (written to `.mcp.json`, safe to share with a team since it carries no secrets by itself — just don't commit real credentials into it).

### GoDaddy users — ready-to-paste config

If your domain **and mailbox** were purchased through GoDaddy, your email almost certainly runs on Titan's infrastructure under GoDaddy's own hostnames, not Titan's. This has been tested end-to-end against a live GoDaddy-hosted Titan mailbox — you don't need to look those hostnames up yourself; just use `TITAN_PROVIDER=godaddy` and everything else works exactly the same as above:

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "titan-email": {
      "command": "npx",
      "args": ["-y", "titan-email-mcp"],
      "env": {
        "TITAN_EMAIL": "you@yourdomain.com",
        "TITAN_PASSWORD": "your-godaddy-mailbox-password",
        "TITAN_PROVIDER": "godaddy",
        "TITAN_FROM_NAME": "Your Name",
        "TITAN_ALLOW_SEND": "false"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add titan-email --scope user \
  -e TITAN_EMAIL=you@yourdomain.com \
  -e TITAN_PASSWORD=your-godaddy-mailbox-password \
  -e TITAN_PROVIDER=godaddy \
  -e TITAN_FROM_NAME="Your Name" \
  -e TITAN_ALLOW_SEND=false \
  -- npx -y titan-email-mcp
```

Before either one works, enable IMAP/SMTP access in GoDaddy's **Email & Office** settings (same "allow other apps" toggle mentioned in step 1 above — GoDaddy's webmail may label it slightly differently than Titan's own). Then run `test_connection` to confirm. If `godaddy` doesn't work for your specific plan, your mailbox may be on a different GoDaddy backend — check **Email & Office → Settings → Email Setup** in your GoDaddy dashboard for the exact IMAP/SMTP hostnames and override `TITAN_IMAP_HOST`/`TITAN_SMTP_HOST` directly (see [Configuration](#configuration)).

### Cursor and other MCP clients

Any client that supports the standard `mcpServers` JSON shape (`command` / `args` / `env`) works the same way — use the Claude Desktop block above as a template and drop it into that client's MCP config file.

## Claude Code plugin

This repo is also a Claude Code plugin (in [`plugin/`](plugin/)). It runs the same npm package, prompts
for your mailbox settings (the password goes to your system's secure credential store), and adds a skill
that has Claude confirm before sending. Sending is **off by default** in the plugin; turn on
"Allow sending" in its settings. Do step 1 of the quick start (enable IMAP/SMTP access) first.

```bash
claude plugin marketplace add qmmughal/titan-email-mcp
claude plugin install titan-email-mcp@qmmughal-titan-email
```

## Hosted connector (remote MCP)

The same server can run on the web as a **remote MCP connector**, so you can add it to Claude
(claude.ai, Claude Desktop, mobile) by URL with no local install. It speaks Streamable HTTP at `/mcp`
and is its own OAuth 2.1 authorization server, because Titan has no OAuth:

1. Claude connects and is sent to the server's sign-in page.
2. You enter your mailbox address, password, provider, and whether Claude may send mail.
3. The server checks the login against your provider's IMAP server, then **encrypts your settings into
   the OAuth token that Claude holds**. The server has no database and stores no passwords or mail.

Tokens last 1 hour and refresh for 30 days. Changing your mailbox password, or rotating the server's
`TOKEN_SECRET`, cuts off every existing connection. Redirects are only allowed to Claude's callback
hosts, and sign-in attempts are rate-limited per IP.

### Deploy it

Any host that runs Docker or Node 18+ behind HTTPS works (Fly.io, Render, Railway, Cloud Run, a VPS
with Caddy or nginx):

```bash
docker build -t titan-email-mcp .
docker run -p 3000:3000   -e TOKEN_SECRET="$(openssl rand -base64 48)"   -e PUBLIC_BASE_URL=https://titan-mcp.example.com   titan-email-mcp
```

| Variable | Required | Purpose |
|---|---|---|
| `TOKEN_SECRET` | Yes | 32+ random characters used to encrypt tokens. Keep it secret and stable; changing it signs everyone out. |
| `PUBLIC_BASE_URL` | Yes, in production | The public `https://` origin the server is reached at. |
| `PORT` | No | Listen port, default `3000`. |
| `ALLOWED_REDIRECT_HOSTS` | No | OAuth redirect hosts, default `claude.ai,claude.com,localhost,127.0.0.1`. |
| `TRUST_PROXY` | No | Reverse-proxy hops in front of the server, for per-IP rate limiting. Default `1`. |

Without Docker: `npm ci && npm run build && npm run start:http` with the same variables.

#### Fly.io

The repo includes a [`fly.toml`](fly.toml). Install [flyctl](https://fly.io/docs/flyctl/install/), then from the
repo root:

```bash
fly auth login
fly launch --copy-config --no-deploy        # creates the app from fly.toml; keep the name or pick another
fly secrets set TOKEN_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")"
fly deploy
```

If you picked a different app name, update both `app` and `PUBLIC_BASE_URL` in `fly.toml` before
deploying. Check it's up at `https://<app>.fly.dev/healthz`, then connect `https://<app>.fly.dev/mcp`
in Claude. Machines stop when idle and start on the next request, so the first call after a quiet
period takes a second or two. Set `TOKEN_SECRET` once and leave it: changing it signs every user out.

### Connect it in Claude

In Claude, open **Settings → Connectors → Add custom connector**, enter
`https://<your-host>/mcp`, and sign in with your mailbox when prompted. Turn on
**Settings → Enable Titan on other apps** in Titan webmail first.

The server also serves a landing page at `/` and its [privacy policy](PRIVACY.md) at `/privacy`.

## Configuration

All configuration is environment variables passed through your MCP client's server config — never command-line flags or files on disk.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TITAN_EMAIL` | yes | — | Full mailbox address. |
| `TITAN_PASSWORD` | yes | — | Use an app-specific password if your provider offers one. |
| `TITAN_PROVIDER` | no | `titan` | `titan` or `godaddy` — see [Supported providers](#supported-providers). |
| `TITAN_IMAP_HOST` / `TITAN_IMAP_PORT` | no | from provider preset | Override for other resellers. |
| `TITAN_SMTP_HOST` / `TITAN_SMTP_PORT` | no | from provider preset | Override for other resellers. |
| `TITAN_FROM_NAME` | no | *(none)* | Display name on outgoing mail. |
| `TITAN_ALLOW_SEND` | no | `true` | Set `false` to disable `send_email` / sending replies — `save_draft` and draft-only replies still work. |
| `TITAN_SENT_FOLDER` | no | `Sent` | Folder name sent-mail copies are appended to. |
| `TITAN_DRAFTS_FOLDER` | no | `Drafts` | Folder name drafts are saved to. |

Run `list_folders` once after setup to confirm the exact Sent/Drafts folder names your mailbox uses — some providers localize or rename them.

## Security notes

- **Start read-only.** Set `TITAN_ALLOW_SEND=false` until you've watched Claude use the mailbox and trust the behavior. You can flip it on later with no code changes.
- **Hosted connector:** your password is verified with your provider and then exists only inside the encrypted token Claude holds — see [Hosted connector](#hosted-connector-remote-mcp) and [PRIVACY.md](PRIVACY.md).
- **Local mode: credentials live only in your MCP client's local config**, passed as environment variables to this process. They are never written to disk by this server, logged, or sent anywhere except Titan's own IMAP/SMTP servers over TLS.
- **Prefer an app-specific password** over your main account password if your provider supports one (check webmail security settings).
- **Each tool call opens a short-lived IMAP session** and closes it immediately after — nothing is cached or kept connected between calls.
- This server has no telemetry, no analytics, and no network calls other than to the IMAP/SMTP hosts you configure.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `test_connection` → `imap.status: "failed: ... Authentication failed"` | IMAP/SMTP access isn't enabled on the account yet, or the password is wrong. Re-check Settings → Enable Titan on other apps. |
| Works for GoDaddy mailbox, fails with default settings | Set `TITAN_PROVIDER=godaddy`. |
| GoDaddy mailbox still fails with `TITAN_PROVIDER=godaddy` | Your plan may use a different GoDaddy backend than `imap.secureserver.net`. Check **Email & Office → Settings → Email Setup** in your GoDaddy dashboard for the exact hostnames and set `TITAN_IMAP_HOST`/`TITAN_SMTP_HOST` directly — see [Configuration](#configuration). |
| Connection times out | A firewall or VPN is blocking outbound 993/465. Try from a different network to confirm. |
| Every tool call returns "Missing TITAN_EMAIL and/or TITAN_PASSWORD" | Both are missing from the client's `env` block. Tools still appear in the client (by design, so directories can list them), but every call will fail until both are set. |
| `send_email` returns an error about sending being disabled | `TITAN_ALLOW_SEND` is `false`. Use `save_draft` or `reply_email` with `draft_only: true`, or flip the flag on. |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm start        # local stdio server (reads env vars from your shell)
npm run start:http   # hosted HTTP + OAuth server (needs TOKEN_SECRET; see Hosted connector)
```

`npm start` speaks MCP over stdio (`StdioServerTransport`), so running it directly just blocks waiting for a client on stdin. `npm run start:http` serves `http://localhost:3000/mcp`. The tools live in `src/server.ts` and are shared by both entry points (`src/index.ts` for stdio, `src/http.ts` for HTTP).

**Releasing a new version** (maintainers): bump `version` in `package.json` (and the matching `version` fields in `server.json`), run `npm run build` to confirm it compiles, commit and push, then `npm publish` from `titan-mcp/`. The package only ships `dist/`, `README.md`, `LICENSE`, and `PRIVACY.md` (see `files` in `package.json`) — source TypeScript stays GitHub-only. After the npm publish lands, update the [MCP Registry](https://registry.modelcontextprotocol.io) listing with `mcp-publisher publish` (requires `mcp-publisher login github` once per session — see the [registry quickstart](https://modelcontextprotocol.io/registry/quickstart)), then tag a GitHub release (`gh release create vX.Y.Z`) so Smithery's crawler picks up the new version via `smithery.yaml`.

## Contributing

Issues and PRs welcome at [github.com/qmmughal/titan-email-mcp](https://github.com/qmmughal/titan-email-mcp). If you add support for another Titan-based reseller, please add its hostnames to the provider preset table in `src/index.ts` and this README.

## License

[MIT](LICENSE)

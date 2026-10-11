# Titan Email MCP

Connect Claude — Desktop, Code, Cursor, or any [MCP](https://modelcontextprotocol.io) client — directly to a **Titan Email** mailbox, so it can read, search, triage, and send mail on your behalf.

Titan Email (the mailbox product bundled with many domain registrars, including **GoDaddy**) has no public REST API. This server bridges that gap by talking to Titan's standard **IMAP** and **SMTP** endpoints instead, so your AI assistant gets real mailbox access without any vendor integration work.

## Why use this

- **Your inbox becomes an agent tool.** Ask Claude to summarize unread mail, draft replies in your voice, triage by sender, or find "that invoice from last March" — in plain English, in the same conversation you're already having.
- **Works with GoDaddy-hosted Titan mailboxes.** If you bought your domain and mailbox through GoDaddy, your email is very likely running on Titan's infrastructure under the hood. One `TITAN_PROVIDER` setting handles the different server hostnames — see [Supported providers](#supported-providers).
- **Safe by default.** Sending is gated behind `TITAN_ALLOW_SEND` (default **on**, but trivially switched **off**) so you can run Claude in read-only / draft-only mode until you trust it.
- **No middleman service.** Credentials go straight from your MCP client's local config to Titan's own IMAP/SMTP servers over TLS. Nothing is proxied through a third party, cached, or logged to disk.
- **One process, nine focused tools.** No bloated API surface — just the operations you actually do in a mailbox (see [Tools](#tools) below).

## Supported providers

Titan Email is used directly (`imap.titan.email` / `smtp.titan.email`) and resold under other brands with different hostnames. Set `TITAN_PROVIDER` to pick the right defaults — no need to remember hostnames:

| `TITAN_PROVIDER` | IMAP host | SMTP host | Use when... |
|---|---|---|---|
| `titan` (default) | `imap.titan.email` | `smtp.titan.email` | You signed up for Titan Email directly, or your registrar just says "Titan Email". |
| `godaddy` | `imap.secureserver.net` | `smtpout.secureserver.net` | Your domain **and mailbox** were purchased through GoDaddy. |

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

### Cursor and other MCP clients

Any client that supports the standard `mcpServers` JSON shape (`command` / `args` / `env`) works the same way — use the Claude Desktop block above as a template and drop it into that client's MCP config file.

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
- **Credentials live only in your MCP client's local config**, passed as environment variables to this process. They are never written to disk by this server, logged, or sent anywhere except Titan's own IMAP/SMTP servers over TLS.
- **Prefer an app-specific password** over your main account password if your provider supports one (check webmail security settings).
- **Each tool call opens a short-lived IMAP session** and closes it immediately after — nothing is cached or kept connected between calls.
- This server has no telemetry, no analytics, and no network calls other than to the IMAP/SMTP hosts you configure.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `test_connection` → `imap.status: "failed: ... Authentication failed"` | IMAP/SMTP access isn't enabled on the account yet, or the password is wrong. Re-check Settings → Enable Titan on other apps. |
| Works for GoDaddy mailbox, fails with default settings | Set `TITAN_PROVIDER=godaddy`. |
| Connection times out | A firewall or VPN is blocking outbound 993/465. Try from a different network to confirm. |
| MCP client shows the server as failed immediately on startup | `TITAN_EMAIL` or `TITAN_PASSWORD` is missing from the `env` block — this server exits immediately (by design) if either is unset; check the client's MCP server logs for the exact message. |
| `send_email` returns an error about sending being disabled | `TITAN_ALLOW_SEND` is `false`. Use `save_draft` or `reply_email` with `draft_only: true`, or flip the flag on. |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm start        # run the built server directly (reads env vars from your shell)
```

The server speaks MCP over stdio (`StdioServerTransport`) — it's not an HTTP service, so running it directly just blocks waiting for a client on stdin.

## Contributing

Issues and PRs welcome at [github.com/qmmughal/titan-email-mcp](https://github.com/qmmughal/titan-email-mcp). If you add support for another Titan-based reseller, please add its hostnames to the provider preset table in `src/index.ts` and this README.

## License

[MIT](LICENSE)

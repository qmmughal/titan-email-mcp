# titan-email-mcp

MCP server that connects Claude (Desktop, Code, Cursor, any MCP client) to a **Titan Email** mailbox.
Titan has no public mailbox API, so it uses Titan's IMAP/SMTP servers.

## Tools

| Tool | What it does |
|---|---|
| `list_folders` | Folders with message / unread counts |
| `list_emails` | Latest emails in a folder (optionally unread only) |
| `search_emails` | Filter by from, to, subject, text, date range, unread |
| `read_email` | Full message by UID: headers, text body, attachment list |
| `send_email` | Send new mail (copy saved to Sent) |
| `reply_email` | Threaded reply / reply-all, or save the reply as a draft |
| `save_draft` | Save to Drafts without sending |
| `move_email` | Move to Archive, Trash, etc. |
| `set_flags` | Mark read/unread, flag/unflag |

## Setup

1. In Titan webmail: **Settings → Enable Titan on other apps** (required for IMAP/SMTP).
2. Build:
   ```bash
   npm install
   npm run build
   ```

## Configuration (env vars)

| Variable | Default |
|---|---|
| `TITAN_EMAIL` | required |
| `TITAN_PASSWORD` | required |
| `TITAN_IMAP_HOST` / `TITAN_IMAP_PORT` | `imap.titan.email` / `993` |
| `TITAN_SMTP_HOST` / `TITAN_SMTP_PORT` | `smtp.titan.email` / `465` |
| `TITAN_FROM_NAME` | display name on outgoing mail |
| `TITAN_ALLOW_SEND` | `true`; set `false` for read + drafts only |
| `TITAN_SENT_FOLDER` / `TITAN_DRAFTS_FOLDER` | `Sent` / `Drafts` |

Some resellers use different hosts (e.g. `imap0101.titan.email`; GoDaddy uses `imap.secureserver.net` / `smtpout.secureserver.net`). Override the host vars if yours differ. Run `list_folders` once to confirm the exact Sent/Drafts folder names.

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "titan-email": {
      "command": "node",
      "args": ["/absolute/path/to/titan-mcp/dist/index.js"],
      "env": {
        "TITAN_EMAIL": "you@yourdomain.com",
        "TITAN_PASSWORD": "your-password",
        "TITAN_FROM_NAME": "Your Name",
        "TITAN_ALLOW_SEND": "false"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add titan-email \
  -e TITAN_EMAIL=you@yourdomain.com -e TITAN_PASSWORD=your-password \
  -- node /absolute/path/to/titan-mcp/dist/index.js
```

## Notes

- Each tool call opens a short-lived IMAP session; nothing is cached on disk.
- Credentials live only in the MCP client's env config. Start with `TITAN_ALLOW_SEND=false` until you trust the setup.
- Emails are addressed by IMAP UID, which is stable per folder.

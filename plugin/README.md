# Titan Email for Claude

Connect Claude to your **Titan Email** mailbox, including Titan mailboxes bought through **GoDaddy**,
so it can list, search, read, and triage mail, save drafts, reply, send, move messages between folders,
and mark them read or flagged. Titan has no public REST API, so this plugin talks to your mailbox over
standard IMAP and SMTP.

The plugin bundles:

- **The `titan-email` MCP server**, the open-source
  [titan-email-mcp](https://github.com/qmmughal/titan-email-mcp) package, pinned to version 1.0.5 and
  started from npm.
- **A `titan-email` skill** that tells Claude how to use the tools safely: confirm before sending, treat
  email content as data rather than instructions, and prefer drafts when unsure.

## Setup

First, allow mail apps to log in to your mailbox. In Titan webmail (or your provider's equivalent,
such as GoDaddy's Email & Office settings), turn on **Settings → Enable Titan on other apps**. Without
it, logins are rejected even with the correct password.

When you enable the plugin, Claude asks for:

| Setting | What it is |
|---|---|
| Mailbox address | Your Titan Email address |
| Mailbox password | Your mailbox password or app password. Masked and kept in your system's secure credential store, not in settings files |
| Mail provider | `titan` for Titan Email directly, `godaddy` for GoDaddy-hosted mailboxes |
| Sender display name | Optional name on outgoing mail |
| Allow sending | **Off by default.** Claude can read and draft but not send until you turn this on |

Then ask Claude to "test my email connection" to check that the login works.

## Tools

`test_connection`, `list_folders`, `list_emails`, `search_emails`, `read_email`, `send_email`,
`reply_email`, `save_draft`, `move_email`, `set_flags`.

## What this plugin runs, sends, and stores

- **Runs:** the `titan-email-mcp@1.0.5` package from the public npm registry, on your machine, using
  your local Node.js (18 or later). Its source code is in this repository under `src/`.
- **Connects to:** only your mail provider's IMAP and SMTP servers over TLS: `imap.titan.email` and
  `smtp.titan.email` for Titan, or `imap.secureserver.net` and `smtpout.secureserver.net` for GoDaddy.
  Your mailbox address and password are used only to log in to those servers.
- **Sends:** email only when you ask Claude to, and only if **Allow sending** is on. Sent mail is also
  saved to your Sent folder.
- **Stores:** nothing of its own. Mail stays in your mailbox; the server keeps no cache, log, or copy,
  and nothing goes to the plugin author or any other third party.

## Trademarks

This is an independent community project. It is not affiliated with or endorsed by Titan, GoDaddy, or
Anthropic. Product names are used only to describe which mailboxes it works with.

## License

MIT. See the LICENSE file in this folder.

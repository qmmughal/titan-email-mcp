# Privacy Policy — Titan Email MCP

Last updated: 2026-10-28

Titan Email MCP ("the server") connects an AI assistant such as Claude to your Titan Email mailbox
(including GoDaddy-hosted Titan) over the standard IMAP and SMTP protocols. It is an independent
open-source project maintained by qmmughal and is not affiliated with Titan, GoDaddy, or Anthropic.

This policy covers both ways of running it: **locally** (the npm package or Claude Code plugin,
running on your own computer) and **hosted** (the remote connector you add to Claude by URL).

## What data the server handles

- **Your mailbox address and password**, which you enter in your MCP client's settings (local) or on
  the server's sign-in page (hosted).
- **Your mail settings**: provider (Titan or GoDaddy), optional sender display name, and whether
  sending is allowed.
- **Email content** — folder lists, message headers, bodies, and attachment names — but only what the
  assistant requests through a tool call, such as listing, searching, or reading a message.
- **Messages you ask it to send, draft, move, or flag.**

## How the data is used

Only to carry out the tool calls you or your assistant make: logging in to your mail provider's IMAP
and SMTP servers, then reading, searching, drafting, sending, moving, or flagging mail. Results are
returned to your assistant and are not used for anything else — no analytics, advertising, profiling,
or model training.

## Where the data goes

- **Your mail provider** — `imap.titan.email` / `smtp.titan.email` for Titan, or
  `imap.secureserver.net` / `smtpout.secureserver.net` for GoDaddy — over TLS.
- **Your AI assistant** (for example Claude), which receives tool results. How the assistant handles
  them is covered by that assistant's own privacy policy.
- **Recipients** of mail you choose to send.

Nothing is sold, shared with, or sent to the maintainer or any other third party.

## Storage and retention

- **Local:** nothing is stored by the server. Your credentials stay in your MCP client's
  configuration (the Claude Code plugin keeps the password in your operating system's secure
  credential store).
- **Hosted:** the server has no database and stores **no passwords, email content, or tokens** at
  rest. After your password is verified with your mail provider, your mailbox settings are encrypted
  (AES-256-GCM) into the OAuth tokens that your assistant holds. Access tokens expire after 1 hour
  and refresh tokens after 30 days. Email content passes through the server's memory only for the
  duration of a single request.
- **Logs:** the hosted server does not log email content, passwords, or tokens. The hosting provider
  may keep standard request logs (such as IP address, time, and URL path) for operations and abuse
  prevention, under its own retention policy.

## Your choices

- Disconnect the connector or uninstall the plugin at any time; hosted tokens then stop being used
  and expire on their own.
- Changing your mailbox password immediately invalidates any hosted tokens.
- Leave "Allow sending" off to limit the assistant to reading and drafting.

## Security

Connections to your mail provider use TLS. The hosted server is reached over HTTPS, uses OAuth 2.1
with PKCE, only redirects to approved client callback addresses, and rate-limits sign-in attempts.

## Children

The server is not directed to children under 18.

## Changes

Updates to this policy are published in this file in the project repository, with the date above.

## Contact

Questions or requests: open an issue at https://github.com/qmmughal/titan-email-mcp/issues

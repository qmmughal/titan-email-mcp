#!/usr/bin/env node
/**
 * Titan Email MCP server — local (stdio) entry point.
 * Titan has no public mailbox API, so this talks to Titan's standard
 * IMAP (imap.titan.email:993) and SMTP (smtp.titan.email:465) servers.
 * For the hosted, OAuth-protected HTTP server, see http.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv } from "./config.js";
import { createServer } from "./server.js";

const cfg = configFromEnv();

// Tool schemas register unconditionally, regardless of credentials, so clients
// and directory crawlers can list this server's capabilities without live creds.
// Credentials are only required once a tool actually tries to touch the mailbox.
if (!cfg.user || !cfg.pass) {
  console.error(
    "TITAN_EMAIL / TITAN_PASSWORD not set — tools are registered but will return an error until both are configured in your MCP client's server config.",
  );
}

await createServer(cfg).connect(new StdioServerTransport());
console.error(`titan-email MCP running for ${cfg.user} (provider=${cfg.provider}, imap=${cfg.imapHost}:${cfg.imapPort})`);

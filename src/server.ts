/**
 * Builds the Titan Email MCP server for one mailbox. Shared by the local stdio entry
 * point (index.ts) and the hosted HTTP entry point (http.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ImapFlow, type SearchObject } from "imapflow";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { simpleParser } from "mailparser";
import { z } from "zod";
import type { Config } from "./config.js";

export const SERVER_VERSION = "1.1.0";

export function createServer(cfg: Config): McpServer {
  function ensureCreds(): void {
    if (!cfg.user || !cfg.pass) {
      throw new Error("Missing mailbox credentials. In local mode set TITAN_EMAIL and TITAN_PASSWORD in your MCP client's server config — see README.md for examples.");
    }
  }

  async function withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    ensureCreds();
    const client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: true,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  const smtp = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const fromAddr = () => (cfg.fromName ? `"${cfg.fromName}" <${cfg.user}>` : cfg.user);

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  });
  const fail = (e: unknown) => ({
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  });

  function addrList(a: any): string {
    if (!a) return "";
    const arr = Array.isArray(a) ? a : [a];
    return arr.map((x: any) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(", ");
  }

  async function summaries(c: ImapFlow, uids: number[]) {
    const out: any[] = [];
    if (!uids.length) return out;
    for await (const m of c.fetch(uids, { uid: true, envelope: true, flags: true, size: true }, { uid: true })) {
      out.push({
        uid: m.uid,
        date: m.envelope?.date,
        from: addrList(m.envelope?.from),
        to: addrList(m.envelope?.to),
        subject: m.envelope?.subject ?? "",
        seen: m.flags?.has("\\Seen") ?? false,
        flagged: m.flags?.has("\\Flagged") ?? false,
        size: m.size,
      });
    }
    return out.sort((a, b) => b.uid - a.uid);
  }

  const server = new McpServer({ name: "titan-email", version: SERVER_VERSION });
  const folder = z.string().default("INBOX").describe("Mailbox path, e.g. INBOX, Sent, Archive");

  server.registerTool(
    "test_connection",
    {
      title: "Test mailbox connection",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Verify IMAP and SMTP login against the configured Titan (or GoDaddy-hosted Titan) account. " +
        "Run this first after setup — it touches no mail, it only confirms the credentials and host settings work.",
    },
    async () => {
      const result: Record<string, unknown> = {
        user: cfg.user,
        provider: cfg.provider,
        imap: { host: cfg.imapHost, port: cfg.imapPort, status: "pending" },
        smtp: { host: cfg.smtpHost, port: cfg.smtpPort, status: "pending" },
        allowSend: cfg.allowSend,
      };
      try {
        await withImap(async () => undefined);
        (result.imap as Record<string, unknown>).status = "ok";
      } catch (e) {
        (result.imap as Record<string, unknown>).status = `failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      try {
        ensureCreds();
        await smtp.verify();
        (result.smtp as Record<string, unknown>).status = "ok";
      } catch (e) {
        (result.smtp as Record<string, unknown>).status = `failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      return ok(result);
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description: "List all mailbox folders with message and unread counts.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(
          await withImap(async (c) => {
            const boxes = await c.list({ statusQuery: { messages: true, unseen: true } });
            return boxes.map((b) => ({
              path: b.path,
              specialUse: b.specialUse ?? null,
              messages: b.status?.messages,
              unseen: b.status?.unseen,
            }));
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_emails",
    {
      title: "List emails",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: "List the most recent emails in a folder (newest first).",
      inputSchema: {
        folder,
        limit: z.number().int().min(1).max(100).default(20),
        unread_only: z.boolean().default(false),
      },
    },
    async ({ folder, limit, unread_only }) => {
      try {
        return ok(
          await withImap(async (c) => {
            const lock = await c.getMailboxLock(folder);
            try {
              const uids = (await c.search(unread_only ? { seen: false } : { all: true }, { uid: true })) || [];
              return summaries(c, uids.slice(-limit));
            } finally {
              lock.release();
            }
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "search_emails",
    {
      title: "Search emails",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: "Search a folder by sender, recipient, subject, body text, date range or read state.",
      inputSchema: {
        folder,
        from: z.string().optional(),
        to: z.string().optional(),
        subject: z.string().optional(),
        text: z.string().optional().describe("Matches headers or body"),
        since: z.string().optional().describe("ISO date, inclusive"),
        before: z.string().optional().describe("ISO date, exclusive"),
        unread_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
      },
    },
    async (a) => {
      try {
        const q: SearchObject = {};
        if (a.from) q.from = a.from;
        if (a.to) q.to = a.to;
        if (a.subject) q.subject = a.subject;
        if (a.text) q.text = a.text;
        if (a.since) q.since = new Date(a.since);
        if (a.before) q.before = new Date(a.before);
        if (a.unread_only) q.seen = false;
        if (!Object.keys(q).length) q.all = true;
        return ok(
          await withImap(async (c) => {
            const lock = await c.getMailboxLock(a.folder);
            try {
              const uids = (await c.search(q, { uid: true })) || [];
              return summaries(c, uids.slice(-a.limit));
            } finally {
              lock.release();
            }
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "read_email",
    {
      title: "Read email",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Read a full email by UID: headers, plain-text body and attachment list.",
      inputSchema: {
        folder,
        uid: z.number().int(),
        mark_read: z.boolean().default(true),
        max_chars: z.number().int().default(20000),
      },
    },
    async ({ folder, uid, mark_read, max_chars }) => {
      try {
        return ok(
          await withImap(async (c) => {
            const lock = await c.getMailboxLock(folder);
            try {
              const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
              if (!msg || !msg.source) throw new Error(`UID ${uid} not found in ${folder}`);
              const p = await simpleParser(msg.source);
              if (mark_read) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
              const body = p.text ?? (typeof p.html === "string" ? p.html.replace(/<[^>]+>/g, " ") : "");
              return {
                uid,
                messageId: p.messageId,
                date: p.date,
                from: p.from?.text,
                to: p.to ? addrList((Array.isArray(p.to) ? p.to : [p.to]).flatMap((t) => t.value)) : "",
                cc: p.cc ? addrList((Array.isArray(p.cc) ? p.cc : [p.cc]).flatMap((t) => t.value)) : "",
                subject: p.subject,
                body: body.length > max_chars ? body.slice(0, max_chars) + "\n…[truncated]" : body,
                attachments: p.attachments.map((x) => ({ filename: x.filename, contentType: x.contentType, size: x.size })),
              };
            } finally {
              lock.release();
            }
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  const composeSchema = {
    to: z.array(z.string().email()).min(1),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    subject: z.string(),
    body: z.string().describe("Plain-text body"),
    html: z.string().optional().describe("Optional HTML body"),
  };

  async function appendCopy(folder: string, raw: Buffer, flags: string[]) {
    await withImap((c) => c.append(folder, raw, flags)).catch(() => undefined);
  }

  async function buildRaw(mail: SendMailOptions): Promise<Buffer> {
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await t.sendMail(mail);
    return info.message as Buffer;
  }

  server.registerTool(
    "send_email",
    {
      title: "Send email",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      description: "Send a new email from the Titan account. A copy is saved to the Sent folder.",
      inputSchema: composeSchema,
    },
    async (a) => {
      if (!cfg.allowSend) return fail("Sending is disabled for this mailbox (TITAN_ALLOW_SEND=false, or \"Allow sending\" was off when it was connected). Use save_draft instead.");
      try {
        ensureCreds();
        const mail = { from: fromAddr(), to: a.to, cc: a.cc, bcc: a.bcc, subject: a.subject, text: a.body, html: a.html };
        const info = await smtp.sendMail(mail);
        await appendCopy(cfg.sentFolder, await buildRaw({ ...mail, messageId: info.messageId }), ["\\Seen"]);
        return ok({ sent: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "reply_email",
    {
      title: "Reply to email",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      description: "Reply to an email by UID, threading it correctly. Set reply_all to include all recipients.",
      inputSchema: {
        folder,
        uid: z.number().int(),
        body: z.string(),
        reply_all: z.boolean().default(false),
        draft_only: z.boolean().default(false).describe("Save as draft instead of sending"),
      },
    },
    async ({ folder, uid, body, reply_all, draft_only }) => {
      if (!draft_only && !cfg.allowSend) return fail("Sending is disabled for this mailbox (TITAN_ALLOW_SEND=false, or \"Allow sending\" was off when it was connected). Set draft_only=true.");
      try {
        const orig = await withImap(async (c) => {
          const lock = await c.getMailboxLock(folder);
          try {
            const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
            if (!m || !m.source) throw new Error(`UID ${uid} not found in ${folder}`);
            return simpleParser(m.source);
          } finally {
            lock.release();
          }
        });
        const replyTo = (orig.replyTo ?? orig.from)?.value.map((v) => v.address!).filter(Boolean) ?? [];
        const others = reply_all
          ? [orig.to, orig.cc]
              .flatMap((x) => (x ? (Array.isArray(x) ? x : [x]) : []))
              .flatMap((x) => x.value.map((v) => v.address!))
              .filter((addr) => addr && addr.toLowerCase() !== cfg.user.toLowerCase() && !replyTo.includes(addr))
          : [];
        const subject = /^re:/i.test(orig.subject ?? "") ? orig.subject! : `Re: ${orig.subject ?? ""}`;
        const refs = [...(Array.isArray(orig.references) ? orig.references : orig.references ? [orig.references] : []), orig.messageId]
          .filter(Boolean)
          .join(" ");
        const quoted = (orig.text ?? "").split("\n").map((l) => `> ${l}`).join("\n");
        const mail = {
          from: fromAddr(),
          to: replyTo,
          cc: others.length ? others : undefined,
          subject,
          inReplyTo: orig.messageId,
          references: refs,
          text: `${body}\n\nOn ${orig.date?.toUTCString()}, ${orig.from?.text} wrote:\n${quoted}`,
        };
        if (draft_only) {
          const raw = await buildRaw(mail);
          await withImap((c) => c.append(cfg.draftsFolder, raw, ["\\Draft", "\\Seen"]));
          return ok({ draft_saved: true, folder: cfg.draftsFolder, to: replyTo, cc: others });
        }
        const info = await smtp.sendMail(mail);
        await appendCopy(cfg.sentFolder, await buildRaw({ ...mail, messageId: info.messageId }), ["\\Seen"]);
        await withImap(async (c) => {
          const lock = await c.getMailboxLock(folder);
          try {
            await c.messageFlagsAdd(String(uid), ["\\Answered"], { uid: true });
          } finally {
            lock.release();
          }
        }).catch(() => undefined);
        return ok({ sent: true, messageId: info.messageId, to: replyTo, cc: others });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "save_draft",
    {
      title: "Save draft",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Save an email to the Drafts folder without sending it.",
      inputSchema: composeSchema,
    },
    async (a) => {
      try {
        const raw = await buildRaw({ from: fromAddr(), to: a.to, cc: a.cc, bcc: a.bcc, subject: a.subject, text: a.body, html: a.html });
        await withImap((c) => c.append(cfg.draftsFolder, raw, ["\\Draft", "\\Seen"]));
        return ok({ draft_saved: true, folder: cfg.draftsFolder });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "move_email",
    {
      title: "Move emails",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: "Move emails to another folder (e.g. Archive, Trash).",
      inputSchema: { folder, uids: z.array(z.number().int()).min(1), destination: z.string() },
    },
    async ({ folder, uids, destination }) => {
      try {
        return ok(
          await withImap(async (c) => {
            const lock = await c.getMailboxLock(folder);
            try {
              await c.messageMove(uids.join(","), destination, { uid: true });
              return { moved: uids.length, destination };
            } finally {
              lock.release();
            }
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_flags",
    {
      title: "Set read/flagged state",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Mark emails read/unread and flagged/unflagged.",
      inputSchema: {
        folder,
        uids: z.array(z.number().int()).min(1),
        read: z.boolean().optional(),
        flagged: z.boolean().optional(),
      },
    },
    async ({ folder, uids, read, flagged }) => {
      try {
        return ok(
          await withImap(async (c) => {
            const lock = await c.getMailboxLock(folder);
            const set = uids.join(",");
            try {
              if (read === true) await c.messageFlagsAdd(set, ["\\Seen"], { uid: true });
              if (read === false) await c.messageFlagsRemove(set, ["\\Seen"], { uid: true });
              if (flagged === true) await c.messageFlagsAdd(set, ["\\Flagged"], { uid: true });
              if (flagged === false) await c.messageFlagsRemove(set, ["\\Flagged"], { uid: true });
              return { updated: uids.length };
            } finally {
              lock.release();
            }
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

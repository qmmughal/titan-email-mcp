/**
 * Stateless, encrypted OAuth artifacts for the hosted server.
 *
 * Client IDs, authorization codes, access tokens and refresh tokens are all
 * AES-256-GCM-sealed JSON, so the server keeps no database and never stores a
 * mailbox password at rest: the password lives only inside the access/refresh
 * token that the user's MCP client (Claude) holds. Rotating TOKEN_SECRET revokes
 * every outstanding token and client registration at once.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type Kind = "client" | "code" | "access" | "refresh";

const VERSION = "v1";

export class Sealer {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error("TOKEN_SECRET must be at least 32 characters.");
    this.key = createHash("sha256").update(`titan-email-mcp:${VERSION}:${secret}`).digest();
  }

  /** Seal `payload` as a `kind` token, expiring after `ttlSeconds` (never, if omitted). */
  seal(kind: Kind, payload: unknown, ttlSeconds?: number): string {
    const exp = ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : undefined;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${VERSION}:${kind}`));
    const body = Buffer.concat([cipher.update(JSON.stringify({ p: payload, exp }), "utf8"), cipher.final()]);
    return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
  }

  /** Open a `kind` token; null if it's malformed, tampered with, the wrong kind, or expired. */
  open<T>(kind: Kind, token: string | undefined): T | null {
    if (!token || !token.startsWith(`${VERSION}.`)) return null;
    try {
      const raw = Buffer.from(token.slice(VERSION.length + 1), "base64url");
      const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${VERSION}:${kind}`));
      decipher.setAuthTag(raw.subarray(12, 28));
      const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
      const { p, exp } = JSON.parse(json) as { p: T; exp?: number };
      if (exp !== undefined && exp < Math.floor(Date.now() / 1000)) return null;
      return p;
    } catch {
      return null;
    }
  }
}

/** RFC 7636 S256: BASE64URL(SHA256(code_verifier)) must equal the stored code_challenge. */
export function verifyPkce(verifier: string | undefined, challenge: string): boolean {
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

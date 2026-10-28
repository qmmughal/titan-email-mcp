// Host/port presets for known Titan-based providers. TITAN_IMAP_HOST / TITAN_SMTP_HOST
// (and their *_PORT siblings) always win over the preset, so any reseller can be
// supported by setting those explicitly even if it's not listed here.
export const PROVIDER_PRESETS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  titan: { imapHost: "imap.titan.email", imapPort: 993, smtpHost: "smtp.titan.email", smtpPort: 465 },
  godaddy: { imapHost: "imap.secureserver.net", imapPort: 993, smtpHost: "smtpout.secureserver.net", smtpPort: 465 },
};

export interface Config {
  user: string;
  pass: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  fromName: string;
  allowSend: boolean;
  sentFolder: string;
  draftsFolder: string;
}

/** Mailbox settings a hosted-connector user chooses on the sign-in page. */
export interface Credentials {
  user: string;
  pass: string;
  provider: string;
  fromName: string;
  allowSend: boolean;
}

function presetFor(provider: string) {
  const name = provider.toLowerCase();
  const preset = PROVIDER_PRESETS[name];
  return { name: preset ? name : "titan", preset: preset ?? PROVIDER_PRESETS.titan, known: !!preset };
}

/** Local (stdio) mode: everything comes from the MCP client's env block. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const { name, preset, known } = presetFor(env.TITAN_PROVIDER ?? "titan");
  if (!known) {
    console.error(
      `Unknown TITAN_PROVIDER "${env.TITAN_PROVIDER}", falling back to "titan". Valid values: ${Object.keys(PROVIDER_PRESETS).join(", ")}.`,
    );
  }
  return {
    user: env.TITAN_EMAIL ?? "",
    pass: env.TITAN_PASSWORD ?? "",
    provider: name,
    imapHost: env.TITAN_IMAP_HOST ?? preset.imapHost,
    imapPort: Number(env.TITAN_IMAP_PORT ?? preset.imapPort),
    smtpHost: env.TITAN_SMTP_HOST ?? preset.smtpHost,
    smtpPort: Number(env.TITAN_SMTP_PORT ?? preset.smtpPort),
    fromName: env.TITAN_FROM_NAME ?? "",
    allowSend: (env.TITAN_ALLOW_SEND ?? "true").toLowerCase() !== "false",
    sentFolder: env.TITAN_SENT_FOLDER ?? "Sent",
    draftsFolder: env.TITAN_DRAFTS_FOLDER ?? "Drafts",
  };
}

/**
 * Hosted (HTTP) mode: per-user settings come from the user's access token. Hosts are
 * limited to the known presets so a token can never point the server at an arbitrary host.
 */
export function configFromCredentials(c: Credentials): Config {
  const { name, preset } = presetFor(c.provider);
  return {
    user: c.user,
    pass: c.pass,
    provider: name,
    ...preset,
    fromName: c.fromName,
    allowSend: c.allowSend,
    sentFolder: "Sent",
    draftsFolder: "Drafts",
  };
}

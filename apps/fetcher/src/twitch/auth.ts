import fs from 'node:fs';
import { config } from '../config';

const ID_BASE = 'https://id.twitch.tv/oauth2';
const SCOPES = 'editor:manage:clips';

interface TokenFile {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  message?: string;
}

const postForm = async <T>(url: string, body: Record<string, string>) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return { ok: res.ok, data: (await res.json()) as T };
};

const toFile = (t: TokenResponse): TokenFile => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token,
  expires_at: Date.now() + t.expires_in * 1000,
  scope: t.scope,
});

const save = (t: TokenFile) =>
  fs.writeFileSync(config.twitchTokenPath, JSON.stringify(t, null, 2));

const load = (): TokenFile => {
  if (!fs.existsSync(config.twitchTokenPath)) {
    throw new Error(
      `No Twitch token at ${config.twitchTokenPath}; run \`pnpm twitch-login\` first`,
    );
  }
  return JSON.parse(fs.readFileSync(config.twitchTokenPath, 'utf8'));
};

const refresh = async (t: TokenFile): Promise<TokenFile> => {
  const { ok, data } = await postForm<TokenResponse>(`${ID_BASE}/token`, {
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
  });
  if (!ok) {
    throw new Error(
      `Twitch token refresh failed: ${data.message ?? JSON.stringify(data)}`,
    );
  }
  const next = toFile(data);
  save(next);
  return next;
};

// Refreshes when within a minute of expiry, or on demand after a 401.
export const getAccessToken = async (force = false): Promise<string> => {
  let t = load();
  if (force || t.expires_at - Date.now() < 60_000) t = await refresh(t);
  return t.access_token;
};

export const validate = async (token: string) => {
  const res = await fetch(`${ID_BASE}/validate`, {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!res.ok) throw new Error(`Twitch validate failed: ${res.status}`);
  return (await res.json()) as {
    user_id: string;
    login: string;
    scopes: string[];
    expires_in: number;
  };
};

// Device code grant: prints a URL + code for the user to approve in a
// browser, then polls until Twitch hands back tokens.
export const deviceLogin = async (
  onCode: (uri: string, code: string) => void,
): Promise<TokenFile> => {
  const { ok, data: dev } = await postForm<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
    message?: string;
  }>(`${ID_BASE}/device`, { client_id: config.twitchClientId, scopes: SCOPES });
  if (!ok) throw new Error(`Twitch device auth failed: ${dev.message}`);

  onCode(dev.verification_uri, dev.user_code);
  const deadline = Date.now() + dev.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, dev.interval * 1000));
    const { ok, data } = await postForm<TokenResponse>(`${ID_BASE}/token`, {
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret,
      device_code: dev.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (ok) {
      const t = toFile(data);
      save(t);
      return t;
    }
    if (data.message !== 'authorization_pending') {
      throw new Error(`Twitch device auth failed: ${data.message}`);
    }
  }
  throw new Error('Twitch device auth timed out');
};

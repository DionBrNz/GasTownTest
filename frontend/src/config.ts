/** Runtime settings, written to /config.json at deploy time. Nothing here is secret. */
export interface RuntimeConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly clientId: string;
  /** Cognito managed login host name, without a scheme (for example `x.auth.us-east-1.amazoncognito.com`). */
  readonly cognitoDomain: string;
  /** Base URL of the REST API stage, without a trailing slash. */
  readonly apiUrl: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const CLIENT_ID = /^[a-z0-9]{1,128}$/;
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function requireString(raw: Record<string, unknown>, key: keyof RuntimeConfig): string {
  const value = raw[key];
  if (typeof value !== 'string' || value === '') {
    throw new ConfigError(`config.json: "${key}" must be a non-empty string`);
  }
  return value;
}

function requireMatch(key: keyof RuntimeConfig, value: string, pattern: RegExp): void {
  if (!pattern.test(value)) {
    throw new ConfigError(`config.json: "${key}" is not valid`);
  }
}

function parseApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('config.json: "apiUrl" is not a valid URL');
  }
  if (url.protocol !== 'https:' || url.search !== '' || url.hash !== '') {
    throw new ConfigError('config.json: "apiUrl" must be an https URL with no query or fragment');
  }
  return url.href.replace(/\/+$/, '');
}

/** Validates the parsed config.json body. Throws ConfigError on the first problem. */
export function parseConfig(raw: unknown): RuntimeConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('config.json must be a JSON object');
  }
  const record = raw as Record<string, unknown>;
  const region = requireString(record, 'region');
  const userPoolId = requireString(record, 'userPoolId');
  const clientId = requireString(record, 'clientId');
  const cognitoDomain = requireString(record, 'cognitoDomain');
  const apiUrl = requireString(record, 'apiUrl');

  requireMatch('region', region, REGION);
  if (
    !userPoolId.startsWith(`${region}_`) ||
    !/^[A-Za-z0-9]+$/.test(userPoolId.slice(region.length + 1))
  ) {
    throw new ConfigError('config.json: "userPoolId" is not valid for the region');
  }
  requireMatch('clientId', clientId, CLIENT_ID);
  requireMatch('cognitoDomain', cognitoDomain, HOST_NAME);

  return { region, userPoolId, clientId, cognitoDomain, apiUrl: parseApiUrl(apiUrl) };
}

/** Fetches and validates /config.json. Always goes to the network (no HTTP cache). */
export async function loadConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchFn('/config.json', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new ConfigError(`Could not load /config.json (HTTP ${String(response.status)})`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ConfigError('config.json is not valid JSON');
  }
  return parseConfig(body);
}

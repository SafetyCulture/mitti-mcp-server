/**
 * Startup configuration, resolved from the environment.
 *
 * Pulled out of index.ts so the required-token check and the SC_API_URL
 * default/endpoint construction can be tested directly, without touching
 * real transports or process.exit.
 */

export interface Config {
  token: string;
  baseUrl: string;
  endpoint: URL;
}

const DEFAULT_BASE_URL = 'https://api.safetyculture.com';

/** Throws a plain Error describing what's wrong; index.ts turns that into a fatal exit. */
export function resolveConfig(env: NodeJS.ProcessEnv): Config {
  const token = env.SC_API_TOKEN;
  if (!token) {
    throw new Error('SC_API_TOKEN is required (a SafetyCulture API token, e.g. "scapi_…").');
  }

  const baseUrl = env.SC_API_URL ?? DEFAULT_BASE_URL;
  const endpoint = new URL('/agents/v1/mcp', baseUrl);
  return { token, baseUrl, endpoint };
}

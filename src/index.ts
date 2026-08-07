#!/usr/bin/env node
/**
 * sc-mcp — SafetyCulture MCP proxy.
 *
 * Bridges a local stdio MCP client (Claude Desktop, Cursor, MCP Inspector, …)
 * to the SafetyCulture MCP endpoint using a SafetyCulture API token — no OAuth.
 *
 * JSON-RPC messages are piped between the stdio transport (the local client) and
 * a Streamable-HTTP transport (the remote SafetyCulture MCP server), with the API
 * token attached as a bearer on every request. The client drives the MCP protocol
 * (initialize, tools/list, tools/call, …); this process moves messages across the
 * boundary and enforces one policy: **only read-only tools are exposed.**
 *
 * `tools/list` responses are filtered down to tools that declare
 * `readOnlyHint: true`, and `tools/call` requests for anything else are rejected
 * here without reaching SafetyCulture. See read-only.ts for the policy, and
 * bridge.ts for how the relay enforces it on every message that crosses it —
 * only recognised methods and well-formed requests get through; the rest is
 * refused, not passed through by default.
 *
 * Config (env):
 *   SC_API_TOKEN  (required)  SafetyCulture API token (e.g. "scapi_…").
 *   SC_API_URL    (optional)  API base URL. Default: https://api.safetyculture.com
 */
/// <reference types="node" />
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge } from './bridge.js';
import { resolveConfig } from './config.js';
import { assertNotServiceUser } from './token-guard.js';

function log(message: string): void {
  // Logs MUST go to stderr — stdout is the MCP transport channel.
  process.stderr.write(`sc-mcp: ${message}\n`);
}

function fatal(message: string): never {
  log(message);
  process.exit(1);
}

let config;
try {
  config = resolveConfig(process.env);
} catch (error: unknown) {
  fatal(error instanceof Error ? error.message : String(error));
}
const { token, baseUrl, endpoint } = config;

const remote = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: { Authorization: `Bearer ${token}` },
  },
});
const local = new StdioServerTransport();

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.allSettled([local.close(), remote.close()]);
  process.exit(code);
}

createBridge(local, remote, log);

local.onclose = () => void shutdown(0);
remote.onclose = () => void shutdown(0);
local.onerror = (error) => log(`stdio error: ${error.message}`);
remote.onerror = (error) => log(`remote error: ${error.message}`);

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// Reject service-user tokens before opening the relay — see token-guard.ts.
try {
  const seatType = await assertNotServiceUser(baseUrl, token);
  log(`token seat type: ${seatType}`);
} catch (error: unknown) {
  fatal(`refusing to start — ${error instanceof Error ? error.message : String(error)}`);
}

try {
  await remote.start();
} catch (error: unknown) {
  fatal(`failed to connect to ${endpoint.href} — check SC_API_TOKEN and SC_API_URL. ${error instanceof Error ? error.message : String(error)}`);
}
await local.start();
log(`proxying stdio → ${endpoint.href}`);

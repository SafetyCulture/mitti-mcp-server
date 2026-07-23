#!/usr/bin/env node
/**
 * sc-mcp — SafetyCulture MCP proxy.
 *
 * Bridges a local stdio MCP client (Claude Desktop, Cursor, MCP Inspector, …)
 * to the SafetyCulture MCP endpoint using a SafetyCulture API token — no OAuth.
 *
 * It's a transparent, protocol-agnostic relay: raw JSON-RPC messages are piped
 * between the stdio transport (the local client) and a Streamable-HTTP transport
 * (the remote SafetyCulture MCP server), with the API token attached as a bearer
 * on every request. The client drives the MCP protocol (initialize, tools/list,
 * tools/call, …); this process just moves messages across the boundary.
 *
 * Config (env):
 *   SC_API_TOKEN  (required)  SafetyCulture API token (e.g. "scapi_…").
 *   SC_API_URL    (optional)  API base URL. Default: https://api.safetyculture.com
 */
/// <reference types="node" />
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

const token = process.env.SC_API_TOKEN;
const baseUrl = process.env.SC_API_URL ?? 'https://api.safetyculture.com';

function log(message: string): void {
  // Logs MUST go to stderr — stdout is the MCP transport channel.
  process.stderr.write(`sc-mcp: ${message}\n`);
}

function fatal(message: string): never {
  log(message);
  process.exit(1);
}

if (!token) {
  fatal('SC_API_TOKEN is required (a SafetyCulture API token, e.g. "scapi_…").');
}

const endpoint = new URL('/agents/v1/mcp', baseUrl);

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

// Transparent bridge: relay every JSON-RPC message in both directions.
local.onmessage = (message: JSONRPCMessage) => {
  remote.send(message).catch((error: unknown) => {
    log(`error forwarding to SafetyCulture: ${error instanceof Error ? error.message : String(error)}`);
  });
};
remote.onmessage = (message: JSONRPCMessage) => {
  local.send(message).catch((error: unknown) => {
    log(`error forwarding to client: ${error instanceof Error ? error.message : String(error)}`);
  });
};

local.onclose = () => void shutdown(0);
remote.onclose = () => void shutdown(0);
local.onerror = (error) => log(`stdio error: ${error.message}`);
remote.onerror = (error) => log(`remote error: ${error.message}`);

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  await remote.start();
} catch (error: unknown) {
  fatal(`failed to connect to ${endpoint.href} — check SC_API_TOKEN and SC_API_URL. ${error instanceof Error ? error.message : String(error)}`);
}
await local.start();
log(`proxying stdio → ${endpoint.href}`);

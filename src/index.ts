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
 * here without reaching SafetyCulture. See read-only.ts for the policy. Every
 * other message passes through untouched.
 *
 * Config (env):
 *   SC_API_TOKEN  (required)  SafetyCulture API token (e.g. "scapi_…").
 *   SC_API_URL    (optional)  API base URL. Default: https://api.safetyculture.com
 */
/// <reference types="node" />
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ErrorCode,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResponse,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  JSONRPCMessage,
  JSONRPCResultResponse,
  RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import { classifyTool } from './read-only.js';
import { assertNotServiceUser } from './token-guard.js';

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

function toRemote(message: JSONRPCMessage): void {
  remote.send(message).catch((error: unknown) => {
    log(`error forwarding to SafetyCulture: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function toLocal(message: JSONRPCMessage): void {
  local.send(message).catch((error: unknown) => {
    log(`error forwarding to client: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** Ids of in-flight `tools/list` requests, so their responses can be filtered. */
const pendingToolsList = new Set<string>();
/** Read-only verdicts learned from `tools/list`, keyed by tool name. */
const verdicts = new Map<string, boolean>();

// Request ids may be strings or numbers; keep the two apart.
const idKey = (id: RequestId): string => `${typeof id}:${id}`;

/** Drop every non-read-only tool from a `tools/list` result, remembering each verdict. */
function filterToolsList(response: JSONRPCResultResponse): JSONRPCMessage {
  const tools = response.result.tools;
  if (!Array.isArray(tools)) return response;

  const allowed: unknown[] = [];
  const blocked: string[] = [];
  for (const tool of tools) {
    const verdict = classifyTool(tool);
    const name = (tool as { name?: unknown })?.name;
    if (typeof name === 'string') verdicts.set(name, verdict.readOnly);
    if (verdict.readOnly) allowed.push(tool);
    else blocked.push(`${String(name)} (${verdict.reason})`);
  }

  if (blocked.length > 0) {
    log(`tools/list: exposing ${allowed.length} read-only tool(s), hiding ${blocked.length}: ${blocked.join(', ')}`);
  } else {
    log(`tools/list: exposing ${allowed.length} read-only tool(s)`);
  }
  return { ...response, result: { ...response.result, tools: allowed } };
}

// Bridge: relay JSON-RPC in both directions, enforcing the read-only policy on tools.
local.onmessage = (message: JSONRPCMessage) => {
  if (isJSONRPCRequest(message)) {
    if (message.method === 'tools/list') {
      pendingToolsList.add(idKey(message.id));
    } else if (message.method === 'tools/call') {
      const name = (message.params as { name?: unknown } | undefined)?.name;
      if (typeof name !== 'string') {
        // Malformed — let SafetyCulture produce the protocol error.
        toRemote(message);
        return;
      }
      // Only tools seen in a tools/list and proven read-only there may be
      // called. A name we've never judged tells us nothing, so it's blocked.
      const verdict = verdicts.get(name);
      if (verdict !== true) {
        const why = verdict === false ? 'not a read-only tool' : 'not a known read-only tool';
        log(`blocked tools/call "${name}": ${why}`);
        toLocal({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: ErrorCode.InvalidParams,
            message:
              `Tool "${name}" is not available: this proxy exposes only SafetyCulture tools ` +
              `that declare readOnlyHint. Call tools/list for the tools you can use.`,
          },
        });
        return;
      }
    }
  }
  toRemote(message);
};

remote.onmessage = (message: JSONRPCMessage) => {
  if (isJSONRPCResponse(message) && pendingToolsList.delete(idKey(message.id))) {
    toLocal(filterToolsList(message));
    return;
  }
  // A failed tools/list has nothing to filter — just stop tracking it.
  if (isJSONRPCErrorResponse(message) && message.id != null) {
    pendingToolsList.delete(idKey(message.id));
  }
  toLocal(message);
};

local.onclose = () => void shutdown(0);
remote.onclose = () => void shutdown(0);
local.onerror = (error) => log(`stdio error: ${error.message}`);
remote.onerror = (error) => log(`remote error: ${error.message}`);

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// Reject service-user tokens before opening the relay — see token-guard.ts.
try {
  const { seatType, cached } = await assertNotServiceUser(baseUrl, token);
  log(`token seat type: ${seatType}${cached ? ' (cached)' : ''}`);
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

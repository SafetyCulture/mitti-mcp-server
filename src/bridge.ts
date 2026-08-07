/**
 * The relay: pipes JSON-RPC between the local stdio client and the remote
 * SafetyCulture transport, enforcing the read-only policy.
 *
 * The policy only means anything if the relay itself fails closed. Two rules
 * follow from that:
 *
 *   1. `tools/call` is never forwarded unless the message is a well-formed
 *      JSON-RPC *request* (has an `id`) — only then can `isJSONRPCRequest`
 *      even run, and only requests get policy-checked below. A same-shaped
 *      *notification* (no `id`) parses fine per the MCP schema but must
 *      never reach SafetyCulture: nothing consults `verdicts` for it.
 *   2. Every other method is relayed only if it's on an explicit allowlist.
 *      New MCP surface (upstream additions, protocol revisions) fails closed
 *      by default instead of silently inheriting a free pass.
 *
 * `read-only.ts` already refuses to infer a tool's safety from anything but
 * its annotations. This module applies that same "recognise and permit;
 * otherwise refuse" rule to the message surface itself.
 */
import {
  ErrorCode,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  isJSONRPCErrorResponse,
} from '@modelcontextprotocol/sdk/types.js';
import type { JSONRPCMessage, JSONRPCResultResponse, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { classifyTool } from './read-only.js';

/** The slice of the SDK's Transport that the bridge actually uses. */
export interface BridgeTransport {
  send(message: JSONRPCMessage): Promise<void>;
  onmessage?: (message: JSONRPCMessage) => void;
}

/**
 * Request methods relayed to SafetyCulture without further inspection —
 * reads, plus `tools/call`, which gets its own policy check below. Notably
 * absent: `completion/complete` and the `tasks/*` family, neither of which
 * is obviously bounded to reads.
 */
const RELAYED_REQUEST_METHODS = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
  'prompts/get',
]);

/** Notifications a well-behaved client sends; the rest are dropped. */
const RELAYED_NOTIFICATION_METHODS = new Set([
  'notifications/initialized',
  'notifications/cancelled',
  'notifications/progress',
  'notifications/roots/list_changed',
]);

// Request ids may be strings or numbers; keep the two apart.
const idKey = (id: RequestId): string => `${typeof id}:${id}`;

/** Wire the two transports together, enforcing the read-only policy in both directions. */
export function createBridge(local: BridgeTransport, remote: BridgeTransport, log: (message: string) => void): void {
  /** Ids of in-flight `tools/list` requests, so their responses can be filtered. */
  const pendingToolsList = new Set<string>();
  /** Read-only verdicts learned from `tools/list`, keyed by tool name. */
  const verdicts = new Map<string, boolean>();

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

  function rejectLocally(id: RequestId, code: ErrorCode, message: string): void {
    toLocal({ jsonrpc: '2.0', id, error: { code, message } });
  }

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

  local.onmessage = (message: JSONRPCMessage) => {
    const method = (message as { method?: unknown }).method;

    if (method === 'tools/call') {
      // A tools/call that isn't a well-formed request can't be policy-checked
      // below, so it never reaches SafetyCulture. This also catches the
      // notification-shaped variant (same method, no id) that would
      // otherwise fall through every check here.
      if (!isJSONRPCRequest(message)) {
        log('blocked tools/call: not a well-formed request (missing id) — not forwarded');
        return;
      }

      const name = (message.params as { name?: unknown } | undefined)?.name;
      if (typeof name !== 'string') {
        log('blocked tools/call: tool name is not a string');
        rejectLocally(message.id, ErrorCode.InvalidParams, 'Tool name must be a string.');
        return;
      }

      // Only tools seen in a tools/list and proven read-only there may be
      // called. A name we've never judged tells us nothing, so it's blocked.
      const verdict = verdicts.get(name);
      if (verdict !== true) {
        const why = verdict === false ? 'not a read-only tool' : 'not a known read-only tool';
        log(`blocked tools/call "${name}": ${why}`);
        rejectLocally(
          message.id,
          ErrorCode.InvalidParams,
          `Tool "${name}" is not available: this proxy exposes only SafetyCulture tools ` +
            `that declare readOnlyHint. Call tools/list for the tools you can use.`
        );
        return;
      }

      toRemote(message);
      return;
    }

    if (isJSONRPCRequest(message)) {
      if (!RELAYED_REQUEST_METHODS.has(method as string)) {
        log(`blocked request: unrecognised method "${String(method)}"`);
        rejectLocally(message.id, ErrorCode.MethodNotFound, `Method "${String(method)}" is not supported by this proxy.`);
        return;
      }
      if (method === 'tools/list') {
        pendingToolsList.add(idKey(message.id));
      }
      toRemote(message);
      return;
    }

    if (isJSONRPCNotification(message) && RELAYED_NOTIFICATION_METHODS.has(method as string)) {
      toRemote(message);
      return;
    }

    log(`blocked unrecognised message (method: ${String(method)})`);
  };

  remote.onmessage = (message: JSONRPCMessage) => {
    if (isJSONRPCResultResponse(message) && pendingToolsList.delete(idKey(message.id))) {
      toLocal(filterToolsList(message));
      return;
    }
    // A failed tools/list has nothing to filter — just stop tracking it.
    if (isJSONRPCErrorResponse(message) && message.id != null) {
      pendingToolsList.delete(idKey(message.id));
    }
    toLocal(message);
  };
}

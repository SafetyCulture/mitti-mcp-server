# sc-mcp

A tiny proxy that lets any MCP client talk to the **SafetyCulture MCP** using a
**SafetyCulture API token** — no OAuth, no browser.

Only **read-only** tools are exposed — see [Read-only tools](#read-only-tools).

## Usage
### Getting an API token

`SC_API_TOKEN` is a SafetyCulture API token generated from your user account.
Follow the official guide to create one:
**[Generate a SafetyCulture API token](https://help.safetyculture.com/000007)**.

Can be generated here: [app.safetyculture.com/account/api-tokens](https://app.safetyculture.com/account/api-tokens)

The token carries **your** permissions, so treat it like a password and revoke it
when no longer needed. The proxy narrows what a client can do with it to reads
only — but the token itself is still fully privileged against the SafetyCulture
API if it leaks.

### Config (environment)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `SC_API_TOKEN` | yes | — | A SafetyCulture API token — see [Getting an API token](#getting-an-api-token). |
| `SC_API_URL` | no | `https://api.safetyculture.com` | API base URL. Point at a non-prod env for testing, e.g. `https://api.slate.scinfradev.com`. |


### Claude

You can run the following command to add the MCP server:
```
claude mcp add safetyculture --env SC_API_TOKEN=scapi_xxx -- npx -y git+ssh://git@github.com/SafetyCulture/mitti-mcp-server.git
```

### In an MCP client (e.g. Claude Desktop)
Add an entry to `claude_desktop_config.json` as shown in the following example:

```json
{
  "mcpServers": {
    "safetyculture": {
      "command": "npx",
      "args": ["-y", "git+ssh://git@github.com/SafetyCulture/mitti-mcp-server.git"],
      "env": { "SC_API_TOKEN": "scapi_xxx" }
    }
  }
}
```

## Read-only tools

The proxy exposes only tools that read state. SafetyCulture's write tools —
creating inspections, updating issues, assigning actions, and so on — are hidden
and cannot be called through it.

This is enforced on both sides of the conversation:

- **`tools/list`** responses are filtered, so a client never sees a write tool.
- **`tools/call`** requests for anything else are rejected by the proxy with a
  JSON-RPC `-32602` error. The call never reaches SafetyCulture, so a client that
  hardcodes a tool name instead of listing first is still blocked.

The rule is deliberately narrow ([`src/read-only.ts`](src/read-only.ts)): a tool
is exposed **only if it declares `annotations.readOnlyHint: true`.** Everything
else is assumed to write — including tools with no annotations at all, whose
behaviour we can't know.

Nothing is inferred from tool names. Against the live server,
`content_library_get_course` reads as read-only by name but is annotated
`readOnlyHint: false`; a name-based guess would have exposed a write tool. An
unannotated tool is a gap in the upstream server's metadata, and the fix belongs
there — annotate the tool — not in a guess here.

Today that means **91 of 210** upstream tools are exposed: 91 declare
`readOnlyHint: true`, 28 declare `false`, and 91 carry no annotations. Logs name
every hidden tool and why:

```
sc-mcp: tools/list: exposing 91 read-only tool(s), hiding 119: sites_create (readOnlyHint is false), sensors_search (no annotations — assumed to write), …
```

Because `tools/call` is checked against what a `tools/list` proved, a tool that
was never listed is also blocked. Clients that list before calling — all the
common ones — are unaffected.

Run `npm test` to exercise the policy.

## How it works

```
MCP client  ──stdio (JSON-RPC)──▶  sc-mcp  ──HTTPS + Bearer token──▶  api.safetyculture.com/agents/v1/mcp
            ◀──── read-only ─────           ◀────────────────────────
                   tools only
```

Logs go to **stderr** (stdout is reserved for the MCP transport).

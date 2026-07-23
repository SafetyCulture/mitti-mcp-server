# sc-mcp

A tiny proxy that lets any MCP client talk to the **SafetyCulture MCP** using a
**SafetyCulture API token** — no OAuth, no browser.

It bridges your local MCP client (which speaks MCP over stdio) to the remote
SafetyCulture MCP endpoint (`/agents/v1/mcp`, Streamable HTTP), attaching your
API token as a bearer on every request. It's a transparent JSON-RPC relay — the
client drives the protocol; this process just moves messages across.

## Usage

Run straight from GitHub (no npm publish needed):

```bash
SC_API_TOKEN=scapi_xxx npx -y git+ssh://git@github.com/SafetyCulture/mitti-mcp-server.git
```

Once published to npm it simplifies to:

```bash
SC_API_TOKEN=scapi_xxx npx -y sc-mcp
```

### Getting an API token

`SC_API_TOKEN` is a SafetyCulture API token generated from your user account.
Follow the official guide to create one:
**[Generate a SafetyCulture API token](https://help.safetyculture.com/000007)**.

The token carries **your** permissions — the MCP client can do whatever your
account can. Treat it like a password, and revoke it when no longer needed.

### Config (environment)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `SC_API_TOKEN` | yes | — | A SafetyCulture API token — see [Getting an API token](#getting-an-api-token). |
| `SC_API_URL` | no | `https://api.safetyculture.com` | API base URL. Point at a non-prod env for testing, e.g. `https://api.slate.scinfradev.com`. |

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

## How it works

```
MCP client  ──stdio (JSON-RPC)──▶  sc-mcp  ──HTTPS + Bearer token──▶  api.safetyculture.com/agents/v1/mcp
            ◀──────────────────           ◀────────────────────────
```

Logs go to **stderr** (stdout is reserved for the MCP transport).

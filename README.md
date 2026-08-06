# sc-mcp

A tiny proxy that lets any MCP client talk to the **SafetyCulture MCP** using a
**SafetyCulture API token**.

Only **read-only** tools are exposed.

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

Logs go to **stderr** (stdout is reserved for the MCP transport).

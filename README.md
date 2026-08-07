# mitti-mcp-server

A tiny proxy that lets any MCP client talk to the **Mitti MCP** using a
**Mitti User API token**.

Only **read-only** tools are exposed, and only to a token that belongs to a
person. Tokens belonging to service accounts are rejected.

## Usage
### Getting an API token

`MITTI_API_TOKEN` is a Mitti API token generated from your user account.
Follow the official guide to create one:
**[Generate an API token](https://help.safetyculture.com/000007)**.

Can be generated here: [app.safetyculture.com/account/api-tokens](https://app.safetyculture.com/account/api-tokens)

The token carries **your** permissions, so treat it like a password and revoke it
when no longer needed. The proxy narrows what a client can do with it to reads
only — but the token itself is still fully privileged against the Mitti
API if it leaks.

### Config (environment)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `MITTI_API_TOKEN` | yes | — | A Mitti API token — see [Getting an API token](#getting-an-api-token). |
| `MITTI_API_URL` | no | `https://api.safetyculture.com` | API base URL. Only change this if you have been given an alternative endpoint. |

The default API hostname is unchanged — the rebrand moved no endpoints, so
existing tokens and URLs keep working exactly as before.

> Previously these were named `SC_API_TOKEN` and `SC_API_URL`. The old names are
> no longer read; if you have them set, rename them.

### Prerequisites

Both setups below use `npx`, which ships with **Node.js** — you need **Node 20
or newer** installed. Check what you have with:

```
node --version
```

If that errors, or reports below v20, install it from
**[nodejs.org/en/download](https://nodejs.org/en/download)** (the LTS build is
the safe default). macOS users with Homebrew can instead run `brew install node`.

### Claude

You can run the following command to add the MCP server:
```
claude mcp add mitti --env MITTI_API_TOKEN=TOKEN_GOES_HERE -- npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz
```

### In an MCP client (e.g. Claude Desktop)
Add an entry to `claude_desktop_config.json` as shown in the following example:

```json
{
  "mcpServers": {
    "mitti": {
      "command": "npx",
      "args": [
        "-y",
        "https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz"
      ],
      "env": { "MITTI_API_TOKEN": "TOKEN_GOES_HERE" }
    }
  }
}
```

`latest/download` always resolves to the newest release. To pin a version, swap
it for a tag — for example
`.../releases/download/v0.2.0/mitti-mcp-0.2.0.tgz`.

The release tarball is a prebuilt, dependency-free bundle: installing it pulls
in no transitive packages and needs no build toolchain.

Logs go to **stderr** (stdout is reserved for the MCP transport).

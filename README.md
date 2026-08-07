# mitti-mcp-server

A tiny proxy that lets any MCP client talk to the **SafetyCulture MCP** using a
**SafetyCulture User API token**.

Only **read-only** tools are exposed, and only to a token that belongs to a
person. Tokens belonging to service accounts are rejected.

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
| `SC_API_URL` | no | `https://api.safetyculture.com` | API base URL. Only change this if you have been given an alternative endpoint. |


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
claude mcp add safetyculture --env SC_API_TOKEN=scapi_xxx -- npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/sc-mcp.tgz
```

### In an MCP client (e.g. Claude Desktop)
Add an entry to `claude_desktop_config.json` as shown in the following example:

```json
{
  "mcpServers": {
    "safetyculture": {
      "command": "npx",
      "args": [
        "-y",
        "https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/sc-mcp.tgz"
      ],
      "env": { "SC_API_TOKEN": "scapi_xxx" }
    }
  }
}
```

`latest/download` always resolves to the newest release. To pin a version, swap
it for a tag — for example
`.../releases/download/v0.1.2/sc-mcp-0.1.2.tgz`.

The release tarball is a prebuilt, dependency-free bundle: installing it pulls
in no transitive packages and needs no build toolchain.

Logs go to **stderr** (stdout is reserved for the MCP transport).

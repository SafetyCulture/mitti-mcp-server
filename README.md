# Mitti MCP

Connect your Mitti data to the AI tools you already use. Ask questions in plain language and get answers from your Mitti account.

---

## Important — read this first

**This is a pre-Early Access trial, by invitation only.**

We're testing with a small group of customers before we build the full version. If we haven't reached out to you, this isn't available for your account just yet — please get in touch with your Mitti account contact and we'll note your interest.

**If you have been invited to test, here are the key things you need to know:**

1. **It respects your existing user permissions.** It can only access what your account already has access to in Mitti, nothing more. It doesn't widen your access, and it can't see anything on behalf of anyone else.
2. **It only has read access.** Your AI tool can't create, edit, or delete anything in your account. This is a safety precaution for now, to avoid accidental data loss. Write access will be available in a future iteration.
3. **This is a short-term trial.** This version is just for pre-Early Access testing and will be deprecated once a better version is ready.
4. **It might break.** As this is pre-Early Access, expect it to be rough around the edges. Your feedback will help make it better.
5. **It isn't covered by standard support.** Don't raise a support ticket — come straight to us by replying to the email that brought you here.

You're getting it early because your feedback helps us decide what to build next.

---

## Setup

Follow these steps to get started.

### Step 1 — Create your API token

Go to [app.safetyculture.com/account/api-tokens](https://app.safetyculture.com/account/api-tokens) and generate a token from your own account. Here's a full [help article](https://help.safetyculture.com/000007).

It must be an API token for your user account, not a service account token.

**Treat the token like a password — the token itself provides full read <u>and write</u> access to your account, even though the connector limits your AI tool to reading:**
- Do not share it with anyone.
- Store it somewhere safe while you complete setup.
- If you have security concerns at any point, revoke it by going back to [app.safetyculture.com/account/api-tokens](https://app.safetyculture.com/account/api-tokens).

### Step 2 — Check you have Node.js

The connector runs locally on your computer, and Node.js is what runs it.

1. Open a terminal: Terminal on a Mac, Command Prompt or PowerShell on Windows
2. Type `node --version` and hit enter

If it says `v20` or higher, proceed to Step 3.

If it errors or shows an older version, download the installer from [nodejs.org/en/download](https://nodejs.org/en/download) and follow the steps.

### Step 3 — Connect your AI tool

Mitti MCP is a standard MCP server, so in principle it works with any tool that supports MCP.

We've done most of our testing in Claude, and some light testing in Gemini and Codex. We haven't put these through all their paces yet, so tell us what you find.

**In every case, swap `TOKEN_GOES_HERE` for the token you generated in Step 1.**

<details open>
<summary><b>Claude Code</b></summary>

After you've swapped in your token, paste this into your terminal and hit enter.
```
claude mcp add mitti --env MITTI_API_TOKEN=TOKEN_GOES_HERE -- npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz
```
Then **open a <u>new</u> Claude Code session**, wait for the Mitti MCP to connect, and you're on your way.

</details>

<details>
<summary><b>Claude Desktop</b></summary>

1. Go to Settings → Developer and click Edit Config
2. Open `claude_desktop_config.json`
3. Add the `mitti` entry alongside anything already in the file, within the `mcpServers` section:

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

Restart Claude Desktop afterwards.

</details>

<details>
<summary><b>Codex CLI (OpenAI)</b></summary>

After you've swapped in your token, paste this into your terminal and hit enter.

```
codex mcp add mitti --env MITTI_API_TOKEN=TOKEN_GOES_HERE -- npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz
```
Then **open a <u>new</u> Codex session**, wait for the Mitti MCP to connect, and you're on your way.

</details>

<details>
<summary><b>Gemini CLI</b></summary>

After you've swapped in your token, paste this into your terminal and hit enter.

```
gemini mcp add -s user -e MITTI_API_TOKEN=TOKEN_GOES_HERE mitti npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz
```

Then **open a <u>new</u> Gemini session**, wait for the Mitti MCP to connect, and you're on your way.

</details>

<details>
<summary><b>Antigravity — app or CLI (Google)</b></summary>

The app and the CLI (`agy`) share one config file, so this covers both. There's no link to it from inside the app, so the quickest way is to open it from a terminal.

**On a Mac** — paste this into Terminal and hit enter:

```
mkdir -p ~/.gemini/config && touch ~/.gemini/config/mcp_config.json && open -e ~/.gemini/config/mcp_config.json
```

**On Windows** — paste this into Command Prompt and hit enter:

```
mkdir "%USERPROFILE%\.gemini\config" 2>nul & notepad "%USERPROFILE%\.gemini\config\mcp_config.json"
```

The file opens in a plain text editor. If it's empty, paste in the whole block below. If it already has something in it, add the `mitti` entry inside the existing `mcpServers` section:

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

Save the file, then restart Antigravity, or start a new `agy` session if you're using the CLI.

</details>

<details>
<summary><b>Another tool</b></summary>

Any MCP client will accept the same three details — check its documentation for where they go:

| | |
| --- | --- |
| Command | `npx` |
| Arguments | `-y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz` |
| Environment | `MITTI_API_TOKEN=TOKEN_GOES_HERE` |

</details>

### Step 4 — Check it worked

Your tool should list `mitti` as connected — in Claude Code, run `/mcp`; in the desktop apps, look for the tools or connectors indicator.

Then ask it something simple:

> *"Using Mitti, how many inspections were completed in the last 7 days?"*

A number back means you're running. If not, see [Troubleshooting](#troubleshooting).

The first time it uses a Mitti tool, your AI tool will probably ask permission. That's your tool being careful, not an error.

---

## What you can ask

Talk to your AI tool the way you normally would — it works out which Mitti data to pull.

- *"How many inspections were completed at each site last month?"*
- *"Show me every overdue action assigned to the maintenance team."*
- *"What are the most common issue categories in the last 90 days?"*

## Things to keep in mind

**It only reads.** Your AI tool is offered read-only tools and nothing else, so it can't create, edit, or delete anything.

**Your token has full access to your account.** The read-only limit applies to what your AI tool can do through this connector. The token itself remains fully privileged against the Mitti API, so don't paste it into shared documents or pass it around. Revoke it any time at [app.safetyculture.com/account/api-tokens](https://app.safetyculture.com/account/api-tokens).

**Your data goes to your AI provider.** Anything your AI tool reads from Mitti becomes part of that conversation, under whatever agreement you have with them.

## Give us feedback

We're hungry for your feedback, so please share it with us — the good and the bad.

Reply to the email that brought you here. That reaches us directly and it's the fastest way to get help if something's broken.

Most useful to us:
- What did you try, and did it work?
- What was missing?
- Anything slow, wrong, or confusing.

Rough notes are fine, screenshots better. We'd rather have something scrappy today than something polished when you have time to draft a proper email.

## Troubleshooting

**"MITTI_API_TOKEN is not set"** — the token didn't reach the connector. Redo Step 3 and check for a typo in the `env` section.

**"This token belongs to a service user"** — that's a service account token. Generate one from your own account instead (Step 1).

**`spawn npx ENOENT` on Windows** — on Windows outside WSL, some tools can't launch `npx` directly. Wrap it: `-- cmd /c npx -y <url>` on the command line, or in JSON set `"command": "cmd"` with `"args": ["/c", "npx", "-y", "<url>"]`.

**Nothing happens, or it won't start** — check `node --version` reports v20 or newer. This is the most common cause.

**A tool you expected isn't there** — most likely it isn't marked read-only upstream, so this trial hides it. Tell us which one.

Still stuck? Reply to our email and we'll work it out with you.

## For the technically curious

This repo is a small stdio proxy. Your AI tool launches it locally; it forwards requests to the Mitti MCP endpoint using your token and returns the responses. It stores nothing.

Two guardrails run inside it:

- **Read-only filtering** — a tool is exposed only if it declares `annotations.readOnlyHint: true`. Anything unannotated is treated as capable of writing and hidden; we don't guess from names. See [`src/read-only.ts`](src/read-only.ts).
- **Personal tokens only** — at startup it resolves the token's seat type and refuses service accounts. See [`src/token-guard.ts`](src/token-guard.ts).

Both are trial guardrails living in this proxy rather than enforced by the API, which is part of why this version is time-limited. Scoped, consent-based enforcement is what the OAuth version is for.

Logs go to stderr; stdout is reserved for the MCP transport.

Installs pull a prebuilt, dependency-free bundle from the GitHub release — no transitive packages, no build toolchain. `latest/download` always resolves to the newest release; to pin a version, use a tag instead, for example `.../releases/download/v0.2.0/mitti-mcp-0.2.0.tgz`.

Licensed under Apache-2.0.

<details>
<summary>Upgrading from an earlier build</summary>

The environment variables were previously `SC_API_TOKEN` and `SC_API_URL`. The old names are no longer read — rename them to `MITTI_API_TOKEN` and `MITTI_API_URL`.

</details>

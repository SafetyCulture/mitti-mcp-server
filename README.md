# Mitti MCP

Connect your Mitti data to the AI tools you already use. Ask questions in plain
language in Claude, Codex, Gemini, or any other MCP client, and get answers from
your own inspections, actions, issues, assets, and training records — without
exporting anything or switching tabs.

> ### This is a pre early access trial, by invitation
>
> We're testing this with a small handful of customers before building the
> full version. If you're one of them, welcome — everything you need is below.
>
> If you found this repo on your own: it isn't generally available yet, and
> nothing here is supported for production use. Speak to your Mitti account
> contact if you'd like to be part of a future round.

## What you can ask

Once it's connected, you talk to your AI tool the way you normally would. It
figures out which Mitti data to pull.

- *"How many inspections were completed at each site last month, and which sites
  are trending down?"*
- *"Show me every overdue action assigned to the maintenance team, grouped by
  priority."*
- *"What are the most common issue categories reported in the last 90 days?"*
- *"Which of our assets are due for servicing in the next fortnight?"*
- *"Who's missing a required certification for the night shift roster?"*
- *"Pull the last three forklift inspections and draft a summary for tomorrow's
  toolbox talk."*

There are over 150 read-only tools available, spanning inspections, actions,
issues, assets and maintenance, templates, schedules, training and courses,
documents, analytics, sites and org structure, users and permissions,
contractors, and credentials.

The real value shows up when you combine Mitti with everything else your AI tool
can reach — your own spreadsheets, another system's API, a local repo of
documents. That's what we're most curious to see you try.

**What it won't do:** build or edit templates, or change anything at all in your
account. This trial is read-only by design (see
[What it can and can't do](#what-it-can-and-cant-do)).

## What "pre early access" means

Please read this bit — it's the honest version.

- **It's temporary.** This version authenticates with a long-lived API token.
  We're already building the real thing, which will use OAuth with proper scoped
  consent, so you can decide exactly what an AI tool is allowed to see. When that
  lands, this version goes away.
- **It might break.** It hasn't been through the hardening a generally available
  product gets. Expect rough edges.
- **It isn't covered by standard support.** Don't raise a support ticket if
  something goes wrong — come straight to us instead (see
  [Telling us how it went](#telling-us-how-it-went)).
- **It may change or be withdrawn** at short notice.

You're getting this early because your feedback shapes what we build next. That's
the whole point of the trial.

## Before you start

You'll need three things.

**1. Node.js 20 or newer.** Check what you have:

```
node --version
```

If that errors or reports anything below v20, install it from
[nodejs.org/en/download](https://nodejs.org/en/download) — the LTS build is the
safe default. On a Mac with Homebrew, `brew install node` also works.

**2. Your own Mitti API token.** Generate it from your own user account at
[app.safetyculture.com/account/api-tokens](https://app.safetyculture.com/account/api-tokens),
or follow the [step-by-step guide](https://help.safetyculture.com/000007).

**3. An AI tool that speaks MCP** — Claude Code, Claude Desktop, Codex CLI,
Gemini CLI, or similar.

> **Use your own token, not a service account.** Service account tokens are
> usually far more privileged than any individual person, and this trial rejects
> them at startup. For the same reason, please don't ask an admin to generate a
> token on your behalf and pass it around. If you can't create your own token,
> you're better off waiting for the OAuth version.

## Setting it up

Pick your tool below. Each command is complete — swap `TOKEN_GOES_HERE` for the
token you just generated, then paste it into your terminal.

### Claude Code

```
claude mcp add mitti --env MITTI_API_TOKEN=TOKEN_GOES_HERE -- npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz
```

### Codex CLI

```
codex mcp add mitti --env MITTI_API_TOKEN=TOKEN_GOES_HERE -- npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz
```

### Gemini CLI

```
gemini mcp add -s user -e MITTI_API_TOKEN=TOKEN_GOES_HERE mitti npx -y https://github.com/SafetyCulture/mitti-mcp-server/releases/latest/download/mitti-mcp.tgz
```

Drop `-s user` if you only want Mitti available in the current project.

### Claude Desktop, Antigravity, and other clients

These read a JSON config file rather than taking a command. Add a `mitti` entry
alongside anything already there:

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

The file to edit:

| Client | File |
| --- | --- |
| Claude Desktop | `claude_desktop_config.json` (Settings → Developer → Edit Config) |
| Antigravity | `~/.gemini/config/mcp_config.json` |
| Other clients | Check your client's MCP documentation |

Restart the app afterwards so it picks up the change.

## Checking it worked

Your client should list `mitti` as connected — in Claude Code, run
`/mcp`; in the desktop apps, look for the tools or connectors indicator.

Then try the simplest possible question:

> *"Using Mitti, how many inspections were completed in the last 7 days?"*

If you get a number back, you're up and running. If not, see
[Troubleshooting](#troubleshooting).

Your AI tool will probably ask permission the first time it uses a Mitti tool.
That's your client being careful, not an error — approve it and carry on.

## What it can and can't do

**It only reads.** Your assistant is offered read-only tools and nothing else, so
it can't create, edit, or delete anything in your account. We've done this
deliberately for the trial: nobody wants an over-enthusiastic AI reorganising
their inspections.

**It sees exactly what you see.** The token carries your own permissions —
no more, no less. If you can't view something in Mitti, neither can your
assistant.

**Your token is still a password.** The read-only limit applies to what your
assistant can do through this tool. The token itself remains fully privileged
against the Mitti API, so treat it accordingly: don't paste it into a shared
document, don't commit it to a repo, and revoke it at
[app.safetyculture.com/account/api-tokens](https://app.safetyculture.com/account/api-tokens)
when you're finished with the trial.

**Your data goes to your AI provider.** Whatever your assistant reads from Mitti
becomes part of its conversation, subject to whatever agreement you have with
that provider. Worth a thought before pointing it at anything sensitive.

## Telling us how it went

This is the part we actually need. Reply to the email that brought you here —
that reaches us directly, and it's the fastest way to get help if something's
broken.

Most useful to us:

- What did you try to do, and did it work?
- Which questions did you find yourself asking most often?
- What was missing, or what did you expect to be there and wasn't?
- Anything that felt slow, wrong, or confusing.

Rough notes are fine. Screenshots are better. We'd rather hear something scrappy
today than something polished next month.

## Troubleshooting

**"MITTI_API_TOKEN is not set"** — the token didn't reach the server. Re-run the
setup command for your client, or check the `env` block in your JSON config.

**"This token belongs to a service user"** — you're using a service account
token. Generate one from your own user account instead (see
[Before you start](#before-you-start)).

**`spawn npx ENOENT` on Windows** — on Windows (not WSL), `npx` is a batch shim
that some clients can't launch directly. Wrap the command: use
`-- cmd /c npx -y <url>` on the command line, or in JSON set
`"command": "cmd"` with `"args": ["/c", "npx", "-y", "<url>"]`.

**Nothing happens, or the server won't start** — check `node --version` reports
v20 or newer. This is the most common cause.

**A tool you expected isn't there** — most likely it isn't marked read-only
upstream, so this trial hides it. Tell us which one; that's exactly the feedback
we want.

Still stuck? Reply to our email and we'll sort it out with you.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `MITTI_API_TOKEN` | yes | — | Your personal Mitti API token. |
| `MITTI_API_URL` | no | `https://api.safetyculture.com` | Only change this if we've given you a different endpoint. |

The API hostname is unchanged by the Mitti rebrand — no endpoints moved, so
existing tokens and integrations keep working exactly as before.

## For the technically curious

This repo is a small stdio proxy. Your AI client launches it locally; it forwards
requests to the Mitti MCP endpoint using your token, and returns the responses.
It stores nothing, and there's no Mitti-side component between your machine and
the API.

Two guardrails run inside it:

- **Read-only filtering.** A tool is exposed only if it declares
  `annotations.readOnlyHint: true`. Anything unannotated is treated as capable of
  writing and hidden — we don't guess from names. See
  [`src/read-only.ts`](src/read-only.ts).
- **Personal tokens only.** At startup the proxy resolves the token's seat type
  and refuses service accounts. See [`src/token-guard.ts`](src/token-guard.ts).

Both are trial guardrails implemented in this proxy rather than enforced by the
API, which is another reason this version is time-limited. Scoped, consent-based
enforcement is what the OAuth version is for.

Logs go to stderr; stdout is reserved for the MCP transport.

Installs pull a prebuilt, dependency-free bundle from the GitHub release — no
transitive packages, no build toolchain. `latest/download` always resolves to the
newest release; to pin a version, swap it for a tag, for example
`.../releases/download/v0.2.0/mitti-mcp-0.2.0.tgz`.

Licensed under Apache-2.0.

<details>
<summary>Upgrading from an earlier build</summary>

The environment variables were previously named `SC_API_TOKEN` and `SC_API_URL`.
The old names are no longer read — rename them to `MITTI_API_TOKEN` and
`MITTI_API_URL`.

</details>

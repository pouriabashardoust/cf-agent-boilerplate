---
name: build-agent
description: Take the agent-boilerplate repo and configure it into a focused, deployable agent for a specific use case the user describes. Writes the tool sandbox modules, replaces the `TOOLS` array, replaces `getSystemPrompt`, optionally renames the DurableObject class + worker, trims bindings the agent doesn't need, and updates the playground UI to match. Use this whenever the user describes a complete agent they want — phrases like "I want an agent that sends Slack messages", "build me an agent that gets blocked jobs and slacks them", "scaffold an agent for X", "configure this for Y", or anything where the user hands over a use case and expects a working configured project. Trigger this skill even when the user only describes the *behavior* (no mention of tools / wrangler / playground) — they want the whole thing built, this skill knows the full set of files to touch.
---

# Building a focused agent from this boilerplate

This repo is a **boilerplate** — `src/agent.ts`, `src/bindings/{slack,database}.ts`, `src/tools/blocked-jobs-to-slack.sandbox.js`, and the playground are all reference scaffolding. The goal of this skill is to turn that scaffold into a working, focused agent for whatever the user described, leaving the repo deploy-ready.

The user gives an intent (e.g. "an agent that DMs blocked jobs to Slack each morning"). Your job is to translate that into:

1. A concrete set of **tools** (one per discrete verb the agent needs).
2. A concrete **system prompt** — role, capabilities, guardrails.
3. A clean set of **bindings** — only the ones the tools actually use.
4. A worker/class **name** that matches the agent's purpose.
5. A playground UI labelled appropriately.

Read the current state of the repo first (don't assume — files may have drifted from what this doc says), make changes file-by-file, and verify with `tsc` + `wrangler deploy --dry-run` at the end.

## Step 1 — Understand the use case

If the user gave a clear intent ("an agent that fetches blocked jobs every morning and DMs the on-call engineer"), proceed. If they gave a vague one ("an agent that sends Slack messages"), ask **one** clarifying question before writing anything — e.g. "What should it message about, and to whom — a person by email, or a channel?" One round of clarification, not a Socratic dialogue. After that, make reasonable assumptions and tell the user what you assumed.

Capture, before touching files:

- **Agent role** — one short sentence.
- **List of verbs** — each one becomes a tool.
- **For each verb, which bindings it uses** — `env.SLACK`, `env.DATABASE`, future ones.
- **Persona / guardrails** — anything the system prompt should warn the model away from.

## Step 2 — Inventory what the bindings can do

Read the current bindings before deciding scope:

```
src/bindings/slack.ts
src/bindings/database.ts
(any others)
```

For each `WorkerEntrypoint` method, note its signature + `@RequirePermission("scope:name")` decorator. Those scope strings are non-negotiable — using a method without its scope causes a runtime `Forbidden` throw.

If the user's verbs require capabilities **none of the bindings cover** (e.g. "post a GitHub comment" with no GitHub binding), stop and tell the user. Adding a new binding is out of scope for this skill — it requires writing a new `WorkerEntrypoint` class, declaring its scopes, exporting it from `src/index.ts`, and re-injecting it into `runInSandbox`. The user has to author that, or you should offer to scaffold the binding as a separate explicit task before continuing here.

## Step 3 — Plan

Decide:

- **Class name** (PascalCase, e.g. `BlockedJobsAgent`, `SlackNotifier`). This becomes the `class X extends Think<Env>` name and the DO binding name in `wrangler.jsonc`.
- **Worker name** (kebab-case, e.g. `blocked-jobs-agent`). Goes in `wrangler.jsonc`'s top-level `name`.
- **Per-tool**: camelCase tool name + kebab-case sandbox filename + UPPER_SNAKE import constant + exact-fit permission scopes. Permissions should be a strict subset of what the sandbox source actually calls — over-granting weakens the safety, under-granting causes runtime errors.
- **Bindings to keep** — the union of bindings any tool touches. If `env.DATABASE` is unused, plan to trim it.

Sketch the result informally so you don't lose track when you start writing.

## Step 4 — Write the tool sandboxes

For each verb, write `src/tools/<kebab-name>.sandbox.js`:

```js
export default {
  async fetch(_req, env) {
    // Use only env.<BINDING> calls allowed by the planned scopes.
    const result = await env.DATABASE.someMethod(arg);
    await env.SLACK.sendMessage("recipient@example.com", JSON.stringify(result));
    return Response.json(result);
  },
};
```

Rules:

- Complete ES module. **No imports**, no TypeScript syntax. The bundler treats this file as text.
- Always return a `Response` (`Response.json(...)` is easiest — the agent's `runInSandbox` calls `await res.text()` and feeds that back to the model).
- Hardcode constants the model shouldn't choose (recipient email, SQL `LIMIT`, channel name). Tools are pre-defined verbs, not parametric RPC.
- If the user wants two tools that look the same except for a constant (different recipient, different table), write them as two separate files. The model picks *which tool* to call; it doesn't fill arguments.

Then write the type shim `src/tools/<same-name>.sandbox.d.ts`:

```ts
declare const source: string;
export default source;
```

Required because TS resolves the relative `.js` import to the actual file but doesn't know its type.

## Step 5 — Replace the TOOLS array

Open `src/agent.ts`. Two edits:

1. **Imports** — replace any old `import FOO from "./tools/foo.sandbox.js"` lines with imports for the new sandboxes.
2. **TOOLS array** — overwrite the array (don't append). Each entry:
   ```ts
   {
     name: "camelCaseToolName",
     description: "One sentence telling the model when to call this.",
     code: UPPER_SNAKE_CONSTANT,
     permissions: ["scope:one", "scope:two"],
   }
   ```

Delete the old example tool's import and `TOOLS` entry — it was reference-only (its file header says "BOILERPLATE / REFERENCE ONLY").

If a tool is no longer needed, also delete its `.sandbox.js` and `.sandbox.d.ts` files so the repo doesn't accumulate dead code.

## Step 6 — Replace `getSystemPrompt`

In `src/agent.ts`, rewrite `getSystemPrompt()` to match the agent's role. Don't leave the placeholder ("You are a helpful assistant scaffolded from the agent-boilerplate…") — that's deliberately vague and shipping it makes the agent confused about its purpose.

Structure:

1. **One sentence: who the agent is and what it owns.**
2. **For each tool: when to call it, in plain English.** Don't repeat the tool description verbatim — paraphrase the *intent* so the model knows the situation, not just the API.
3. **Guardrails the tools can't enforce.** Examples: "Don't summarise data you haven't fetched", "If asked for something none of these tools cover, say so plainly rather than improvising", "Don't call the same tool twice in a row without a reason."

Example for an agent with one `notifyOncallOfBlockedJobs` tool:

```ts
getSystemPrompt() {
  return [
    "You are an on-call notifier for the data-pipeline team.",
    "When the user asks about blocked jobs or wants the on-call engineer paged, call `notifyOncallOfBlockedJobs` — it pulls the latest blocked rows from the database and DMs a summary to the on-call user.",
    "Don't fabricate job details — only describe what came back from the tool.",
    "If the user asks for anything else (modifying jobs, reading logs, paging a different team), tell them this agent doesn't have a tool for that.",
  ].join(" ");
}
```

## Step 7 — Trim bindings the agent doesn't need

If a binding (e.g. `Database`) is no longer used by any tool, remove it. Touch every place it appears, otherwise the type system will lie to you and the bundle will carry dead code. Files to check:

- `src/bindings/<name>.ts` — delete the file.
- `src/index.ts` — remove the `export { Foo } from "./bindings/foo";` line.
- `src/agent.ts` — remove the binding from the `ctx.exports` typecast in `runInSandbox`, and from the `env: { … }` object passed to `LOADER.load`.
- `src/env.d.ts` — remove its secrets (e.g. `DATABASE_URL`, `SLACK_BOT_TOKEN`).
- `package.json` — uninstall provider-specific deps the binding pulled in (e.g. `@neondatabase/serverless` if the Database binding goes; do this with `npm uninstall`, don't hand-edit).
- `CLAUDE.md` — remove the bullet describing the binding.

If the user asked for a "Slack-only" agent, drop Database. If they asked for a "DB-only" agent, drop Slack. If both stay, leave them alone.

After dropping a binding, **its scopes are also gone** — no remaining tool's `permissions` should reference them.

## Step 8 — Rename the agent class and worker

Pick a name that reflects the agent's purpose; "ChatAgent" / "agent-boilerplate" are placeholders. Touch:

- `src/agent.ts` — `export class <NewName> extends Think<Env>`.
- `src/index.ts` — update the `export { ChatAgent } from "./agent"` line.
- `wrangler.jsonc`:
  - Top-level `"name": "<kebab-name>"`.
  - `durable_objects.bindings[].class_name` and `.name` → both `"<NewName>"`.
  - **Bump the migration tag** (`v1` → `v2`) and update `new_sqlite_classes` to the new class name. **Never reuse a tag.** Reusing breaks the migration.
- `src/playground.html`:
  - The `<title>` and the `<h1>` — set to something user-facing like "Blocked Jobs Agent · playground".
  - The WebSocket URL: `/agents/chat-agent/${instance}` → `/agents/<kebab-class-name>/${instance}`. The class name is converted to kebab-case for the URL slot (e.g. `BlockedJobsAgent` → `blocked-jobs-agent`).

Run `npx wrangler types` after the wrangler edits — it regenerates `worker-configuration.d.ts` so `Env` reflects the new DO binding name. If you skip this, you'll see TS errors on `this.env.<NewName>`.

## Step 9 — Update the playground tool list (automatic — verify)

The playground sidebar reads from `GET /api/tools`, which serves `TOOL_MANIFEST` from `src/agent.ts`. Since you replaced the `TOOLS` array in Step 5, the manifest updates automatically. Open the playground after deploying to confirm the tool names you intended are the ones showing.

## Step 10 — Verify

Always run, in this order, before declaring done:

```bash
npx tsc --noEmit
npx wrangler deploy --dry-run
```

`tsc` catches: missing type shim, wrong import path, scope used in `permissions` that no longer maps to a binding method, stale references to a deleted class.

`wrangler deploy --dry-run` catches: missing migration entry for the new class name, references to a deleted binding, broken `services` block.

If both pass, summarise for the user:

- Which tools are now registered.
- Which bindings are kept (and which were dropped).
- The class + worker name.
- The exact secrets they need to set before first deploy (always `ANTHROPIC_API_KEY`; conditionally `SLACK_BOT_TOKEN` / `DATABASE_URL` depending on which bindings stayed; optionally `POSTHOG_API_KEY` for tracing).
- The two commands to run: `npx wrangler secret put …` and `npx wrangler dev`.

## Worked example: "I want an agent that sends blocked jobs to Slack"

1. **Use case** — agent's job is to check the data pipeline for stuck jobs and ping someone on Slack. One verb → one tool.
2. **Bindings inventory** — `Database.getBlockedJobs()` (`database:get_blocked_jobs`), `Slack.sendMessage(email, text)` (`slack:send_message`). Both needed.
3. **Plan** — class `BlockedJobsAgent`, worker `blocked-jobs-agent`, one tool `notifyBlockedJobs` (file `notify-blocked-jobs.sandbox.js`, constant `NOTIFY_BLOCKED_JOBS`, scopes `["database:get_blocked_jobs","slack:send_message"]`). Keep both bindings.
4. **Tool source** — `fetch` calls `env.DATABASE.getBlockedJobs()`, formats the rows, calls `env.SLACK.sendMessage(<recipient>, text)`, returns `Response.json({ jobs, slack })`. Hardcode the recipient email; ask the user for it if they didn't say.
5. **TOOLS array** — replaced with one entry pointing at the new tool.
6. **System prompt** — "You are a blocked-jobs notifier for the data team. When asked, call `notifyBlockedJobs`. Don't make up job details. Don't act on anything else."
7. **Trim** — neither binding is dropped. `package.json` left alone.
8. **Rename** — `ChatAgent` → `BlockedJobsAgent`, worker `agent-boilerplate` → `blocked-jobs-agent`, migration `v1` → `v2` with `new_sqlite_classes: ["BlockedJobsAgent"]`. Playground `<title>`, `<h1>`, and WebSocket URL updated.
9. **Verify** — `tsc` + `wrangler deploy --dry-run`. Tell the user to set `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `DATABASE_URL`.

## Worked example: "I want an agent that sends Slack messages"

Vague — ask one question: "What should it message about, and to whom?" If the user comes back with "ping `pouria@…` whenever I tell it to", that's a single tool `pingPouria` with a hardcoded recipient. But this pattern doesn't take args, so the tool needs concrete situations:

- **Hardcoded message verbs** — `pingPouriaDeployStarted`, `pingPouriaDeployFailed`, etc. One tool per situation. Good when there are a few well-defined events.
- **A small handful of templates** — same idea, fewer messages, parametrised through the tool *name* not arguments.

Drop the `Database` binding (Step 7). Class becomes `SlackNotifier`, worker `slack-notifier`. System prompt focuses on Slack only. After trimming, `database:*` scopes shouldn't appear anywhere.

## When the user wants to add to an already-configured agent

If the repo's already been configured (the `TOOLS` array is non-trivial, `getSystemPrompt` isn't the placeholder, the class isn't named `ChatAgent`), this is an *additive* request. Skip Steps 7–8 (trim/rename) and don't overwrite `TOOLS` — append to it. Steps 4, 5 (append-only), 6 (refresh prompt to mention the new tool), and 10 still apply.

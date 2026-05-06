---
name: add-agent-tool
description: Add a new tool to the agent-boilerplate ChatAgent by reading the available `src/bindings/*.ts` entrypoints, writing a sandbox source module under `src/tools/`, adding the type shim, and registering the tool in the `TOOLS` array in `src/agent.ts`. Use this whenever the user wants to extend the ChatAgent's capabilities — phrases like "I want an agent that...", "build an agent that does X", "add a tool that...", "make the agent able to...", "create an action to...", "I want it to send Slack messages / pull data / notify someone". Trigger this skill even when the user describes a behavior without saying "tool" — anything that boils down to "the ChatAgent should be able to do Y" in this repo means a new entry in TOOLS, and this skill knows the exact files to write.
---

# Adding a tool to the ChatAgent

The ChatAgent in this repo follows a code-mode pattern: each tool is a tiny ES-module Worker that runs inside `env.LOADER` with permissioned `env.SLACK` / `env.DATABASE` stubs injected. The model sees only named tools, never the raw bindings.

To add a new capability you change **four things**:

1. `src/tools/<kebab-name>.sandbox.js` — the worker source (text bundled into the agent worker, shipped to `env.LOADER` at call time).
2. `src/tools/<kebab-name>.sandbox.d.ts` — a one-liner so TS types the import as `string`.
3. A new entry in the `TOOLS` array in `src/agent.ts` (plus the matching `import` line).
4. The body of `getSystemPrompt()` in `src/agent.ts` — so the model knows the agent's role and when to use each tool.

## Step 1 — Discover what bindings can do

Before writing anything, **read the binding files** to see what methods exist and what `@RequirePermission` scope each one demands. The bindings are the only API surface available inside the sandbox, and using a method without the matching scope causes the call to throw `Forbidden: missing permission "..."` at runtime.

Read:

- `src/bindings/slack.ts`
- `src/bindings/database.ts`
- Any other files in `src/bindings/`

For each method, note three things:

- The method signature (`name(args): Promise<...>`).
- Its `@RequirePermission("scope:name")` decorator — that string is the scope you must include in `permissions`.
- Whether the binding (`SLACK`, `DATABASE`, …) matches the env name the sandbox will see.

If the user asks for behavior that no existing binding can satisfy (e.g. they want to read GitHub issues, but there's no GitHub binding), **stop and tell the user**. The right answer is to add a new `WorkerEntrypoint` to `src/bindings/` first; it's not this skill's job to fake it.

## Step 2 — Plan the tool

Pick:

- **Tool name** — camelCase, action-shaped (`notifyTeamOfErrors`, `summariseBlockedJobs`). This is what the model calls.
- **File name** — same name in kebab-case, with `.sandbox.js` suffix (`notify-team-of-errors.sandbox.js`).
- **Import constant** — UPPER_SNAKE_CASE of the same name (`NOTIFY_TEAM_OF_ERRORS`).
- **Description** — one short sentence telling the model when to use this tool. Pretend you're the model: would this description make it pick this tool over a generic chat answer?
- **Permissions** — exactly the scopes the sandbox source will actually use. No more (over-granting weakens the safety of the pattern), no less (under-granting causes runtime errors).

## Step 3 — Write the sandbox source

The file must be a complete ES module that exports a `default` `fetch` handler. It runs in an isolated Worker isolate — **no imports, no TypeScript, no top-level state**. The `env` it receives only has the bindings you injected (`SLACK`, `DATABASE`).

Template:

```js
export default {
  async fetch(_req, env) {
    // Call binding methods. They return whatever the WorkerEntrypoint method returned.
    const result = await env.DATABASE.someMethod(arg);
    // Optionally chain to other bindings.
    await env.SLACK.sendMessage("recipient@example.com", JSON.stringify(result));
    // Return JSON so the agent's `runInSandbox` helper can stringify it for the model.
    return Response.json(result);
  },
};
```

Conventions worth keeping:

- Always return `Response.json(...)` (or `new Response(text)`) — the agent's `runInSandbox` reads `await res.text()` and passes it back to the model.
- Hardcode constants the model shouldn't influence (e.g. an internal email recipient, a SQL `LIMIT`). The model only chooses *which tool* to call, never edits the source.
- If you need values the model *should* supply (rare for this pattern), prefer adding another tool rather than wiring tool-arg → sandbox-env. Each tool is meant to be a self-contained "verb."

## Step 4 — Write the type shim

Right next to the `.sandbox.js` file, create `<same-name>.sandbox.d.ts`:

```ts
declare const source: string;
export default source;
```

This is required because TS resolves the relative `.js` import to the real file but doesn't know its type. The shim says "treat the default export as `string`." (The bundler treats the file as text via the `rules` block in `wrangler.jsonc`.)

## Step 5 — Register the tool

Open `src/agent.ts` and:

1. Add the import near the existing tool imports:
   ```ts
   import NOTIFY_TEAM_OF_ERRORS from "./tools/notify-team-of-errors.sandbox.js";
   ```
2. Append a new object to the `TOOLS` array:
   ```ts
   {
     name: "notifyTeamOfErrors",
     description: "Pull recent error rows from the database and DM a summary to the on-call user.",
     code: NOTIFY_TEAM_OF_ERRORS,
     permissions: ["database:get_blocked_jobs", "slack:send_message"],
   },
   ```

If the user asks to **replace** the existing example tool rather than add to it, swap the array entry rather than appending — the `BLOCKED_JOBS_TO_SLACK` entry is reference-only (its file header says so).

## Step 6 — Rewrite `getSystemPrompt`

Tools alone don't make a focused agent — the system prompt is what tells the model when and why to reach for them. Whenever the set of tools changes meaningfully (new verb added, the example tool replaced, the agent's role shifted), open `src/agent.ts` and rewrite `getSystemPrompt()` to match.

A good system prompt for this boilerplate's pattern says, briefly:

1. **Who the agent is** — one sentence on the role / domain (`You are an on-call assistant for the data-pipeline team.`).
2. **What it can do** — name each registered tool and the situation it covers, in plain English. Don't dump the descriptions verbatim from the `TOOLS` array — paraphrase so the model gets the *intent*.
3. **What it shouldn't do** — guardrails the tools can't enforce. E.g. "Don't summarise jobs you haven't actually fetched", "If the user asks for something none of these tools cover, say so plainly rather than guessing."

Example, after adding a `notifyTeamOfErrors` tool and removing the boilerplate example:

```ts
getSystemPrompt() {
  return [
    "You are an on-call assistant for the data-pipeline team.",
    "When the user asks about recent failures or wants the team notified, call `notifyTeamOfErrors` — it pulls the latest error rows and DMs the on-call engineer.",
    "If the user asks for something these tools can't do (e.g. modifying jobs, reading logs), tell them you don't have a tool for that yet rather than improvising.",
  ].join(" ");
}
```

If the user asks for a new tool but says nothing about role/persona, it's fine to keep `getSystemPrompt` short and tool-focused — but **don't leave the original boilerplate prompt** ("You are a helpful assistant scaffolded from the agent-boilerplate…") in place. That's placeholder text, and shipping it makes the agent vague about what it's for.

## Step 7 — Verify

Run, in order:

```bash
npx tsc --noEmit
npx wrangler deploy --dry-run
```

`tsc` catches a missing shim or wrong import path. `wrangler deploy --dry-run` catches missing rules / unbound services.

If the user has the dev server up, they should see the new tool name in the playground sidebar (the `/api/tools` endpoint is driven off `TOOL_MANIFEST`, which is derived from the same array).

## Worked examples

### "I want an agent that sends Slack messages"

The user wants the agent to be able to DM a person. The Slack binding already has `sendMessage(email, text)`. But "send a slack message" alone isn't a tool — *what* message, to *whom*, *when*? Pick a concrete verb the user actually wants. Often the right move is to ask one clarifying question ("To which user, and what should the message contain?") before generating.

If the user just wants a parametric "send DM" capability with the model picking the args, that's a hint the design is wrong — tools in this pattern are pre-defined verbs, not raw RPC. Suggest a more specific verb (`pingOncall`, `notifyDeploysChannel`, …).

### "I want an agent that can get the blocked jobs and send them via slack"

This is exactly the existing example tool. Confirm with the user whether they want to:

- Tweak it (e.g. different recipient, add a "no jobs to report" short-circuit), in which case edit the existing `.sandbox.js`.
- Have a second variant (e.g. one for ops, one for engineering), in which case create a second sandbox file with its own scopes.

Don't silently overwrite the example without saying so — its header comment marks it as reference-only.

## What this skill won't do

- Add new bindings. If `env.SLACK` doesn't expose what you need, the user has to author a new `WorkerEntrypoint` (or extend an existing one), declare a permission scope, and re-export it from `src/index.ts`. This skill assumes the bindings are fixed.
- Run `wrangler types`. Only needed if `wrangler.jsonc` changes; this skill never touches it.
- Set secrets. The bindings rely on `SLACK_BOT_TOKEN` / `DATABASE_URL`; if they're missing the user will see runtime auth errors, not a typecheck failure.

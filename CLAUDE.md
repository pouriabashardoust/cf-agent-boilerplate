# agent-boilerplate

This is a **boilerplate** for scaffolding [Cloudflare Think agents](https://developers.cloudflare.com/agents/api-reference/think/) that run on Workers + Durable Objects, use Anthropic Haiku 4.5 via `@ai-sdk/anthropic`, and can execute dynamically-supplied code in a Worker Loader sandbox with permissioned `Slack` and `Database` bindings.

It is intentionally minimal. Treat the files as a starting point — copy this directory, rename, and fill in the agent's real behavior.

## Quick start

```bash
npm install
npm --prefix chat-ui install

# Required secret. Optional ones are listed under "First-time setup" below.
npx wrangler secret put ANTHROPIC_API_KEY

npm run dev        # worker on :8787 + vite on :5173, both with HMR
# → open http://localhost:5173
```

`npm start` runs the production-style flow instead: `npm run build:ui && npm run dev:worker` — wrangler serves the built `chat-ui/dist/` bundle on `:8787` (no Vite, no HMR). Use this to mirror `wrangler deploy`.

`npm run deploy` builds the UI then `wrangler deploy`s.

## What's in the box

- `src/agent.ts` — `ChatAgent` extends `Think<Env>`. Implements `getModel()` (Anthropic Haiku 4.5), `getSystemPrompt()`, an example tool `blockedJobsToSlack` that runs a sandbox source module through `env.LOADER` with `env.SLACK` / `env.DATABASE` injected, and the schedule tools (`schedule_task` / `list_schedules` / `cancel_schedule`) plus `runScheduledPrompt(payload)` — when a scheduled task fires, the saved prompt is replayed as a user turn and the stream is broadcast to any connected chat-ui tab. The private helper `runInSandbox(code, permissions)` is the seam for new sandboxed tools.
- `src/tools/*.sandbox.js` — sandbox source modules. Each one is a complete ES module exporting a `default` `fetch` handler. They are bundled as **text strings** (see `rules` in `wrangler.jsonc`) and shipped to `env.LOADER` at tool-call time; they never run inside the agent worker itself.
- `src/tools/*.sandbox.d.ts` — one-line declaration so TypeScript treats the matching `.sandbox.js` import as `string`.
- `src/index.ts` — Worker entry. Default export routes `/api/tools` to `TOOL_MANIFEST` and everything else through `routeAgentRequest` (the agents WebSocket / HTTP router). Static assets (`/`, `/assets/*`, etc.) are served by the `assets` binding directly — no fetch handler needed. Also re-exports `ChatAgent`, `Slack`, and `Database` so the Workers runtime can find them.
- `chat-ui/` — Vite + React + Tailwind v4 + shadcn UI. `src/App.tsx` is the entire chat: `useAgent` from `agents/react` opens a WebSocket to the `ChatAgent` DO, and `useAgentChat` from `@cloudflare/ai-chat/react` drives the message stream. Built with `npm run build:ui` from the repo root → `chat-ui/dist/` is consumed by the Worker `assets` binding. In dev, `npm run dev:ui` runs vite on `:5173` and proxies `/api/*` and `/agents/*` to the wrangler dev server on `:8787`.
- `src/bindings/slack.ts` — `Slack` `WorkerEntrypoint`. Single method `sendMessage(email, text)` gated on the `slack:send_message` scope.
- `src/bindings/database.ts` — `Database` `WorkerEntrypoint`. Methods for listing tables / reading job events / unblocking jobs, each gated on its own scope. Uses `@neondatabase/serverless`.
- `src/shared/permissions.ts` — `RequirePermission` decorator and `assertPermission` helper. Direct in-worker calls (no `props`) are always allowed; calls from a sandbox stub created with `ctx.exports.X({ props: { permissions } })` are checked.
- `src/env.d.ts` — augments `Cloudflare.Env` with the secrets `wrangler types` doesn't introspect: `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `DATABASE_URL`, plus the optional `POSTHOG_API_KEY` / `POSTHOG_HOST`.
- `src/posthog.ts` — `tracedModel(env, model, opts)` wraps a Vercel-AI-SDK model with PostHog LLM tracing via `@posthog/ai/vercel`. Returns the model unchanged if `POSTHOG_API_KEY` isn't set, so tracing is opt-in. The `agent.ts` `getModel()` passes `this.name` (the DO instance / conversation ID) as the `distinctId`.
- `wrangler.jsonc` — DO binding for `ChatAgent` (`v1` SQLite migration), `worker_loaders: [{ binding: "LOADER" }]`, `assets` binding pointing at `chat-ui/dist/` (SPA fallback), and `compatibility_flags: ["nodejs_compat", "enable_ctx_exports"]`.
- `tsconfig.json` — strict TS, picks up the generated `worker-configuration.d.ts`.

## How tools work

Tools follow a "code-mode" pattern: instead of exposing `env.SLACK` / `env.DATABASE` directly to the model, each tool is a named action whose body is a small ES-module Worker that the agent loads into `env.LOADER` with permission-scoped stubs.

1. `ctx.exports.Slack({ props: { permissions } })` and `ctx.exports.Database({ props })` produce stubs of the in-worker `WorkerEntrypoint` classes, with the granted scopes attached as RPC-call props. This requires the `enable_ctx_exports` compatibility flag.
2. `env.LOADER.load({ ... })` instantiates a sandboxed Worker with the tool's source, injecting the two stubs as `env.SLACK` / `env.DATABASE`.
3. The sandbox calls `env.SLACK.sendMessage(...)` / `env.DATABASE.listTables()`. Each call passes through `RequirePermission`, which reads the props off the RPC context and rejects the call if the matching scope isn't in the granted list.

The model only ever sees the tool *names* (`blockedJobsToSlack`, etc.). It cannot escape the predefined code or escalate beyond the scopes that tool was registered with.

## Scheduling

Three built-in tools let the agent schedule future turns of itself:

- `schedule_task({ kind, when, prompt })` — `kind` is `'delay'` (seconds), `'date'` (ISO string), or `'cron'`. The saved `prompt` becomes a user message at fire time.
- `list_schedules()` — returns all active schedules.
- `cancel_schedule({ id })` — cancels by id.

When a scheduled task fires, `runScheduledPrompt({ prompt })` is invoked by the alarm system. It calls `this.chat(prompt, callback)` to run a full agentic turn and rebroadcasts each chunk via `_broadcastChat` + a final `_broadcastMessages()` so any chat-ui tab connected at the time sees the streaming response live. Disconnected clients pick it up on next reconnect via the standard `cf_agent_chat_messages` history replay.

### Adding a new tool

1. Create `src/tools/foo-bar.sandbox.js`:
   ```js
   export default {
     async fetch(_req, env) {
       // use env.SLACK / env.DATABASE here
       return Response.json({ ok: true });
     },
   };
   ```
2. Create the sibling `src/tools/foo-bar.sandbox.d.ts` (TS won't accept the import without it):
   ```ts
   declare const source: string;
   export default source;
   ```
3. In `src/agent.ts`, import it and add a tool entry:
   ```ts
   import FOO_BAR from "./tools/foo-bar.sandbox.js";
   // ...
   fooBar: tool({
     description: "...",
     inputSchema: z.object({}),
     execute: async () => run(FOO_BAR, ["scope:one", "scope:two"]),
   }),
   ```
4. Grant only the scopes the snippet actually needs — `RequirePermission` rejects anything else at call time.

## First-time setup

```bash
# Optional secrets (only if the matching binding is actually used):
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put DATABASE_URL
# Optional — enables LLM tracing to PostHog when set:
npx wrangler secret put POSTHOG_API_KEY
npx wrangler secret put POSTHOG_HOST   # defaults to https://us.i.posthog.com

# Regenerate the Env type after editing wrangler.jsonc
npx wrangler types
```

`wrangler types` does NOT introspect secrets — keep them in sync by hand in `src/env.d.ts`.

## Scripts reference

| Command            | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`      | Worker (`:8787`) + Vite (`:5173`) in parallel. **Use this while developing.** |
| `npm start`        | `build:ui` + `dev:worker` — production-style, served from `chat-ui/dist/`.   |
| `npm run dev:worker` | Wrangler only (`:8787`). Serves whatever's in `chat-ui/dist/`.             |
| `npm run dev:ui`   | Vite only (`:5173`). Needs a worker running on `:8787` to be useful.         |
| `npm run build:ui` | One-shot Vite build → `chat-ui/dist/`.                                       |
| `npm run deploy`   | Builds the UI, then `wrangler deploy`.                                       |
| `npm run types`    | `wrangler types`. Run after every `wrangler.jsonc` edit.                     |
| `npm run typecheck`| `tsc --noEmit` for the worker.                                               |

In `npm run dev`, vite proxies `/api/*` and `/agents/*` (WebSocket) to the worker, so the browser only ever talks to `:5173`. Ctrl-C kills both processes (`--kill-others-on-fail` also tears the pair down if either crashes).

**Port note**: dev port is `8787` (not `6000` / `6666` / `6667` etc) — those are on the [WHATWG fetch port-block list](https://fetch.spec.whatwg.org/#port-blocking). Wrangler's internal proxy uses undici, which refuses blocked ports — symptom is `Empty reply from server` and a blank UI.

## Common changes

### Extend an existing binding (add a method)

The `Slack` and `Database` bindings are plain `WorkerEntrypoint` classes — add a method, give it a permission scope, and use it from a new (or existing) sandbox tool.

1. Open the binding (`src/bindings/slack.ts` or `src/bindings/database.ts`).
2. Add a method, decorated with `@RequirePermission("<entity>:<action>")`:
   ```ts
   @RequirePermission("slack:upload_file")
   async uploadFile(channel: string, filename: string, bytes: ArrayBuffer) {
     // call the Slack API…
   }
   ```
3. Use it from a sandbox tool's `fetch` handler via `env.SLACK.uploadFile(...)` / `env.DATABASE.<newMethod>(...)`. Add the matching scope to that tool's `permissions` array in `src/agent.ts`.

The model never sees the binding directly — it only sees the named tools — so adding a method is safe even if you don't immediately wire it into a tool.

### Add another binding

1. Drop a new `WorkerEntrypoint` class under `src/bindings/`. Use `@RequirePermission("scope:action")` on each method you want gated.
2. Re-export it from `src/index.ts` so the runtime registers it.
3. In `runInSandbox`, add it to `ctx.exports` and inject it into the sandbox `env`.

### Swap the model (or provider)

`getModel()` in `src/agent.ts` returns the model used for every turn.

- **Different Anthropic model** — change the argument to `anthropic(...)`. Cheap → expensive: `claude-haiku-4-5-20251001` (default — fastest/cheapest), `claude-sonnet-4-6`, `claude-opus-4-7`.
- **Different provider** — swap the import + `createX(...)` call (e.g. `@ai-sdk/openai`, `@ai-sdk/google`, `workers-ai-provider`). Update the secret name in `src/env.d.ts` to match what the new provider expects, and run `wrangler secret put <NEW_KEY>`.

`tracedModel(this.env, ..., { distinctId: this.name })` wraps whatever model you pass — keep the wrapper to preserve PostHog tracing.

### Add a secret

1. `npx wrangler secret put MY_SECRET`.
2. Add it to the `Cloudflare.Env` augmentation in `src/env.d.ts`.

### Rename the agent

1. Rename the class in `src/agent.ts` and re-export in `src/index.ts`.
2. Update `class_name` and `name` under `durable_objects.bindings` in `wrangler.jsonc`.
3. **Bump the migration tag** (`v1` → `v2`) and put the new class name under `new_sqlite_classes`. Never reuse a tag.
4. `npx wrangler types`.

## Notes for future Claude

- This project is a template — prefer editing the existing files over inventing new structure.
- Don't paste secrets into `wrangler.jsonc` or `vars`. Use `wrangler secret put`.
- After any `wrangler.jsonc` edit, run `npx wrangler types`. Don't hand-edit `worker-configuration.d.ts`.
- The `enable_ctx_exports` flag is load-bearing — `runInSandbox` reads `ctx.exports.{Slack,Database}` to mint per-call stubs. Removing the flag breaks the tool.
- `@cloudflare/think` is pinned at `^0.1.0`. Its surface is `getModel` / `getSystemPrompt` / `getTools` / `getMaxSteps` / `assembleContext` / `onChatMessage`. Newer Think APIs (`configureSession`, `Session`, `withContext`) belong to a later major version and are NOT available — don't try to use them.
- Permission scopes are free-form strings agreed upon between the binding and the caller. Existing scopes: `slack:send_message`, `database:list_tables`, `database:get_blocked_jobs`, `database:unblock_job`. Add new ones consistently (`<entity>:<action>`).
- The `agents` package provides `routeAgentRequest` (worker side). Client code in `chat-ui/` uses `useAgent` from `agents/react` and `useAgentChat` from `@cloudflare/ai-chat/react` — same protocol, no manual WebSocket plumbing.

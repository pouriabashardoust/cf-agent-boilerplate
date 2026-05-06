# agent-boilerplate

This is a **boilerplate** for scaffolding [Cloudflare Think agents](https://developers.cloudflare.com/agents/api-reference/think/) that run on Workers + Durable Objects, use Gemini via `@ai-sdk/google`, and can execute dynamically-supplied code in a Worker Loader sandbox with permissioned `Slack` and `Database` bindings.

It is intentionally minimal. Treat the files as a starting point — copy this directory, rename, and fill in the agent's real behavior.

## What's in the box

- `src/agent.ts` — `ChatAgent` extends `Think<Env>`. Implements `getModel()` (Gemini 2.5 Pro), `getSystemPrompt()`, and one example tool `blockedJobsToSlack` that runs a sandbox source module through `env.LOADER` with `env.SLACK` / `env.DATABASE` injected. The private helper `runInSandbox(code, permissions)` is the seam: each new tool is "import the sandbox source + one entry in `getTools()`".
- `src/tools/*.sandbox.js` — sandbox source modules. Each one is a complete ES module exporting a `default` `fetch` handler. They are bundled as **text strings** (see `rules` in `wrangler.jsonc`) and shipped to `env.LOADER` at tool-call time; they never run inside the agent worker itself.
- `src/tools/*.sandbox.d.ts` — one-line declaration so TypeScript treats the matching `.sandbox.js` import as `string`.
- `src/index.ts` — Worker entry. Default export routes via `routeAgentRequest`. Also re-exports `ChatAgent`, `Slack`, and `Database` so the Workers runtime can find them.
- `src/bindings/slack.ts` — `Slack` `WorkerEntrypoint`. Single method `sendMessage(email, text)` gated on the `slack:send_message` scope.
- `src/bindings/database.ts` — `Database` `WorkerEntrypoint`. Methods for listing tables / reading job events / unblocking jobs, each gated on its own scope. Uses `@neondatabase/serverless`.
- `src/shared/permissions.ts` — `RequirePermission` decorator and `assertPermission` helper. Direct in-worker calls (no `props`) are always allowed; calls from a sandbox stub created with `ctx.exports.X({ props: { permissions } })` are checked.
- `src/env.d.ts` — augments `Cloudflare.Env` with the secrets `wrangler types` doesn't introspect: `GOOGLE_GENERATIVE_AI_API_KEY`, `SLACK_BOT_TOKEN`, `DATABASE_URL`.
- `wrangler.jsonc` — DO binding for `ChatAgent` (`v1` SQLite migration), `worker_loaders: [{ binding: "LOADER" }]`, and `compatibility_flags: ["nodejs_compat", "enable_ctx_exports"]`.
- `tsconfig.json` — strict TS, picks up the generated `worker-configuration.d.ts`.

## How tools work

Tools follow a "code-mode" pattern: instead of exposing `env.SLACK` / `env.DATABASE` directly to the model, each tool is a named action whose body is a small ES-module Worker that the agent loads into `env.LOADER` with permission-scoped stubs.

1. `ctx.exports.Slack({ props: { permissions } })` and `ctx.exports.Database({ props })` produce stubs of the in-worker `WorkerEntrypoint` classes, with the granted scopes attached as RPC-call props. This requires the `enable_ctx_exports` compatibility flag.
2. `env.LOADER.load({ ... })` instantiates a sandboxed Worker with the tool's source, injecting the two stubs as `env.SLACK` / `env.DATABASE`.
3. The sandbox calls `env.SLACK.sendMessage(...)` / `env.DATABASE.listTables()`. Each call passes through `RequirePermission`, which reads the props off the RPC context and rejects the call if the matching scope isn't in the granted list.

The model only ever sees the tool *names* (`blockedJobsToSlack`, etc.). It cannot escape the predefined code or escalate beyond the scopes that tool was registered with.

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
npm install

# Set secrets (interactive). Required:
npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
# Optional, only if you actually use the bindings:
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put DATABASE_URL

# Generate the Env type (writes worker-configuration.d.ts)
npx wrangler types
```

Re-run `npx wrangler types` any time you edit `wrangler.jsonc`. Secrets are NOT picked up — keep `src/env.d.ts` in sync by hand.

## Common changes

### Add another binding

1. Drop a new `WorkerEntrypoint` class under `src/bindings/`. Use `@RequirePermission("scope:action")` on each method you want gated.
2. Re-export it from `src/index.ts` so the runtime registers it.
3. In `runInSandbox`, add it to `ctx.exports` and inject it into the sandbox `env`.

### Swap the model

Change the argument to `google(...)` in `getModel()`. Options: `gemini-2.5-pro` (default), `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3-pro-preview`.

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
- The `agents` package provides `routeAgentRequest`; client code uses `useAgent` + `useAgentChat` from `agents/react` (not included here — add when you build the UI).

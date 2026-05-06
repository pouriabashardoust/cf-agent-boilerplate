import { Think } from "@cloudflare/think";
import { createAnthropic } from "@ai-sdk/anthropic";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import BLOCKED_JOBS_TO_SLACK from "./tools/blocked-jobs-to-slack.sandbox.js";

type ToolSpec = {
  name: string;
  description: string;
  code: string;
  permissions: string[];
};

const TOOLS: readonly ToolSpec[] = [
  {
    name: "blockedJobsToSlack",
    description:
      "Fetch the latest blocked jobs from the database and DM a summary to a Slack user.",
    code: BLOCKED_JOBS_TO_SLACK,
    permissions: ["database:get_blocked_jobs", "slack:send_message"],
  },
];

export const TOOL_MANIFEST = TOOLS.map(({ name, description, permissions }) => ({
  name,
  description,
  permissions,
}));

export class ChatAgent extends Think<Env> {
  getModel() {
    const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    return anthropic("claude-haiku-4-5-20251001");
  }

  getSystemPrompt() {
    return "You are a helpful assistant scaffolded from the agent-boilerplate. Use the available tools to act on the user's request.";
  }

  getTools(): ToolSet {
    const run = this.runInSandbox.bind(this);
    return Object.fromEntries(
      TOOLS.map((spec) => [
        spec.name,
        tool({
          description: spec.description,
          inputSchema: z.object({}),
          execute: async () => run(spec.code, spec.permissions),
        }),
      ]),
    );
  }

  // Each tool above runs a small ES module in the LOADER sandbox with
  // env.SLACK / env.DATABASE stubs that carry the granted permission scopes.
  private async runInSandbox(code: string, permissions: string[]) {
    const ctx = this.ctx as DurableObjectState & {
      exports: {
        Slack: (opts: { props: unknown }) => unknown;
        Database: (opts: { props: unknown }) => unknown;
      };
    };
    const slack = ctx.exports.Slack({ props: { permissions } });
    const database = ctx.exports.Database({ props: { permissions } });

    const stub = this.env.LOADER.load({
      compatibilityDate: "2025-04-01",
      mainModule: "user.js",
      modules: { "user.js": code },
      env: { SLACK: slack, DATABASE: database },
    });
    const res = await stub
      .getEntrypoint()
      .fetch(new Request("http://internal/", { method: "GET" }));
    return { status: res.status, body: await res.text() };
  }
}

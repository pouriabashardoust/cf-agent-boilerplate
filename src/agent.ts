import { Think } from "@cloudflare/think";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import BLOCKED_JOBS_TO_SLACK from "./tools/blocked-jobs-to-slack.sandbox.js";

export class ChatAgent extends Think<Env> {
  getModel() {
    const google = createGoogleGenerativeAI({
      apiKey: this.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
    return google("gemini-2.5-pro");
  }

  getSystemPrompt() {
    return "You are a helpful assistant scaffolded from the agent-boilerplate. Use the available tools to act on the user's request.";
  }

  getTools(): ToolSet {
    const run = this.runInSandbox.bind(this);
    return {
      blockedJobsToSlack: tool({
        description:
          "Fetch the latest blocked jobs from the database and DM a summary to a Slack user.",
        inputSchema: z.object({}),
        execute: async () =>
          run(BLOCKED_JOBS_TO_SLACK, [
            "database:get_blocked_jobs",
            "slack:send_message",
          ]),
      }),
    };
  }

  // Each named tool above runs a small ES module in the LOADER sandbox with
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

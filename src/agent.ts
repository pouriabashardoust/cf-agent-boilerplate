import { Think } from "@cloudflare/think";
import { createAnthropic } from "@ai-sdk/anthropic";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import BLOCKED_JOBS_TO_SLACK from "./tools/blocked-jobs-to-slack.sandbox.js";
import { tracedModel } from "./posthog";

type ToolSpec = {
  name: string;
  description: string;
  code: string;
  permissions: string[];
};

// BOILERPLATE / REFERENCE ONLY.
// These tools exist to demonstrate the LOADER + permissioned-binding pattern.
// Replace this array with your own tools — see CLAUDE.md "Adding a new tool".
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
    return tracedModel(this.env, anthropic("claude-haiku-4-5-20251001"), {
      distinctId: this.name,
    });
  }

  getSystemPrompt() {
    return [
      "You are a helpful assistant scaffolded from the agent-boilerplate. Use the available tools to act on the user's request.",
      "",
      "Scheduling. If the user asks for *anything* to happen later, repeatedly, or on a schedule (e.g. 'remind me in 1 min', 'every Monday', 'tomorrow at 9am'), call `schedule_task` BEFORE replying. `kind` is 'delay' (seconds), 'date' (ISO string), or 'cron'. Use `list_schedules` and `cancel_schedule` to inspect or stop. Never claim to have scheduled something without making the tool call.",
    ].join("\n");
  }

  getTools(): ToolSet {
    const run = this.runInSandbox.bind(this);
    return {
      ...this.getScheduleTools(),
      ...Object.fromEntries(
        TOOLS.map((spec) => [
          spec.name,
          tool({
            description: spec.description,
            inputSchema: z.object({}),
            execute: async () => run(spec.code, spec.permissions),
          }),
        ]),
      ),
    };
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

  // Called by the scheduler (see Agent.schedule) when a scheduled prompt fires.
  // Runs a full agentic turn with the saved prompt as the user message and
  // re-broadcasts the stream so any connected playground tab sees it live.
  async runScheduledPrompt(payload: { prompt: string }) {
    type Broadcaster = {
      _broadcastChat: (m: unknown) => void;
      _broadcastMessages: () => void;
    };
    const self = this as unknown as Broadcaster;
    const requestId = crypto.randomUUID();

    await this.chat(payload.prompt, {
      onEvent: (json) =>
        self._broadcastChat({
          type: "cf_agent_use_chat_response",
          id: requestId,
          body: json,
          done: false,
        }),
      onDone: () => {
        self._broadcastChat({
          type: "cf_agent_use_chat_response",
          id: requestId,
          body: "",
          done: true,
        });
        self._broadcastMessages();
      },
      onError: (err) =>
        self._broadcastChat({
          type: "cf_agent_use_chat_response",
          id: requestId,
          body: err,
          done: true,
          error: true,
        }),
    });
  }

  private getScheduleTools(): ToolSet {
    const agent = this;
    return {
      schedule_task: tool({
        description:
          "Schedule a future or recurring turn of yourself. Use kind='delay' (seconds), kind='date' (ISO string), or kind='cron' (cron expression).",
        inputSchema: z.object({
          kind: z.enum(["delay", "date", "cron"]),
          when: z.union([z.number(), z.string()]),
          prompt: z
            .string()
            .describe("The instruction your future self will run."),
        }),
        execute: async ({ kind, when, prompt }) => {
          let target: Date | string | number;
          if (kind === "delay") target = Number(when);
          else if (kind === "date") target = new Date(String(when));
          else target = String(when);
          const s = await agent.schedule(target, "runScheduledPrompt", {
            prompt,
          });
          return { id: s.id, type: s.type, time: s.time };
        },
      }),

      list_schedules: tool({
        description: "List all currently scheduled tasks.",
        inputSchema: z.object({}),
        execute: async () =>
          agent.getSchedules().map((s) => ({
            id: s.id,
            type: s.type,
            time: s.time,
            payload: s.payload,
            ...(s.type === "cron" ? { cron: s.cron } : {}),
            ...(s.type === "delayed"
              ? { delayInSeconds: s.delayInSeconds }
              : {}),
          })),
      }),

      cancel_schedule: tool({
        description: "Cancel a scheduled task by id.",
        inputSchema: z.object({ id: z.string() }),
        execute: async ({ id }) => ({ cancelled: await agent.cancelSchedule(id) }),
      }),
    };
  }
}

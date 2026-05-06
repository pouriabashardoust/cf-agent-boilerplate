// BOILERPLATE / REFERENCE ONLY — example WorkerEntrypoint showing the
// `@RequirePermission` pattern. Replace with your own entity bindings.
import { WorkerEntrypoint } from "cloudflare:workers";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

import { RequirePermission } from "../shared/permissions";

export type AiProps = {
  /**
   * Optional system prompt prepended to every call.
   * The dynamic worker cannot override or strip this.
   */
  systemPrompt?: string;
};

export class Ai extends WorkerEntrypoint<Env, AiProps> {
  /**
   * Run a short LLM completion against a cheap model. Capped at 2 agentic
   * steps and 2048 output tokens server-side. The dynamic worker only sees
   * the final text. Caller must hold `ai:ask`.
   */
  @RequirePermission("ai:ask")
  async ask(userPrompt: string): Promise<{ text: string }> {
    const { systemPrompt } = this.ctx.props;
    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: systemPrompt,
      prompt: userPrompt,
      stopWhen: stepCountIs(2),
      maxOutputTokens: 2048,
    });
    return { text };
  }
}

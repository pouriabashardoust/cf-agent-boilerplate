import { PostHog } from "posthog-node";
import { withTracing } from "@posthog/ai/vercel";
import type { LanguageModel } from "ai";

let client: PostHog | null = null;

function getClient(env: Env): PostHog | null {
  const apiKey = env.POSTHOG_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new PostHog(apiKey, {
      host: env.POSTHOG_HOST || "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

interface TraceOptions {
  distinctId?: string;
  traceId?: string;
  properties?: Record<string, unknown>;
  privacyMode?: boolean;
  groups?: Record<string, unknown>;
}

// Wraps a Vercel-AI-SDK LanguageModel with PostHog tracing. If
// POSTHOG_API_KEY is unset, returns the model unchanged so local dev and
// secret-less environments keep working.
export function tracedModel<M extends LanguageModel>(
  env: Env,
  model: M,
  opts: TraceOptions = {},
): M {
  const ph = getClient(env);
  if (!ph) return model;
  return withTracing(model as Parameters<typeof withTracing>[0], ph, {
    posthogDistinctId: opts.distinctId,
    posthogTraceId: opts.traceId,
    posthogProperties: opts.properties,
    posthogPrivacyMode: opts.privacyMode,
    posthogGroups: opts.groups,
    posthogCaptureImmediate: true,
  }) as M;
}

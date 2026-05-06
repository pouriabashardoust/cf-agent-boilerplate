// Augment the wrangler-generated `Env` with Worker secrets, which `wrangler
// types` does not introspect. List every secret you set via
// `wrangler secret put` here.
declare global {
  namespace Cloudflare {
    interface Env {
      ANTHROPIC_API_KEY: string;
      SLACK_BOT_TOKEN: string;
      DATABASE_URL: string;
      // Optional — when set, LLM calls are traced to PostHog. Unset = no tracing.
      POSTHOG_API_KEY?: string;
      POSTHOG_HOST?: string;
    }
  }
}

export {};

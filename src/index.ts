import { routeAgentRequest } from "agents";

export { ChatAgent } from "./agent";
export { Slack } from "./bindings/slack";
export { Database } from "./bindings/database";

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;

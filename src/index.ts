import { routeAgentRequest } from "agents";

import { TOOL_MANIFEST } from "./agent";

export { ChatAgent } from "./agent";
export { Slack } from "./bindings/slack";
export { Database } from "./bindings/database";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/tools") {
      return Response.json(TOOL_MANIFEST);
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;

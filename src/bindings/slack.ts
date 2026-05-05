import { WorkerEntrypoint } from "cloudflare:workers";

import { RequirePermission } from "../shared/permissions";

export class Slack extends WorkerEntrypoint<Env> {
  private get token(): string {
    return (this.env as Env & { SLACK_BOT_TOKEN: string }).SLACK_BOT_TOKEN;
  }

  private async slackGet<T>(
    method: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const data = (await res.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`);
    return data;
  }

  private async slackPost<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`);
    return data;
  }

  /**
   * Send a DM to a user by email.
   * The caller must hold `slack:send_message` permission.
   */
  @RequirePermission("slack:send_message")
  async sendMessage(
    email: string,
    text: string,
  ): Promise<{ ok: boolean; ts: string }> {
    const { user } = await this.slackGet<{ user: { id: string } }>(
      "users.lookupByEmail",
      { email },
    );
    const { channel } = await this.slackPost<{ channel: { id: string } }>(
      "conversations.open",
      { users: user.id },
    );
    const { ts } = await this.slackPost<{ ts: string }>("chat.postMessage", {
      channel: channel.id,
      text,
    });
    return { ok: true, ts };
  }
}

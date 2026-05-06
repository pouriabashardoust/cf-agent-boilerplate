// BOILERPLATE / REFERENCE ONLY — example WorkerEntrypoint showing the
// `@RequirePermission` pattern. Replace with your own entity bindings.
import { WorkerEntrypoint } from "cloudflare:workers";
import { neon } from "@neondatabase/serverless";

import { RequirePermission } from "../shared/permissions";

export class Database extends WorkerEntrypoint<Env> {
  private get sql() {
    return neon((this.env as Env & { DATABASE_URL: string }).DATABASE_URL);
  }

  /**
   * Caller must hold `database:list_tables`. Returns every table in the
   * `public` schema.
   */
  @RequirePermission("database:list_tables")
  async listTables(): Promise<{
    tables: { name: string; comment: string | null }[];
  }> {
    const rows = (await this.sql`
      SELECT
        c.relname AS table_name,
        obj_description(c.oid, 'pg_class') AS table_comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
      ORDER BY c.relname
    `) as { table_name: string; table_comment: string | null }[];
    return {
      tables: rows.map((r) => ({
        name: r.table_name,
        comment: r.table_comment,
      })),
    };
  }

  /** Caller must hold `database:get_blocked_jobs`. */
  @RequirePermission("database:get_blocked_jobs")
  async getBlockedJobs(): Promise<{ jobs: unknown[] }> {
    const rows = await this.sql`
      SELECT * FROM "JobEvents"
      LIMIT 10
    `;
    return { jobs: rows as unknown[] };
  }

  /** Caller must hold `database:unblock_job`. Unblocks a job by id. */
  @RequirePermission("database:unblock_job")
  async unblockJob(jobId: string): Promise<{ ok: boolean }> {
    await this.sql`
      UPDATE blocked_jobs SET blocked = false WHERE id = ${jobId}
    `;
    return { ok: true };
  }
}

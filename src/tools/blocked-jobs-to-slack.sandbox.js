export default {
  async fetch(_req, env) {
    const { jobs } = await env.DATABASE.getBlockedJobs();
    const text =
      `Found ${jobs.length} blocked job(s):\n` +
      JSON.stringify(jobs, null, 2);
    const slack = await env.SLACK.sendMessage("you@example.com", text);
    return Response.json({ jobs, slack });
  },
};

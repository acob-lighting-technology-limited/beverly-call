import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { AppDeps } from '../app.js'
import { isJobName, runJob } from '../jobs/job-runner.js'

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Scheduled jobs over HTTP, for hosts with no worker process (Vercel crons, Supabase Cron, any scheduler).
 * Authenticated by `Authorization: Bearer <CRON_SECRET>`, which is what Vercel Cron sends. Refused outright when CRON_SECRET is unset.
 * A failed or partial run answers 500 so the scheduler shows it as failed.
 */
export const cronRoutes = ({ env, pool, storage, push }: AppDeps): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { job: string } }>('/cron/:job', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const secret = env.CRON_SECRET
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!secret || !given || !safeEqual(given, secret)) return reply.code(401).send({ error: 'Unauthorized' })
    if (!isJobName(req.params.job)) return reply.code(404).send({ error: 'Unknown job' })
    try {
      const out = await runJob(req.params.job, { env, pool, storage, push })
      return reply.code(out.exitCode === 0 ? 200 : 500).send(out.result)
    } catch (e) {
      req.log.error(e, 'cron job crashed')
      return reply.code(500).send({ error: 'Job failed' })
    }
  })
}

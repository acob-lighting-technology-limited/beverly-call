import pg from 'pg'
import { loadEnv } from '../config/env.js'
import { dbSsl } from '../db/ssl.js'
import { isJobName, runJob } from './job-runner.js'

/**
 * Scheduler entry point: `tsx src/jobs/run-jobs.ts <job>` where job is purge | ingest | sweep | verify-audit.
 * Run ingest and sweep every minute, purge and verify-audit daily. A non-zero exit signals the scheduler to alert.
 * On Vercel the same jobs run through the secured `GET /api/cron/:job` endpoint instead.
 */
const job = process.argv[2] ?? ''
if (!isJobName(job)) {
  console.error('Usage: run-jobs.ts purge | ingest | sweep | verify-audit')
  process.exit(64)
}
const env = loadEnv()
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2, ssl: dbSsl(env) })
try {
  const out = await runJob(job, { env, pool })
  console.log(JSON.stringify(out.result))
  process.exitCode = out.exitCode
} finally {
  await pool.end()
}

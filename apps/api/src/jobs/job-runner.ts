import type { Pool } from 'pg'
import type { Env } from '../config/env.js'
import type { RecordingStorage } from '../storage/recording-storage.js'
import { supabaseRecordingStorage } from '../storage/recording-storage.js'
import { webPushSender, type PushSender } from '../notify/notify.js'
import { purgeExpiredRecordings } from './purge-recordings.js'
import { ingestRecordings } from './ingest-recordings.js'
import { notifySweep } from './notify-sweep.js'
import { verifyStoredChain } from '../audit/audit-log.js'

export const JOB_NAMES = ['purge', 'ingest', 'sweep', 'verify-audit'] as const
export type JobName = (typeof JOB_NAMES)[number]
export const isJobName = (s: string): s is JobName => (JOB_NAMES as readonly string[]).includes(s)

export interface JobDeps { env: Env; pool: Pool; storage?: RecordingStorage; push?: PushSender | null }
/** `exitCode` 0 = healthy, 1 = something failed and will be retried, 2 = audit chain broken. Schedulers alert on non-zero. */
export interface JobOutcome { exitCode: 0 | 1 | 2; result: Record<string, unknown> }

/** The one place jobs are wired up, shared by the CLI (`run-jobs.ts`) and the secured cron endpoint. */
export async function runJob(job: JobName, { env, pool, storage, push }: JobDeps): Promise<JobOutcome> {
  if (job === 'purge') {
    const r = await purgeExpiredRecordings(pool, storage ?? supabaseRecordingStorage(env))
    return { exitCode: r.failed ? 1 : 0, result: { job, ...r } }
  }
  if (job === 'ingest') {
    const r = await ingestRecordings(pool, storage ?? supabaseRecordingStorage(env))
    return { exitCode: r.failed ? 1 : 0, result: { job, ...r } }
  }
  if (job === 'sweep') {
    return { exitCode: 0, result: { job, created: await notifySweep(pool, push === undefined ? webPushSender(env) : push) } }
  }
  const r = await verifyStoredChain(pool)
  return { exitCode: r.brokenAt === null ? 0 : 2, result: { job, ...r } }
}

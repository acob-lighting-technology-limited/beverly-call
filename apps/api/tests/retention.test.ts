import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../src/config/env.js'
import { purgeExpiredRecordings } from '../src/jobs/purge-recordings.js'
import { runJob } from '../src/jobs/job-runner.js'
import { boot, hook, testEnv, type Harness } from './helpers.js'

const cfg = { DATABASE_URL: 'postgres://u:p@h:6543/db', BEVERLY_AUTH_URL: 'https://a.test', BEVERLY_AUTH_ANON_KEY: 'k', BEVERLY_API_URL: 'https://b.test', SESSION_SECRET: 'x'.repeat(40), ALLOWED_ORIGIN: 'https://x.test' }

describe('retention setting', () => {
  it('defaults to never and accepts a number of days', () => {
    expect(loadEnv(cfg).RECORDING_RETENTION_DAYS).toBeNull()
    expect(loadEnv({ ...cfg, RECORDING_RETENTION_DAYS: 'never' }).RECORDING_RETENTION_DAYS).toBeNull()
    expect(loadEnv({ ...cfg, RECORDING_RETENTION_DAYS: '30' }).RECORDING_RETENTION_DAYS).toBe(30)
  })
  it('rejects nonsense instead of guessing', () => {
    for (const bad of ['0', '-5', 'forever', 'abc', '99999']) expect(() => loadEnv({ ...cfg, RECORDING_RETENTION_DAYS: bad }), bad).toThrow(/RECORDING_RETENTION_DAYS/)
  })
})

describe('recordings are kept forever by default', () => {
  let h: Harness
  beforeAll(async () => { h = await boot() })
  beforeEach(async () => { await h.reset() })
  afterAll(async () => { await h.app.close() })

  const seed = async (keys: [string, boolean][] = [['old1', false], ['old2', false], ['held', true]]): Promise<void> => {
    await h.pool.query(`insert into call_centre.calls (at_session_id, direction, caller_number, queue) values ('P','inbound','0803','general')`)
    const cid = (await h.pool.query<{ id: string }>('select id from call_centre.calls')).rows[0]!.id
    for (const [k, hold] of keys) await h.pool.query(`insert into call_centre.recordings (call_id, storage_key, storage_bucket, expires_at, legal_hold) values ($1,$2,'b', now() - interval '400 days', $3)`, [cid, k, hold])
  }

  it('a new recording from the carrier never expires', async () => {
    await hook(h, '/api/webhooks/at/voice', { sessionId: 'F1', isActive: '0', callerNumber: '0803', durationInSeconds: '60', recordingUrl: 'https://rec.test/f.mp3' })
    const r = await h.pool.query<{ forever: boolean }>(`select expires_at = 'infinity'::timestamptz as forever from call_centre.recordings`)
    expect(r.rows).toEqual([{ forever: true }])
  })

  it('with retention set to days, a new recording expires after that many days', async () => {
    const h30 = await boot({ RECORDING_RETENTION_DAYS: '30' })
    await hook(h30, '/api/webhooks/at/voice', { sessionId: 'D1', isActive: '0', callerNumber: '0803', durationInSeconds: '60', recordingUrl: 'https://rec.test/d.mp3' })
    const r = await h30.pool.query<{ days: number }>(`select round(extract(epoch from (expires_at - now())) / 86400)::int as days from call_centre.recordings`)
    expect(r.rows).toEqual([{ days: 30 }])
    await h30.app.close()
  })

  it('the purge job deletes nothing in never mode, even rows that already carry an old expiry, and logs the run', async () => {
    await seed()
    expect(await purgeExpiredRecordings(h.pool, h.fakes.storage, { neverDelete: true })).toEqual({ deleted: 0, held: 0, failed: 0 })
    expect(h.fakes.storage.removed).toEqual([])
    expect((await h.pool.query('select 1 from call_centre.recordings where deleted_at is null')).rowCount).toBe(3)
    expect((await h.pool.query('select 1 from call_centre.retention_runs')).rowCount).toBe(1)
  })

  it('the scheduled job takes the same path from the environment, with no storage configured at all', async () => {
    await seed()
    const out = await runJob('purge', { env: testEnv(), pool: h.pool })
    expect(out).toMatchObject({ exitCode: 0, result: { job: 'purge', deleted: 0, held: 0, failed: 0 } })
    expect((await h.pool.query('select 1 from call_centre.recordings where deleted_at is null')).rowCount).toBe(3)
  })

  it('with retention set to days, the same job still deletes what has expired (the days mode is not broken)', async () => {
    await seed()
    const out = await runJob('purge', { env: testEnv({ RECORDING_RETENTION_DAYS: '30' }), pool: h.pool, storage: h.fakes.storage })
    expect(out.result).toMatchObject({ deleted: 2, held: 1, failed: 0 })
    expect(h.fakes.storage.removed.sort()).toEqual(['old1', 'old2'])
  })

  it('the admin retention panel and number info report never, with nothing waiting to purge', async () => {
    await seed()
    const adm = await h.as('admin1@x.test')
    expect((await h.get('/api/admin/retention', adm)).json).toMatchObject({ retentionDays: null, pendingPurge: 0 })
    expect((await h.get('/api/admin/number', adm)).json).toMatchObject({ retentionDays: null })
  })
})

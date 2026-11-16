import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHandler, restoreUrl, serverlessEnv } from '../src/serverless-handler.js'
import { ORIGIN, WEBHOOK_SECRET, boot, type Harness } from './helpers.js'

const CRON = 'cron-secret-123456'
const base = { DATABASE_URL: 'postgres://u:p@h:6543/db', BEVERLY_AUTH_URL: 'https://a.test', BEVERLY_AUTH_ANON_KEY: 'k', BEVERLY_API_URL: 'https://b.test', SESSION_SECRET: 'x'.repeat(40) }

describe('serverlessEnv', () => {
  it('derives the origin from the platform host: production alias in production, deployment host elsewhere', () => {
    expect(serverlessEnv({ ...base, VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'call.example.com', VERCEL_URL: 'x-123.vercel.app' }).ALLOWED_ORIGIN).toBe('https://call.example.com')
    expect(serverlessEnv({ ...base, VERCEL_ENV: 'preview', VERCEL_URL: 'x-123.vercel.app' }).ALLOWED_ORIGIN).toBe('https://x-123.vercel.app')
  })
  it('lets explicit settings win, forces production mode and uses the bundled CA only when none is set', () => {
    const e = serverlessEnv({ ...base, ALLOWED_ORIGIN: 'https://mine.test', API_PUBLIC_URL: 'https://api.mine.test', VERCEL_URL: 'x.vercel.app', NODE_ENV: 'development', DATABASE_SSL_CA: 'own-ca' }, 'bundled-ca')
    expect(e).toMatchObject({ ALLOWED_ORIGIN: 'https://mine.test', API_PUBLIC_URL: 'https://api.mine.test', NODE_ENV: 'production', DATABASE_SSL_CA: 'own-ca' })
    expect(serverlessEnv({ ...base, VERCEL_URL: 'x.vercel.app' }, 'bundled-ca').DATABASE_SSL_CA).toBe('bundled-ca')
  })
  it('fails closed when required settings are missing instead of guessing', () => {
    expect(() => serverlessEnv({ ...base, SESSION_SECRET: 'short', VERCEL_URL: 'x.vercel.app' })).toThrow(/SESSION_SECRET/)
    expect(() => serverlessEnv({ ...base })).toThrow(/ALLOWED_ORIGIN/)
  })
})

describe('restoreUrl', () => {
  it('restores the original path and query from the Vercel rewrite', () => {
    expect(restoreUrl('/api/index?__pathname=/api/auth/login')).toBe('/api/auth/login')
    expect(restoreUrl('/api/index?q=musa&__pathname=/api/customers')).toBe('/api/customers?q=musa')
    expect(restoreUrl('/api/health?...path=health')).toBe('/api/health')
    expect(restoreUrl('/api/index?path=a%2Fb&__pathname=/api/a/b')).toBe('/api/a/b')
    expect(restoreUrl('/api/customers?path=keep')).toBe('/api/customers?path=keep')
    expect(restoreUrl('/api/cron/sweep')).toBe('/api/cron/sweep')
  })
  it('refuses anything that is not a clean /api path', () => {
    for (const bad of ['/index.html', '/api/index?__pathname=/etc/passwd', '/api/index?__pathname=/api/../admin', '/api/index?__pathname=//evil.test/api', '/apix/health']) expect(restoreUrl(bad), bad).toBeNull()
  })
})

describe('cron endpoint', () => {
  let h: Harness
  beforeAll(async () => { h = await boot({ CRON_SECRET: CRON }) })
  afterAll(async () => { await h.app.close() })
  const run = (job: string, auth?: string) => h.app.inject({ url: `/api/cron/${job}`, headers: auth ? { authorization: auth } : {} })

  it('refuses a missing or wrong bearer secret', async () => {
    expect((await run('sweep')).statusCode).toBe(401)
    expect((await run('sweep', 'Bearer nope-nope-nope-nope')).statusCode).toBe(401)
    expect((await run('sweep', CRON)).statusCode).toBe(401)
  })
  it('runs each job with the right secret and reports its result', async () => {
    const sweep = await run('sweep', `Bearer ${CRON}`)
    expect(sweep.statusCode).toBe(200)
    expect(sweep.json()).toMatchObject({ job: 'sweep' })
    const audit = await run('verify-audit', `Bearer ${CRON}`)
    expect(audit.statusCode).toBe(200)
    expect(audit.json()).toMatchObject({ job: 'verify-audit', brokenAt: null })
    expect((await run('purge', `Bearer ${CRON}`)).statusCode).toBe(200)
    expect((await run('ingest', `Bearer ${CRON}`)).statusCode).toBe(200)
  })
  it('404s an unknown job and is refused outright when no CRON_SECRET is configured', async () => {
    expect((await run('rm-rf', `Bearer ${CRON}`)).statusCode).toBe(404)
    const open = await boot({})
    expect((await open.app.inject({ url: '/api/cron/sweep', headers: { authorization: 'Bearer undefined-undefined' } })).statusCode).toBe(401)
    await open.app.close()
  })
})

describe('Vercel handler over real HTTP', () => {
  let h: Harness
  let server: Server
  let url: string
  beforeAll(async () => {
    h = await boot()
    server = createServer(createHandler(async () => h.app))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => { server.close(); await h.app.close() })

  it('serves health and unknown routes', async () => {
    expect((await fetch(`${url}/api/health`)).status).toBe(200)
    expect((await fetch(`${url}/api/nope`)).status).toBe(404)
  })
  it('passes JSON bodies, sets the session cookie and honours it on the next request', async () => {
    const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'agent1@x.test', password: 'x' }) })
    expect(login.status).toBe(204)
    const setCookie = login.headers.getSetCookie()[0]!
    expect(setCookie).toMatch(/HttpOnly/i)
    const me = await fetch(`${url}/api/session`, { headers: { cookie: setCookie.split(';')[0]! } })
    expect(me.status).toBe(200)
    expect(((await me.json()) as { role: string }).role).toBe('agent')
  })
  it('routes a Vercel-rewritten request to the original path', async () => {
    const r = await fetch(`${url}/api/index?__pathname=/api/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'ok' })
    expect((await fetch(`${url}/api/index?__pathname=/etc/passwd`)).status).toBe(404)
  })
  it('refuses a cross-origin write through the handler', async () => {
    const r = await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.test' } })
    expect(r.status).toBe(403)
  })
  it('delivers form-encoded carrier webhooks untouched', async () => {
    const body = new URLSearchParams({ sessionId: 'VERCEL1', isActive: '1', callerNumber: '+2348035550142', direction: 'inbound' }).toString()
    const ok = await fetch(`${url}/api/webhooks/at/voice`, { method: 'POST', headers: { 'x-webhook-secret': WEBHOOK_SECRET, 'content-type': 'application/x-www-form-urlencoded' }, body })
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('<Response>')
    const bad = await fetch(`${url}/api/webhooks/at/voice`, { method: 'POST', headers: { 'x-webhook-secret': 'wrong', 'content-type': 'application/x-www-form-urlencoded' }, body })
    expect(bad.status).toBe(401)
  })
  it('answers a generic 500 with no internals when the app cannot start', async () => {
    const dead = createServer(createHandler(async () => { throw new Error('postgres://secret@host exploded') }))
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r))
    const r = await fetch(`http://127.0.0.1:${(dead.address() as AddressInfo).port}/api/health`)
    const text = await r.text()
    dead.close()
    expect(r.status).toBe(500)
    expect(text).not.toContain('postgres')
  })
})

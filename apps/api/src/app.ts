import { STATUS_CODES } from 'node:http'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { Pool } from 'pg'
import type { Env } from './config/env.js'
import { verifySession, type VerifiedSession } from './auth/session-token.js'
import type { FetchLike } from './beverly/beverly-auth.js'
import { authRoutes } from './routes/auth-routes.js'
import { healthRoutes } from './routes/health-routes.js'
import { caseRoutes } from './routes/case-routes.js'
import { callbackRoutes } from './routes/callback-routes.js'
import { callRoutes } from './routes/call-routes.js'
import { monitorRoutes } from './routes/monitor-routes.js'
import { customerRoutes } from './routes/customer-routes.js'
import { bindingRoutes } from './routes/binding-routes.js'
import { agentRoutes } from './routes/agent-routes.js'
import { shiftRoutes } from './routes/shift-routes.js'
import { adminRoutes } from './routes/admin-routes.js'
import { webhookRoutes } from './routes/webhook-routes.js'
import formbody from '@fastify/formbody'
import type { RecordingStorage } from './storage/recording-storage.js'
import type { CommunicationsProvider } from './telephony/provider.js'
import type { PushSender } from './notify/notify.js'
import { presenceRoutes } from './routes/presence-routes.js'
import { supervisionRoutes } from './routes/supervision-routes.js'
import { inboxRoutes } from './routes/inbox-routes.js'
import { supportRoutes } from './routes/support-routes.js'

export const COOKIE = 'bc_session'

declare module 'fastify' {
  interface FastifyRequest { session: VerifiedSession | null }
}

/** Everything the app depends on. Tests inject fakes; production leaves optional deps undefined to use real ones. */
export interface AppDeps {
  env: Env
  pool: Pool
  fetchImpl?: FetchLike
  storage?: RecordingStorage
  provider?: CommunicationsProvider
  /** null disables push; undefined builds the real sender from env. */
  push?: PushSender | null
  /** Test seam: called once per registered route, so tests can prove every route is covered by the access matrix. */
  onRoute?: (method: string, url: string) => void
}

/** Builds the Fastify app. Pure function of its dependencies so tests can inject a fake pool and Beverly. */
/** The allowed origin exactly. In development only, `localhost` and `127.0.0.1` on the same port count as the same origin. */
export function originAllowed(origin: string | undefined, allowed: string, nodeEnv: string): boolean {
  if (origin === allowed) return true
  if (nodeEnv !== 'development' || !origin) return false
  const loop = (o: string) => { try { const u = new URL(o); return ['localhost', '127.0.0.1'].includes(u.hostname) ? `${u.protocol}//loopback:${u.port}` : null } catch { return null } }
  const a = loop(allowed)
  return a !== null && a === loop(origin)
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      // Carrier webhooks authenticate with ?secret=...; never write it (or any token in a query string) to the logs.
      serializers: { req: (r) => ({ method: r.method, url: r.url?.replace(/([?&](?:secret|token|key|apikey)=)[^&]*/gi, '$1[redacted]'), host: r.host, remoteAddress: r.ip }) },
    },
    // Trust only the proxies we actually run (see TRUST_PROXY_HOPS), so X-Forwarded-For cannot be spoofed to dodge rate limits.
    trustProxy: (_address: string, hop: number): boolean => hop < env.TRUST_PROXY_HOPS,
    // Every JSON body here is small (notes, replies, filters); a tight cap bounds memory per request.
    bodyLimit: 262_144,
  })

  // Never leak internals: 5xx replies carry a fixed message, the detail goes to the log only. Client errors keep their message.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) { req.log.error({ err }, 'request failed'); return reply.code(status).send({ error: 'Internal error' }) }
    return reply.code(status).send({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', message: err.message })
  })

  // Accept an empty body on JSON requests (POSTs like logout or start carry none) instead of failing with 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, undefined)
    try { done(null, JSON.parse(body as string)) } catch { const e = new Error('Invalid JSON') as Error & { statusCode: number }; e.statusCode = 400; done(e, undefined) }
  })
  if (deps.onRoute) app.addHook('onRoute', (r) => { for (const m of [r.method].flat()) if (m !== 'HEAD' && m !== 'OPTIONS') deps.onRoute!(m, r.url) })
  await app.register(helmet)
  await app.register(cookie)
  await app.register(formbody)
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' })

  // Reject cross-site writes: browsers always send Origin on cross-origin POSTs.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.url.startsWith('/api/webhooks/') && !originAllowed(req.headers.origin, env.ALLOWED_ORIGIN, env.NODE_ENV)) {
      return reply.code(403).send({ error: 'Origin not allowed' })
    }
  })

  app.decorateRequest('session', null)
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const raw = req.cookies[COOKIE]
    req.session = raw ? await verifySession(raw, env.SESSION_SECRET) : null
  })

  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(authRoutes(deps), { prefix: '/api' })
  await app.register(caseRoutes(deps), { prefix: '/api' })
  await app.register(callbackRoutes(deps), { prefix: '/api' })
  await app.register(presenceRoutes(deps), { prefix: '/api' })
  await app.register(callRoutes(deps), { prefix: '/api' })
  await app.register(monitorRoutes(deps), { prefix: '/api' })
  await app.register(supervisionRoutes(deps), { prefix: '/api' })
  await app.register(inboxRoutes(deps), { prefix: '/api' })
  await app.register(supportRoutes(deps), { prefix: '/api' })
  await app.register(customerRoutes(deps), { prefix: '/api' })
  await app.register(bindingRoutes(deps), { prefix: '/api' })
  await app.register(agentRoutes(deps), { prefix: '/api' })
  await app.register(shiftRoutes(deps), { prefix: '/api' })
  await app.register(adminRoutes(deps), { prefix: '/api' })
  await app.register(webhookRoutes(deps), { prefix: '/api' })
  return app
}

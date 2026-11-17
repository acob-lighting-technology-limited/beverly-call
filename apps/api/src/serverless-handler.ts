import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { loadEnv, type Env } from './config/env.js'

/** Platform-provided values fill in what a deployment can know about itself; anything set explicitly wins. */
export function serverlessEnv(source: Record<string, string | undefined>, bundledCa?: string): Env {
  const host = source.VERCEL_ENV === 'production' ? source.VERCEL_PROJECT_PRODUCTION_URL : source.VERCEL_URL
  const self = host ? `https://${host}` : undefined
  return loadEnv({
    ...source,
    NODE_ENV: 'production',
    ALLOWED_ORIGIN: source.ALLOWED_ORIGIN ?? self,
    API_PUBLIC_URL: source.API_PUBLIC_URL ?? self,
    // Push services want a contact for the sender: use the site itself rather than a made-up mailbox.
    VAPID_SUBJECT: source.VAPID_SUBJECT ?? self,
    DATABASE_SSL_CA: source.DATABASE_SSL_CA ?? bundledCa,
  })
}

/**
 * Vercel rewrites /api/* to one function and passes the original path in `__pathname`. Restore it, drop the helper
 * parameter, and refuse anything that is not an /api path. Returns null for a request that cannot be routed.
 */
export function restoreUrl(raw: string): string | null {
  const u = new URL(raw, 'http://internal')
  const forwarded = u.searchParams.get('__pathname')
  u.searchParams.delete('__pathname')
  u.searchParams.delete('...path')
  if (forwarded) u.searchParams.delete('path') // Vercel adds the rewrite's own :path parameter to the query
  const path = forwarded ?? u.pathname
  if (!/^\/api(\/|$)/.test(path) || path.includes('//') || path.split('/').includes('..')) return null
  const qs = u.searchParams.toString()
  return path + (qs ? `?${qs}` : '')
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(Buffer.from(c as Uint8Array))
  return chunks.length ? Buffer.concat(chunks) : undefined
}

/** Builds the (req, res) handler around any app source, so tests can supply their own app. */
export const createHandler = (appOf: () => Promise<FastifyInstance>) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  try {
    const url = restoreUrl(req.url ?? '/')
    if (!url) { res.statusCode = 404; res.setHeader('content-type', 'application/json'); res.end('{"error":"Not found"}'); return }
    const app = await appOf()
    // Read the raw stream (never `req.body`): carrier webhooks are form-encoded and must reach Fastify untouched.
    const payload = await readBody(req)
    const headers = { ...req.headers }
    delete headers['content-length']
    const r = await app.inject({ method: (req.method ?? 'GET') as InjectOptions['method'], url, headers: headers as InjectOptions['headers'], payload })
    res.statusCode = r.statusCode
    for (const [k, v] of Object.entries(r.headers)) {
      if (v === undefined || k === 'transfer-encoding' || k === 'content-length') continue
      res.setHeader(k, v as string | string[])
    }
    res.end(r.rawPayload)
  } catch (e) {
    console.error('api function failed', e)
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'Service unavailable' }))
  }
}

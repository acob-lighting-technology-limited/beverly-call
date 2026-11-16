import { describe, expect, it } from 'vitest'
import { boot, ORIGIN } from './helpers.js'
import { signSession, verifySession } from '../src/auth/session-token.js'

/** Production hardening: encrypted sessions, spoof-proof rate limiting, masked server errors. */
describe('session cookie', () => {
  const user = { id: 'u1', name: 'Test', role: 'agent' as const }
  const secret = 'a'.repeat(40)

  it('is encrypted: neither the user record nor the Beverly token can be read from it', async () => {
    const jwt = await signSession(user, 'BEVERLY-ACCESS-TOKEN-123', secret, 60)
    expect(jwt.split('.')).toHaveLength(5) // JWE compact form: header, key, iv, ciphertext, tag
    const raw = Buffer.from(jwt.split('.').join(''), 'base64url').toString('latin1')
    expect(jwt).not.toContain('BEVERLY-ACCESS-TOKEN')
    expect(raw).not.toContain('BEVERLY-ACCESS-TOKEN')
    expect(JSON.stringify(await verifySession(jwt, secret))).toContain('BEVERLY-ACCESS-TOKEN-123')
  })

  it('rejects a tampered cookie, another secret, and an expired session', async () => {
    const jwt = await signSession(user, 't', secret, 60)
    expect(await verifySession(jwt.slice(0, -4) + 'AAAA', secret)).toBeNull()
    expect(await verifySession(jwt, 'b'.repeat(40))).toBeNull()
    expect(await verifySession(await signSession(user, 't', secret, -5), secret)).toBeNull()
    expect(await verifySession('not-a-token', secret)).toBeNull()
  })
})

describe('rate limiting behind one proxy', () => {
  it('cannot be dodged by spoofing X-Forwarded-For: the proxy appends the real client address last', async () => {
    const h = await boot({ LOGIN_RATE_LIMIT: '3', TRUST_PROXY_HOPS: '1' })
    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await h.app.inject({
        method: 'POST', url: '/api/auth/login',
        headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}, 203.0.113.9` },
        payload: { email: 'agent1@x.test', password: 'x' },
      })
      codes.push(r.statusCode)
    }
    expect(codes).toContain(429)
    expect(codes.indexOf(429)).toBeLessThanOrEqual(3)
  })
})

describe('error replies', () => {
  it('never expose internal detail on a 5xx, and keep client errors readable', async () => {
    const h = await boot({})
    h.app.get('/api/_boom', async () => { throw new Error('connection to db-internal-host:5432 refused') })
    const boom = await h.app.inject({ url: '/api/_boom' })
    expect(boom.statusCode).toBe(500)
    expect(boom.body).not.toContain('db-internal-host')
    expect(JSON.parse(boom.body)).toEqual({ error: 'Internal error' })

    const bad = await h.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN, 'content-type': 'application/json' }, payload: '{bad' })
    expect(bad.statusCode).toBe(400)
    expect(JSON.parse(bad.body).message).toBe('Invalid JSON')
  })

  it('refuses oversized bodies before parsing them', async () => {
    const h = await boot({})
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN, 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(300_000) }) })
    expect(r.statusCode).toBe(413)
  })
})

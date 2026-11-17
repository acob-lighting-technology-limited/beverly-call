import { describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../src/config/env.js'
import { StorageUnavailable } from '../src/storage/recording-storage.js'
import { CHUNK_SIZE, SIMPLE_UPLOAD_LIMIT, sharepointRecordingStorage } from '../src/storage/sharepoint-storage.js'
import { recordingStorage, storageBackend } from '../src/storage/index.js'

const base = { DATABASE_URL: 'postgres://u:p@h:6543/db', BEVERLY_AUTH_URL: 'https://a.test', BEVERLY_AUTH_ANON_KEY: 'k', BEVERLY_API_URL: 'https://b.test', SESSION_SECRET: 'x'.repeat(40), ALLOWED_ORIGIN: 'https://x.test' }
const sp = { AZURE_TENANT_ID: 'tenant-1', AZURE_CLIENT_ID: 'client-1', AZURE_CLIENT_SECRET: 'secret-1', SHAREPOINT_SITE_ID: 'host.sharepoint.com,aaa,bbb' }
const env = (extra: Record<string, string> = {}) => loadEnv({ ...base, ...sp, ...extra })
const SITE = encodeURIComponent(sp.SHAREPOINT_SITE_ID)

interface Call { url: string; init: RequestInit }
/** Fake Microsoft: token endpoint plus a scripted Graph. `graph` answers every non-token request. */
function fake(graph: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://login.microsoftonline.com/')) {
      calls.push({ url, init })
      return new Response(JSON.stringify({ access_token: 'graph-token', expires_in: 3600 }), { status: 200 })
    }
    const c = { url, init }
    calls.push(c)
    return graph(c, calls.filter((x) => !x.url.startsWith('https://login.')).length)
  })
  return { f: f as never, calls, graphCalls: () => calls.filter((c) => !c.url.startsWith('https://login.')) }
}

describe('sharepointRecordingStorage', () => {
  it('refuses to start when any of the four settings is missing', () => {
    for (const k of Object.keys(sp)) {
      const partial = { ...sp } as Record<string, string>
      delete partial[k]
      expect(() => sharepointRecordingStorage(loadEnv({ ...base, ...partial }))).toThrow(StorageUnavailable)
    }
  })

  it('signs in with client credentials for the Graph default scope and reuses the token', async () => {
    const m = fake(() => new Response('{}', { status: 200 }))
    const st = sharepointRecordingStorage(env(), m.f)
    await st.upload('call-recordings', 'a.mp3', new Uint8Array(3), 'audio/mpeg')
    await st.upload('call-recordings', 'b.mp3', new Uint8Array(3), 'audio/mpeg')
    const tokenCalls = m.calls.filter((c) => c.url.startsWith('https://login.'))
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0]!.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
    const form = new URLSearchParams(String(tokenCalls[0]!.init.body))
    expect(Object.fromEntries(form)).toEqual({ client_id: 'client-1', client_secret: 'secret-1', scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
    expect((m.graphCalls()[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer graph-token')
  })

  it('maps bucket and key to a path in the site drive and replaces an existing file on a small upload', async () => {
    const m = fake(() => new Response('{}', { status: 201 }))
    const bytes = new Uint8Array(10)
    await sharepointRecordingStorage(env(), m.f).upload('call-recordings', '2026/11/call #1 (a).mp3', bytes, 'audio/mpeg')
    const c = m.graphCalls()[0]!
    expect(c.init.method).toBe('PUT')
    expect(c.url).toBe(`https://graph.microsoft.com/v1.0/sites/${SITE}/drive/root:/call-recordings/2026/11/call%20%231%20(a).mp3:/content?@microsoft.graph.conflictBehavior=replace`)
    expect((c.init.headers as Record<string, string>)['content-type']).toBe('audio/mpeg')
  })

  it('uploads a file over 4 MiB through an upload session in 320 KiB-aligned chunks, without sending the bearer to the session URL', async () => {
    const size = SIMPLE_UPLOAD_LIMIT * 2 + 1234
    expect(CHUNK_SIZE % (320 * 1024)).toBe(0)
    const ranges: string[] = []
    const m = fake((c, n) => {
      if (c.url.includes(':/createUploadSession')) return new Response(JSON.stringify({ uploadUrl: 'https://upload.sharepoint.test/session-1' }), { status: 200 })
      ranges.push(String((c.init.headers as Record<string, string>)['content-range']))
      return new Response('{}', { status: ranges.length === Math.ceil(size / CHUNK_SIZE) ? 201 : 202 })
    })
    await sharepointRecordingStorage(env(), m.f).upload('call-recordings', 'big.mp3', new Uint8Array(size), 'audio/mpeg')
    expect(ranges[0]).toBe(`bytes 0-${CHUNK_SIZE - 1}/${size}`)
    expect(ranges.at(-1)).toBe(`bytes ${(ranges.length - 1) * CHUNK_SIZE}-${size - 1}/${size}`)
    expect(ranges.length).toBe(Math.ceil(size / CHUNK_SIZE))
    const session = m.graphCalls().find((c) => c.url.includes('createUploadSession'))!
    expect(JSON.parse(String(session.init.body))).toEqual({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
    for (const c of m.graphCalls().filter((x) => x.url.startsWith('https://upload.'))) expect((c.init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('cancels the upload session and reports failure when a chunk is rejected', async () => {
    const m = fake((c) => {
      if (c.url.includes(':/createUploadSession')) return new Response(JSON.stringify({ uploadUrl: 'https://upload.sharepoint.test/s' }), { status: 200 })
      if (c.init.method === 'DELETE') return new Response(null, { status: 204 })
      return new Response('{}', { status: 500 })
    })
    await expect(sharepointRecordingStorage(env(), m.f).upload('b', 'k.mp3', new Uint8Array(SIMPLE_UPLOAD_LIMIT + 1), 'audio/mpeg')).rejects.toThrow(/Upload failed at byte 0 \(500\)/)
    expect(m.graphCalls().some((c) => c.url === 'https://upload.sharepoint.test/s' && c.init.method === 'DELETE')).toBe(true)
  })

  it('surfaces small-upload and sign-in failures as StorageUnavailable without leaking secrets', async () => {
    await expect(sharepointRecordingStorage(env(), fake(() => new Response('', { status: 403 })).f).upload('b', 'k', new Uint8Array(1), 'x/y')).rejects.toThrow('Upload failed (403)')
    const bad = vi.fn(async () => new Response('{"error":"invalid_client","error_description":"secret-1 is wrong"}', { status: 401 }))
    const err = await sharepointRecordingStorage(env(), bad as never).signedUrl('b', 'k', 300).catch((e: Error) => e)
    expect(err).toBeInstanceOf(StorageUnavailable)
    expect(String((err as Error).message)).toBe('SharePoint sign-in failed (401)')
  })

  it('returns Microsoft\'s pre-authenticated download link, and says so plainly when the file is missing', async () => {
    const m = fake(() => new Response(JSON.stringify({ id: '1', '@microsoft.graph.downloadUrl': 'https://acob.sharepoint.com/download?tempauth=abc' }), { status: 200 }))
    const url = await sharepointRecordingStorage(env(), m.f).signedUrl('call-recordings', 'x/y.mp3', 300)
    expect(url).toBe('https://acob.sharepoint.com/download?tempauth=abc')
    expect(m.graphCalls()[0]!.url).toBe(`https://graph.microsoft.com/v1.0/sites/${SITE}/drive/root:/call-recordings/x/y.mp3?select=id,@microsoft.graph.downloadUrl`)
    await expect(sharepointRecordingStorage(env(), fake(() => new Response('', { status: 404 })).f).signedUrl('b', 'k', 300)).rejects.toThrow('Recording not found in SharePoint')
    await expect(sharepointRecordingStorage(env(), fake(() => new Response('{"id":"1"}', { status: 200 })).f).signedUrl('b', 'k', 300)).rejects.toThrow('No download link returned')
    await expect(sharepointRecordingStorage(env(), fake(() => new Response('{"@microsoft.graph.downloadUrl":"http://insecure.test/x"}', { status: 200 })).f).signedUrl('b', 'k', 300)).rejects.toThrow('No download link returned')
  })

  it('deletes a file, treats an already-missing file as done, and fails on anything else', async () => {
    const del = fake(() => new Response(null, { status: 204 }))
    await sharepointRecordingStorage(env(), del.f).remove('call-recordings', 'x/y.mp3')
    expect(del.graphCalls()[0]!.init.method).toBe('DELETE')
    await expect(sharepointRecordingStorage(env(), fake(() => new Response('', { status: 404 })).f).remove('b', 'k')).resolves.toBeUndefined()
    await expect(sharepointRecordingStorage(env(), fake(() => new Response('', { status: 500 })).f).remove('b', 'k')).rejects.toThrow('Delete failed (500)')
  })
})

describe('storage backend selection', () => {
  const supa = { RECORDINGS_STORAGE_URL: 'https://p.supabase.co', RECORDINGS_STORAGE_KEY: 'k' }
  it('prefers SharePoint, falls back to Supabase, and reports none', () => {
    expect(storageBackend(env())).toBe('sharepoint')
    expect(storageBackend(env(supa))).toBe('sharepoint')
    expect(storageBackend(loadEnv({ ...base, ...supa }))).toBe('supabase')
    expect(storageBackend(loadEnv({ ...base }))).toBeNull()
    const partial = { ...sp } as Record<string, string>
    delete partial.SHAREPOINT_SITE_ID
    expect(storageBackend(loadEnv({ ...base, ...partial, ...supa }))).toBe('supabase')
  })
  it('throws StorageUnavailable when nothing is configured', () => {
    expect(() => recordingStorage(loadEnv({ ...base }))).toThrow(StorageUnavailable)
  })
})

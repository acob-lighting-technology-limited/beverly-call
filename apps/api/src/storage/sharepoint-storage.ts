import type { Env } from '../config/env.js'
import type { FetchLike } from '../beverly/beverly-auth.js'
import { StorageUnavailable, type RecordingStorage } from './recording-storage.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
/** Graph accepts a single PUT up to 4 MiB; anything larger goes through an upload session. */
export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024
/** Upload-session chunks must be a multiple of 320 KiB; 12 x 320 KiB = 3.75 MiB. */
export const CHUNK_SIZE = 12 * 320 * 1024

const seg = (s: string): string => encodeURIComponent(s)

/**
 * Recording storage in a SharePoint site's default document library, through Microsoft Graph with an app-only
 * (client credentials) token. `bucket` becomes the top-level folder and `key` the path below it, so a recording
 * lands at `<library>/<bucket>/<key>`. Graph creates missing folders on upload.
 *
 * Playback links are Graph's pre-authenticated download URLs. They are short-lived (Microsoft sets the lifetime,
 * about an hour) and cannot be given a custom expiry, so `ttlSeconds` is not honoured; the audit entry for each play
 * is what controls access. Files never pass through this API.
 *
 * The app registration needs the Microsoft Graph application permission Sites.ReadWrite.All, or Sites.Selected with write
 * access granted to this one site (preferred: least privilege).
 */
export function sharepointRecordingStorage(env: Env, f: FetchLike = fetch): RecordingStorage {
  const tenant = env.AZURE_TENANT_ID
  const clientId = env.AZURE_CLIENT_ID
  const secret = env.AZURE_CLIENT_SECRET
  const site = env.SHAREPOINT_SITE_ID
  if (!tenant || !clientId || !secret || !site) throw new StorageUnavailable('SharePoint storage is not configured')

  let cached: { token: string; expiresAt: number } | null = null
  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
    const r = await f(`https://login.microsoftonline.com/${encodeURIComponent(tenant!)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId!, client_secret: secret!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
    })
    if (!r.ok) throw new StorageUnavailable(`SharePoint sign-in failed (${r.status})`)
    const body = (await r.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) throw new StorageUnavailable('SharePoint sign-in returned no token')
    cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
    return cached.token
  }

  const item = (bucket: string, key: string): string => `${GRAPH}/sites/${seg(site!)}/drive/root:/${[bucket, ...key.split('/')].map(seg).join('/')}`
  const call = async (url: string, init: RequestInit = {}): Promise<Response> =>
    f(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${await token()}` } })

  return {
    async upload(bucket, key, bytes, contentType) {
      const target = item(bucket, key)
      if (bytes.byteLength <= SIMPLE_UPLOAD_LIMIT) {
        const r = await call(`${target}:/content?@microsoft.graph.conflictBehavior=replace`, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes as unknown as BodyInit })
        if (!r.ok) throw new StorageUnavailable(`Upload failed (${r.status})`)
        return
      }
      const s = await call(`${target}:/createUploadSession`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })
      if (!s.ok) throw new StorageUnavailable(`Upload session failed (${s.status})`)
      const { uploadUrl } = (await s.json()) as { uploadUrl?: string }
      if (!uploadUrl) throw new StorageUnavailable('No upload URL returned')
      for (let start = 0; start < bytes.byteLength; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE, bytes.byteLength)
        // The session URL is pre-authenticated: sending the bearer token to it is refused.
        const r = await f(uploadUrl, { method: 'PUT', headers: { 'content-length': String(end - start), 'content-range': `bytes ${start}-${end - 1}/${bytes.byteLength}` }, body: bytes.subarray(start, end) as unknown as BodyInit })
        const last = end === bytes.byteLength
        if (!(last ? r.status === 200 || r.status === 201 : r.status === 202)) {
          // Abandon the session so a half-uploaded file is not left behind.
          await f(uploadUrl, { method: 'DELETE' }).catch(() => undefined)
          throw new StorageUnavailable(`Upload failed at byte ${start} (${r.status})`)
        }
      }
    },

    async signedUrl(bucket, key) {
      const r = await call(`${item(bucket, key)}?select=id,@microsoft.graph.downloadUrl`)
      if (r.status === 404) throw new StorageUnavailable('Recording not found in SharePoint')
      if (!r.ok) throw new StorageUnavailable(`Link failed (${r.status})`)
      const body = (await r.json()) as Record<string, unknown>
      const url = body['@microsoft.graph.downloadUrl']
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new StorageUnavailable('No download link returned')
      return url
    },

    async remove(bucket, key) {
      const r = await call(item(bucket, key), { method: 'DELETE' })
      if (!r.ok && r.status !== 404) throw new StorageUnavailable(`Delete failed (${r.status})`)
    },
  }
}

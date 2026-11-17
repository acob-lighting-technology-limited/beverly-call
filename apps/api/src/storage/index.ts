import type { Env } from '../config/env.js'
import type { FetchLike } from '../beverly/beverly-auth.js'
import { supabaseRecordingStorage, type RecordingStorage } from './recording-storage.js'
import { sharepointRecordingStorage } from './sharepoint-storage.js'

export type StorageBackend = 'sharepoint' | 'supabase' | null

/** SharePoint wins when its four settings are all present, then Supabase Storage; null when neither is configured. */
export function storageBackend(env: Env): StorageBackend {
  if (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET && env.SHAREPOINT_SITE_ID) return 'sharepoint'
  if (env.RECORDINGS_STORAGE_URL && env.RECORDINGS_STORAGE_KEY) return 'supabase'
  return null
}

/** The recording store for this deployment. Throws StorageUnavailable when no backend is configured. */
export function recordingStorage(env: Env, f?: FetchLike): RecordingStorage {
  return storageBackend(env) === 'sharepoint' ? sharepointRecordingStorage(env, f) : supabaseRecordingStorage(env, f)
}

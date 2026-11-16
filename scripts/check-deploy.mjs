// Fails a production web build while the API host placeholder is still in vercel.json, so a half-configured deploy never goes live.
import { readFileSync } from 'node:fs'

const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
const cfg = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
if (isProd && cfg.includes('REPLACE_WITH_API_HOST')) {
  console.error('vercel.json still points /api at REPLACE_WITH_API_HOST. Set the real API host before deploying to production.')
  process.exit(1)
}

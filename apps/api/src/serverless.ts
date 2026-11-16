import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { dbSsl } from './db/ssl.js'
import { buildApp } from './app.js'
import { createHandler, serverlessEnv } from './serverless-handler.js'
import supabaseCa from '../certs/supabase-ca.pem'

/**
 * Vercel Function entry, bundled by `pnpm build:serverless` into dist/serverless.mjs and called from the repo's api/ folder.
 * The Fastify app is built once per warm instance; presence and sessions live in Postgres and cookies,
 * so any number of instances can run side by side. Supabase's root CA is bundled so database TLS verification stays on.
 */
let appPromise: Promise<FastifyInstance> | null = null
function getApp(): Promise<FastifyInstance> {
  appPromise ??= (async () => {
    const env = serverlessEnv(process.env, supabaseCa)
    // Small pool: every warm instance holds its own, and the Supabase pooler is shared.
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3, idleTimeoutMillis: 10_000, ssl: dbSsl(env) })
    const app = await buildApp({ env, pool })
    await app.ready()
    return app
  })().catch((e) => { appPromise = null; throw e })
  return appPromise
}

export const handler = createHandler(getApp)

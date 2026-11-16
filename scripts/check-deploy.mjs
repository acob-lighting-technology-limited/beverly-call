// Fails a production build while required configuration is missing, so a half-configured deploy never goes live.
// Previews and local builds are not checked (the API refuses to start without them anyway).
const isProd = process.env.VERCEL_ENV === 'production'
if (isProd) {
  const need = {
    DATABASE_URL: 'Supabase pooler URL for the beverly_call_api role',
    BEVERLY_AUTH_URL: "Beverly's Supabase project URL (staff sign-on)",
    BEVERLY_AUTH_ANON_KEY: "Beverly's Supabase anon key",
    BEVERLY_API_URL: "Beverly's API base URL",
    SESSION_SECRET: 'at least 32 random characters',
    CRON_SECRET: 'at least 16 random characters; Vercel Cron sends it as a Bearer token',
  }
  const bad = Object.entries(need).filter(([k]) => !process.env[k] || (k === 'SESSION_SECRET' && process.env[k].length < 32) || (k === 'CRON_SECRET' && process.env[k].length < 16))
  if (bad.length) {
    console.error('Production build refused. Set these Vercel project environment variables (Production):')
    for (const [k, why] of bad) console.error(`  ${k}: ${why}`)
    process.exit(1)
  }
}

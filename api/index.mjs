// Vercel Function for every /api/* request (vercel.json rewrites /api/:path* here and carries the original path).
// The Fastify API is bundled into apps/api/dist/serverless.mjs by the build command.
import { handler } from '../apps/api/dist/serverless.mjs'

export default handler

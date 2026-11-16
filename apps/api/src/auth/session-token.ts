import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'
import { sessionUserSchema, type SessionUser } from '@beverly-call/shared'

const ISSUER = 'beverly-call'

/** 32-byte AES key derived from the session secret, bound to this purpose so the secret is never used raw. */
const keyFor = (secret: string): Uint8Array => createHash('sha256').update(`beverly-call:session:v1:${secret}`).digest()

/**
 * Issues the session cookie value. It is ENCRYPTED (A256GCM), not just signed, so the Beverly bearer token and the
 * user record inside it cannot be read by anyone holding the cookie, including the browser's own developer tools.
 */
export async function signSession(user: SessionUser, beverlyToken: string, secret: string, ttlMinutes: number): Promise<string> {
  return new EncryptJWT({ user, bt: beverlyToken })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .encrypt(keyFor(secret))
}

export interface VerifiedSession { user: SessionUser; beverlyToken: string }

/** Decrypts and validates a session cookie. Anything tampered, expired, signed-only or from another secret is null. */
export async function verifySession(token: string, secret: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtDecrypt(token, keyFor(secret), { issuer: ISSUER, contentEncryptionAlgorithms: ['A256GCM'], keyManagementAlgorithms: ['dir'] })
    const user = sessionUserSchema.safeParse(payload.user)
    if (!user.success || typeof payload.bt !== 'string') return null
    return { user: user.data, beverlyToken: payload.bt }
  } catch {
    return null
  }
}

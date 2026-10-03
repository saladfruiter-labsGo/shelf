import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Senhas com scrypt (nativo do Node, sem dependência compilada). Parâmetros
 * gravados junto do hash, para poderem subir no futuro sem invalidar senhas.
 * N=2^15, r=8 custa ~32 MB e algumas dezenas de ms por tentativa.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 }
const KEY_LEN = 64
const MAX_MEM = 64 * 1024 * 1024

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 256

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, { ...options, maxmem: MAX_MEM }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, PARAMS)
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, keyB64] = parts
  const expected = Buffer.from(keyB64, 'base64')
  const key = await derive(password, Buffer.from(saltB64, 'base64'), { N: Number(n), r: Number(r), p: Number(p) })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Hash de uma senha que ninguém conhece: login de usuário inexistente gasta o mesmo tempo. */
let dummyHash: Promise<string> | null = null
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64'))
  return dummyHash
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Informe a senha.'
  if (password.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`
  if (password.length > PASSWORD_MAX) return 'Senha longa demais.'
  if (/^(.)\1+$/.test(password)) return 'Escolha uma senha menos previsível.'
  return null
}

/** Senha provisória legível, para o administrador repassar (sem 0/O, 1/l). */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''),
  )
  return groups.join('-')
}

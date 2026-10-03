import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { dataDir } from './core-db.js'

/**
 * Imagens enviadas por pessoas: foto de perfil e prints do feed.
 *
 * Toda imagem é decodificada e regravada em WebP — isso descarta EXIF (GPS,
 * modelo do aparelho) e qualquer conteúdo que não seja pixel. O nome é
 * aleatório e só é servido a quem tem sessão.
 */
export type UploadKind = 'avatars' | 'posts'

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
export const UPLOAD_MAX_BYTES = 12 * 1024 * 1024
const MAX_INPUT_PIXELS = 60_000_000
const FILENAME = /^[a-f0-9]{32}\.webp$/

export class ImageUploadError extends Error {}

function directory(kind: UploadKind): string {
  return path.resolve(process.env.UPLOAD_DIR ?? path.join(dataDir, 'uploads'), kind)
}

export interface SavedImage { file: string; width: number; height: number }

export async function saveImage(file: File, kind: UploadKind): Promise<SavedImage> {
  if (!ACCEPTED.has(file.type)) throw new ImageUploadError('Envie uma imagem JPG, PNG, WebP, GIF ou AVIF.')
  if (file.size > UPLOAD_MAX_BYTES) throw new ImageUploadError('A imagem passa de 12 MB.')

  let output: { data: Buffer; info: { width: number; height: number } }
  try {
    const pipeline = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    output = await (kind === 'avatars'
      ? pipeline.resize(320, 320, { fit: 'cover', position: 'attention' })
      : pipeline.resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    ).webp({ quality: kind === 'avatars' ? 84 : 86, effort: 4 }).toBuffer({ resolveWithObject: true })
  } catch {
    throw new ImageUploadError('Não foi possível ler essa imagem.')
  }

  const name = `${randomBytes(16).toString('hex')}.webp`
  const dir = directory(kind)
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, name)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, output.data)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
  return { file: name, width: output.info.width, height: output.info.height }
}

export async function readImage(kind: UploadKind, name: string): Promise<Buffer | null> {
  if (!FILENAME.test(name)) return null
  try {
    return await readFile(path.join(directory(kind), name))
  } catch {
    return null
  }
}

export async function deleteImage(kind: UploadKind, name: string | null | undefined): Promise<void> {
  if (!name || !FILENAME.test(name)) return
  await rm(path.join(directory(kind), name), { force: true }).catch(() => {})
}

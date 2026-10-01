import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { db } from './db.js'
import { allowedImageUrl } from './routes/img.js'

/**
 * Arte de capa personalizada.
 *
 * A arte escolhida vira o próprio `media_items.cover_url` — é dele que a
 * biblioteca, o diário (join) e o Story leem, então trocar num lugar troca em
 * todos. A capa do provedor fica em `default_cover_url` enquanto
 * `cover_custom = 1`, para o Story poder usá-la e para voltar ao padrão.
 *
 * As integrações gravam a capa com `COALESCE(media_items.cover_url, ...)`, então
 * nenhum sync sobrescreve a escolha do usuário.
 */

export const COVER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
const COVER_WIDTH = 1024
const MAX_INPUT_PIXELS = 40_000_000
const UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

/** Arquivos enviados são endereçados pelo conteúdo: `/api/covers/<sha256>.webp`. */
const LOCAL_COVER = /^\/api\/covers\/([a-f0-9]{64}\.webp)$/
export const COVER_FILENAME = /^[a-f0-9]{64}\.webp$/

export function coverDirectory(): string {
  return path.resolve(process.env.COVER_DIR ?? path.join(process.env.DATA_DIR ?? './data', 'covers'))
}

export function coverFilePath(filename: string): string | null {
  return COVER_FILENAME.test(filename) ? path.join(coverDirectory(), filename) : null
}

export type CoverSource = 'default' | 'current' | 'tmdb' | 'rawg' | 'steam'

export interface CoverOption {
  url:    string
  source: CoverSource
}

export interface CoverChoices {
  current:     string | null
  default:     string | null
  custom:      boolean
  options:     CoverOption[]
  /** Explica por que a galeria veio vazia (sem chave de API, provedor fora do ar...). */
  notice?:     string
}

interface CoverRow {
  id:                number
  type:              string
  external_id:       string
  tmdb_id:           string | null
  steam_appid:       number | string | null
  cover_url:         string | null
  default_cover_url: string | null
  cover_custom:      number
}

const readItem = db.prepare(`
  SELECT id, type, external_id, tmdb_id, steam_appid, cover_url, default_cover_url, cover_custom
    FROM media_items WHERE id = ?
`)

export function getCoverRow(id: number): CoverRow | undefined {
  return readItem.get(id) as CoverRow | undefined
}

/** A capa do provedor: a guardada, se há arte personalizada; senão a atual. */
export function defaultCoverOf(row: CoverRow): string | null {
  return row.cover_custom ? row.default_cover_url : row.cover_url
}

const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
function apiKey(name: string): string | undefined {
  const row = readSetting.get(name) as { value: string } | undefined
  return row?.value?.trim() || process.env[name]
}

async function fetchJson(url: string): Promise<any | null> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const response = await fetch(url, { signal: ctrl.signal })
    return response.ok ? await response.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function tmdbIdOf(row: CoverRow): string | null {
  if (row.tmdb_id && /^\d+$/.test(String(row.tmdb_id))) return String(row.tmdb_id)
  return /^\d+$/.test(row.external_id) ? row.external_id : null
}

async function tmdbPosters(row: CoverRow): Promise<CoverOption[] | string> {
  const key = apiKey('TMDB_API_KEY')
  if (!key) return 'Configure a chave do TMDB em Integrações para ver outros pôsteres.'
  const tmdbId = tmdbIdOf(row)
  if (!tmdbId) return 'Este item não está identificado no TMDB.'

  const endpoint = row.type === 'movie' ? 'movie' : 'tv'
  const params = new URLSearchParams({ api_key: key, include_image_language: 'pt,en,null' })
  const data = await fetchJson(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}/images?${params}`)
  if (!data) return 'O TMDB não respondeu agora. Tente de novo em instantes.'

  const posters = (Array.isArray(data.posters) ? data.posters : []) as { file_path?: string; iso_639_1?: string | null; vote_average?: number }[]
  // Português primeiro, depois os mais votados — é a ordem em que alguém procuraria.
  const rank = (p: { iso_639_1?: string | null }) => (p.iso_639_1 === 'pt' ? 0 : 1)
  return posters
    .filter(p => typeof p.file_path === 'string')
    .sort((a, b) => rank(a) - rank(b) || (b.vote_average ?? 0) - (a.vote_average ?? 0))
    .slice(0, 40)
    .map(p => ({ url: `https://image.tmdb.org/t/p/w500${p.file_path}`, source: 'tmdb' as const }))
}

async function gameArt(row: CoverRow): Promise<CoverOption[] | string> {
  const options: CoverOption[] = []
  const appid = Number(row.steam_appid)
  if (Number.isInteger(appid) && appid > 0) {
    // Arte vertical da biblioteca da Steam: é a que mais se parece com uma capa.
    options.push({ url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`, source: 'steam' })
  }

  const key = apiKey('RAWG_API_KEY')
  if (key && /^\d+$/.test(row.external_id)) {
    const data = await fetchJson(`https://api.rawg.io/api/games/${row.external_id}/screenshots?key=${encodeURIComponent(key)}&page_size=20`)
    for (const shot of (data?.results ?? []) as { image?: string }[]) {
      if (typeof shot.image === 'string' && allowedImageUrl(shot.image)) options.push({ url: shot.image, source: 'rawg' })
    }
  }

  if (options.length === 0) {
    return key ? 'Nenhuma arte alternativa encontrada para este jogo.' : 'Configure a chave da RAWG em Integrações para ver capturas do jogo.'
  }
  return options
}

/** Galeria de artes: a capa padrão, a atual e as alternativas do provedor. */
export async function coverChoices(row: CoverRow): Promise<CoverChoices> {
  const fallback = defaultCoverOf(row)
  const options: CoverOption[] = []
  const seen = new Set<string>()
  const add = (option: CoverOption) => {
    if (seen.has(option.url)) return
    seen.add(option.url)
    options.push(option)
  }

  if (fallback) add({ url: fallback, source: 'default' })
  if (row.cover_custom && row.cover_url) add({ url: row.cover_url, source: 'current' })

  let notice: string | undefined
  const remote = row.type === 'movie' || row.type === 'series'
    ? await tmdbPosters(row)
    : row.type === 'game'
      ? await gameArt(row)
      : 'Para este tipo, envie uma imagem do seu dispositivo.'
  if (typeof remote === 'string') notice = remote
  else remote.forEach(add)

  return { current: row.cover_url, default: fallback, custom: !!row.cover_custom, options, notice }
}

async function localCoverExists(url: string): Promise<boolean> {
  const match = LOCAL_COVER.exec(url)
  if (!match) return false
  try {
    return (await stat(path.join(coverDirectory(), match[1]))).isFile()
  } catch {
    return false
  }
}

/**
 * Só aceita arte que o Shelf consegue servir com segurança: um host de capa
 * permitido pelo proxy de imagens, um arquivo já enviado, ou a própria capa
 * padrão (que pode ser um endpoint local do Plex/Kavita).
 */
export async function acceptableCoverUrl(row: CoverRow, url: string): Promise<boolean> {
  if (url === defaultCoverOf(row) || url === row.cover_url) return true
  if (allowedImageUrl(url)) return true
  return localCoverExists(url)
}

const setCustom = db.prepare(`
  UPDATE media_items SET
    default_cover_url = CASE WHEN cover_custom = 1 THEN default_cover_url ELSE cover_url END,
    cover_url = ?, cover_custom = 1, updated_at = datetime('now')
  WHERE id = ?
`)
const restore = db.prepare(`
  UPDATE media_items SET
    cover_url = default_cover_url, default_cover_url = NULL, cover_custom = 0, updated_at = datetime('now')
  WHERE id = ? AND cover_custom = 1
`)
const stillReferenced = db.prepare(`
  SELECT 1 FROM media_items WHERE cover_url = ? OR default_cover_url = ? LIMIT 1
`)

/** Apaga o arquivo enviado que deixou de ser usado por qualquer item. */
async function dropOrphanUpload(url: string | null): Promise<void> {
  if (!url) return
  const match = LOCAL_COVER.exec(url)
  if (!match || stillReferenced.get(url, url)) return
  await rm(path.join(coverDirectory(), match[1]), { force: true }).catch(() => {})
}

/** Aplica a arte ao item. Escolher a capa padrão equivale a restaurá-la. */
export async function applyCover(row: CoverRow, url: string): Promise<void> {
  const previous = row.cover_url
  if (url === defaultCoverOf(row)) restore.run(row.id)
  else setCustom.run(url, row.id)
  if (previous !== url) await dropOrphanUpload(previous)
}

export async function restoreDefaultCover(row: CoverRow): Promise<void> {
  const previous = row.cover_custom ? row.cover_url : null
  restore.run(row.id)
  await dropOrphanUpload(previous)
}

/**
 * Normaliza a imagem enviada (orientação EXIF, largura máxima, WebP) e grava
 * no volume de dados. O nome é o hash do resultado: reenviar a mesma arte não
 * duplica o arquivo.
 */
export async function saveUploadedCover(file: File): Promise<string> {
  if (!UPLOAD_TYPES.has(file.type)) throw new CoverUploadError('Envie uma imagem JPG, PNG, WebP, GIF ou AVIF.')
  if (file.size > COVER_UPLOAD_MAX_BYTES) throw new CoverUploadError('A imagem passa de 10 MB.')

  let body: Buffer
  try {
    body = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .webp({ quality: 86, effort: 4 })
      .toBuffer()
  } catch {
    throw new CoverUploadError('Não foi possível ler essa imagem.')
  }

  const filename = `${createHash('sha256').update(body).digest('hex')}.webp`
  const target = path.join(coverDirectory(), filename)
  await mkdir(coverDirectory(), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, body)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
  return `/api/covers/${filename}`
}

export async function readUploadedCover(filename: string): Promise<Buffer | null> {
  const file = coverFilePath(filename)
  if (!file) return null
  try {
    return await readFile(file)
  } catch {
    return null
  }
}

export class CoverUploadError extends Error {}

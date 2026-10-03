/**
 * Texto de posts, comentários e mensagens: sempre texto puro (o navegador
 * escapa tudo), com dois marcadores que viram links na tela:
 *
 * - `@usuario` — menção a uma pessoa da instância;
 * - `[[tipo:id-externo|Título]]` — marcação de uma mídia (filme, série,
 *   jogo, livro ou música), inserida pelo seletor do compositor.
 *
 * O servidor só guarda o que reconhece: menções a contas ativas e mídias com
 * tipo válido. Capa e ano da mídia vêm do compositor e só são aceitos como
 * URL https (ou capa local do próprio Shelf).
 */
import { core } from '../core-db.js'
import { isMediaType, type MediaType } from '../media-domain.js'

export const MENTION_RE = /(^|[^\w.@])@([a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?)/gi
export const MEDIA_TOKEN_RE = /\[\[(movie|series|game|book|music):([^|\]\s][^|\]]{0,99})\|([^\]]{1,160})\]\]/g

export interface MediaRef {
  type: MediaType
  external_id: string
  title: string
  cover_url: string | null
  year: number | null
}

export interface Mention { id: number; username: string; display_name: string }

const MAX_REFS = 10
const MAX_MENTIONS = 20

export function safeCoverUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000) return null
  if (/^https:\/\//i.test(value)) return value
  if (/^\/api\/covers\/[a-f0-9]{64}\.webp$/.test(value)) return value
  return null
}

function cleanYear(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 1800 && n < 2200 ? n : null
}

/** Mídias marcadas no texto, enriquecidas com capa/ano enviados pelo compositor. */
export function extractRefs(body: string, provided: unknown): MediaRef[] {
  const extras = new Map<string, { cover_url: string | null; year: number | null }>()
  if (Array.isArray(provided)) {
    for (const raw of provided.slice(0, 50)) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      if (!isMediaType(r.type) || typeof r.external_id !== 'string') continue
      extras.set(`${r.type}:${r.external_id}`, { cover_url: safeCoverUrl(r.cover_url), year: cleanYear(r.year) })
    }
  }
  const refs: MediaRef[] = []
  const seen = new Set<string>()
  for (const match of body.matchAll(MEDIA_TOKEN_RE)) {
    const [, type, externalId, title] = match
    const key = `${type}:${externalId}`
    if (seen.has(key)) continue
    seen.add(key)
    const extra = extras.get(key)
    refs.push({
      type: type as MediaType, external_id: externalId, title: title.trim(),
      cover_url: extra?.cover_url ?? null, year: extra?.year ?? null,
    })
    if (refs.length >= MAX_REFS) break
  }
  // Mídias anexadas pelo seletor (viram cartões no post, sem marcador no texto).
  if (Array.isArray(provided)) {
    for (const raw of provided.slice(0, 50)) {
      if (refs.length >= MAX_REFS) break
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      if (!isMediaType(r.type) || typeof r.external_id !== 'string' || typeof r.title !== 'string') continue
      const externalId = r.external_id.trim().slice(0, 100)
      const title = r.title.trim().slice(0, 160)
      const key = `${r.type}:${externalId}`
      if (!externalId || !title || seen.has(key)) continue
      seen.add(key)
      refs.push({ type: r.type, external_id: externalId, title, cover_url: safeCoverUrl(r.cover_url), year: cleanYear(r.year) })
    }
  }
  return refs
}

/** Pessoas mencionadas que existem e estão ativas. */
export function extractMentions(body: string): Mention[] {
  const names = new Set<string>()
  // Menções dentro de marcadores de mídia não contam (um título com "@").
  const plain = body.replace(MEDIA_TOKEN_RE, ' ')
  for (const match of plain.matchAll(MENTION_RE)) {
    names.add(match[2].toLowerCase())
    if (names.size >= MAX_MENTIONS) break
  }
  const result: Mention[] = []
  for (const username of names) {
    const row = core("SELECT id, username, display_name FROM users WHERE username = ? AND status = 'active'").get(username) as Mention | undefined
    if (row) result.push(row)
  }
  return result
}

/** Normaliza o texto digitado: sem caracteres de controle, quebras de linha preservadas. */
export function cleanBody(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const text = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
  if (text.length > max) return null
  return text
}

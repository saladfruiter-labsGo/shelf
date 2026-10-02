/**
 * Programas que a Steam (e o Playnite) tratam como jogo, mas não são: ficam
 * abertos o dia todo e encheriam o Shelf de "jogando agora", diário e
 * atividade. Nunca entram na biblioteca; o que já entrou é apagado.
 */
import { db } from '../db.js'
import { normalizeTitle } from '../prices/matcher.js'

const HIDDEN_APPIDS = new Set<number>([
  431960, // Wallpaper Engine
])
const HIDDEN_TITLES = new Set(['wallpaper engine'])

export function isHiddenGame(game: { appid?: number | null; title?: string | null }): boolean {
  if (game.appid != null && HIDDEN_APPIDS.has(Number(game.appid))) return true
  return !!game.title && HIDDEN_TITLES.has(normalizeTitle(game.title))
}

/** Apaga os cards (diário e listas vão junto, por cascata) e a atividade dos programas ocultos. */
export function purgeHiddenGames(): number {
  const rows = db.prepare("SELECT id, external_id, title, steam_appid FROM media_items WHERE type = 'game'")
    .all() as { id: number; external_id: string; title: string; steam_appid: number | null }[]
  const hidden = rows.filter(r => isHiddenGame({ appid: r.steam_appid, title: r.title }))
  const refs = new Set([...hidden.map(r => r.external_id), ...[...HIDDEN_APPIDS].map(id => `steam:${id}`)])

  const activity = (db.prepare("SELECT id, external_ref, title FROM activity_events WHERE media_type = 'game'")
    .all() as { id: number; external_ref: string | null; title: string }[])
    .filter(a => (a.external_ref && refs.has(a.external_ref)) || isHiddenGame({ title: a.title }))

  const deleteItem = db.prepare('DELETE FROM media_items WHERE id = ?')
  const deleteActivity = db.prepare('DELETE FROM activity_events WHERE id = ?')
  db.transaction(() => {
    for (const row of hidden) deleteItem.run(row.id)
    for (const event of activity) deleteActivity.run(event.id)
  })()
  return hidden.length
}

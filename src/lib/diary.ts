import type { DiaryEntry } from '../types'

/**
 * Escopo de um registro do diário. Séries geram registros de três alcances
 * diferentes e o diário, o detalhe da mídia e a arte de Story precisam falar
 * a mesma língua sobre qual deles está em jogo.
 */
export type DiaryScope =
  | { kind: 'episode'; tag: string; name: string | null; label: string }
  | { kind: 'season';  tag: string; name: string | null; label: string }

type ScopeFields = Pick<DiaryEntry, 'season_number' | 'episode_number' | 'season_title' | 'episode_title'>

/**
 * Descreve o alcance do registro: episódio (`T2E5`), temporada (`Temporada 2`)
 * ou `null` quando a entrada é da obra inteira. `name` traz o título próprio do
 * episódio/temporada quando ele acrescenta algo ao `tag`.
 */
export function diaryScope(entry: ScopeFields): DiaryScope | null {
  if (entry.season_number == null) return null

  if (entry.episode_number != null) {
    return {
      kind: 'episode',
      tag: `T${entry.season_number}E${entry.episode_number}`,
      name: entry.episode_title?.trim() || null,
      label: 'Episódio',
    }
  }

  const tag = `Temporada ${entry.season_number}`
  const title = entry.season_title?.trim() || null
  return { kind: 'season', tag, name: title && title !== tag ? title : null, label: 'Temporada' }
}

/** Texto de uma linha: `T2E5 · O Encontro`. */
export function diaryScopeText(scope: DiaryScope | null): string | null {
  if (!scope) return null
  return scope.name ? `${scope.tag} · ${scope.name}` : scope.tag
}

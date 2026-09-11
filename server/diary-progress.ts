import { db } from './db.js'

export type DiaryProgressSource = 'kavita' | 'playnite'
export type DiaryProgressUnit = 'pages' | 'seconds'

interface ProgressInput {
  mediaItemId: number
  source: DiaryProgressSource
  value: number
  total: number | null
  unit: DiaryProgressUnit
  rating: number | null
  observedAt: string
}

interface PendingProgress {
  media_item_id: number
  source: DiaryProgressSource
  progress_day: string
  progress_value: number
  progress_total: number | null
  progress_unit: DiaryProgressUnit
  rating: number | null
  observed_at: string
}

const saveProgress = (database: typeof db) => database.prepare(`
  INSERT INTO diary_progress
    (media_item_id, source, progress_day, progress_value, progress_total, progress_unit, rating, observed_at)
  VALUES (@media_item_id, @source, @progress_day, @progress_value, @progress_total, @progress_unit, @rating, @observed_at)
  ON CONFLICT(media_item_id, source, progress_day) DO UPDATE SET
    progress_value = excluded.progress_value,
    progress_total = excluded.progress_total,
    progress_unit  = excluded.progress_unit,
    rating         = excluded.rating,
    observed_at    = excluded.observed_at
  WHERE diary_progress.finalized_at IS NULL
    AND excluded.observed_at >= diary_progress.observed_at
`)

function configuredTimeZone(): string {
  const candidate = process.env.SHELF_TIMEZONE?.trim() || 'America/Sao_Paulo'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format()
    return candidate
  } catch {
    return 'America/Sao_Paulo'
  }
}

/** Retorna o dia civil do usuário, não necessariamente o dia UTC do timestamp. */
export function localDiaryDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid progress timestamp')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: configuredTimeZone(),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

/**
 * Guarda o último progresso recebido no dia. A linha é um staging durável:
 * assim uma queda perto da meia-noite não perde a atividade antes do job.
 */
export function recordDiaryProgress(input: ProgressInput, database: typeof db = db): void {
  if (!Number.isInteger(input.mediaItemId) || input.mediaItemId <= 0) return
  if (!Number.isFinite(input.value) || input.value < 0) return
  const observedAt = new Date(input.observedAt)
  if (Number.isNaN(observedAt.getTime())) return

  saveProgress(database).run({
    media_item_id: input.mediaItemId,
    source: input.source,
    progress_day: localDiaryDay(observedAt),
    progress_value: Math.round(input.value),
    progress_total: input.total == null ? null : Math.max(0, Math.round(input.total)),
    progress_unit: input.unit,
    rating: input.rating && input.rating > 0 ? input.rating : null,
    observed_at: observedAt.toISOString(),
  })
}

/**
 * Materializa no diário os dias encerrados. O filtro `progress_day < today`
 * também faz catch-up depois de uma parada do servidor, sem fechar o dia que
 * ainda está em andamento.
 */
export function runDiaryProgressJob(now = new Date(), database: typeof db = db): number {
  const today = localDiaryDay(now)
  const pending = database.prepare(`
    SELECT p.media_item_id, p.source, p.progress_day, p.progress_value,
           p.progress_total, p.progress_unit, p.rating, p.observed_at
      FROM diary_progress p
      JOIN media_items m ON m.id = p.media_item_id
     WHERE p.finalized_at IS NULL AND p.progress_day < ?
     ORDER BY p.progress_day, p.media_item_id
  `).all(today) as PendingProgress[]
  if (!pending.length) return 0

  const insertDiary = database.prepare(`
    INSERT INTO diary_entries
      (media_item_id, watched_at, rating, comment, source,
       progress_day, progress_value, progress_total, progress_unit)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `)
  const alreadyInDiary = database.prepare(`
    SELECT 1 FROM diary_entries
     WHERE media_item_id = ? AND source = ? AND progress_day = ?
     LIMIT 1
  `)
  const finalize = database.prepare(`
    UPDATE diary_progress SET finalized_at = ?
     WHERE media_item_id = ? AND source = ? AND progress_day = ? AND finalized_at IS NULL
  `)
  const finalizedAt = new Date().toISOString()

  return database.transaction(() => {
    let created = 0
    for (const row of pending) {
      if (!alreadyInDiary.get(row.media_item_id, row.source, row.progress_day)) {
        insertDiary.run(
          row.media_item_id,
          row.observed_at,
          row.rating,
          row.source,
          row.progress_day,
          row.progress_value,
          row.progress_total,
          row.progress_unit,
        )
        created++
      }
      finalize.run(finalizedAt, row.media_item_id, row.source, row.progress_day)
    }
    return created
  })()
}

let progressTimer: NodeJS.Timeout | null = null

/** Executa no boot e depois a cada minuto; o primeiro tick após meia-noite fecha o dia anterior. */
export function startDiaryProgressJob(): void {
  if (progressTimer) return
  const tick = () => {
    try {
      const created = runDiaryProgressJob()
      if (created > 0) console.log(`[diary] ${created} progresso(s) adicionado(s) ao diário`)
    } catch (error) {
      console.error('[diary] job de progresso falhou:', error)
    }
  }
  tick()
  progressTimer = setInterval(tick, 60_000)
  progressTimer.unref()
}

export function stopDiaryProgressJob(): void {
  if (progressTimer) clearInterval(progressTimer)
  progressTimer = null
}

import { db } from './db.js'

/* Base da API do Telegram (sobrescrevível em testes via env). */
const TG_BASE = process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org'

/* Config lida da tabela settings (mesma usada pelas integrações). */
const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')

function cfg(key: string): string {
  const row = readSetting.get(key) as { value: string } | undefined
  return row?.value ?? ''
}

const TYPE_LABEL: Record<string, string> = {
  movie:  'Filme',
  series: 'Série',
  game:   'Game',
  book:   'Livro',
}

const STATUS_LABEL: Record<string, string> = {
  wishlist:    'Lista de desejos',
  in_progress: 'Em progresso',
  completed:   'Concluído',
  dropped:     'Abandonado',
}

const EVENT_EMOJI: Record<string, string> = {
  added:       '➕',
  wishlist:    '📝',
  in_progress: '▶️',
  completed:   '✅',
  dropped:     '🚫',
  rated:       '⭐',
}

/** Só notificamos itens da biblioteca (filme, série, game, livro). */
export function notifiableType(type: string): boolean {
  return type in TYPE_LABEL
}

/** Envia texto (HTML) ao Telegram usando a config salva. Fire-and-forget. */
export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = cfg('TELEGRAM_BOT_TOKEN')
  const chatId = cfg('TELEGRAM_CHAT_ID')
  const threadId = cfg('TELEGRAM_THREAD_ID')
  if (!token || !chatId) return { ok: false, error: 'Telegram não configurado' }
  try {
    const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }
    // Tópico de grupo (modo fórum) — só inclui se for um id numérico válido
    if (threadId && /^\d+$/.test(threadId)) payload.message_thread_id = Number(threadId)
    const r = await fetch(`${TG_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await r.json()) as { ok: boolean; description?: string }
    return data.ok ? { ok: true } : { ok: false, error: data.description ?? 'erro do Telegram' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** getUpdates para descobrir o chat_id (e o tópico) de quem já mandou mensagem ao bot. */
export async function telegramDetectChats(): Promise<{ chat_id: string; thread_id: string; name: string }[]> {
  const token = cfg('TELEGRAM_BOT_TOKEN')
  if (!token) return []
  try {
    const r = await fetch(`${TG_BASE}/bot${token}/getUpdates`)
    const data = (await r.json()) as any
    const seen = new Map<string, { chat_id: string; thread_id: string; name: string }>()
    for (const u of data?.result ?? []) {
      const msg = u.message ?? u.channel_post
      const chat = msg?.chat
      if (!chat) continue
      const chatName = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ?? chat.username ?? String(chat.id)
      // tópico (fórum): message_thread_id + nome do tópico quando disponível
      const threadId = msg.is_topic_message && msg.message_thread_id ? String(msg.message_thread_id) : ''
      const topicName =
        msg.forum_topic_created?.name ??
        msg.reply_to_message?.forum_topic_created?.name ??
        (threadId ? `Tópico ${threadId}` : '')
      const name = threadId ? `${chatName} › ${topicName}` : chatName
      // chave única por chat+tópico
      seen.set(`${chat.id}:${threadId}`, { chat_id: String(chat.id), thread_id: threadId, name })
    }
    return [...seen.values()]
  } catch {
    return []
  }
}

/**
 * Notifica uma atividade da biblioteca (adicionado, concluído, abandonado, ...).
 * Não bloqueia a resposta da rota — erros são engolidos.
 */
export function notifyLibraryActivity(opts: {
  event: string // 'added' | 'wishlist' | 'in_progress' | 'completed' | 'dropped' | 'rated'
  type: string
  title: string
  rating?: number | null
}) {
  if (cfg('TELEGRAM_ENABLED') !== '1') return
  if (!notifiableType(opts.type)) return

  const emoji = EVENT_EMOJI[opts.event] ?? '📚'
  const typeLabel = TYPE_LABEL[opts.type] ?? opts.type
  const action =
    opts.event === 'added'
      ? 'Adicionado à biblioteca'
      : opts.event === 'rated'
        ? `Avaliado ${opts.rating ?? ''}★`.trim()
        : STATUS_LABEL[opts.event] ?? opts.event

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const stars = opts.event !== 'rated' && opts.rating ? `  ·  ${opts.rating}★` : ''
  const text = `${emoji} <b>${esc(action)}</b>\n${typeLabel}: <b>${esc(opts.title)}</b>${stars}`

  // fire-and-forget
  sendTelegram(text).catch(() => {})
}

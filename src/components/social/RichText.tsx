import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMediaPreview } from '../MediaSummaryModal'
import { CATEGORIES } from '../../lib/categories'
import type { MediaRef, Mention } from '../../types'

const TOKEN = /\[\[(movie|series|game|book|music):([^|\]]+)\|([^\]]+)\]\]|(^|[^\w.@])@([a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/gi

const emojiOf = (type: string) => CATEGORIES.find(c => c.key === type)?.emoji ?? '🎞️'

/**
 * Texto de post/comentário/mensagem. Tudo é texto (o React escapa); só
 * menções conhecidas, mídias marcadas e links http(s) viram elementos.
 */
export function RichText({ body, mentions = [], refs = [], className = '' }: {
  body: string
  mentions?: Mention[]
  refs?: MediaRef[]
  className?: string
}) {
  const { openMedia } = useMediaPreview()
  const known = new Map(mentions.map(m => [m.username.toLowerCase(), m]))
  const parts: ReactNode[] = []
  let last = 0
  for (const match of body.matchAll(TOKEN)) {
    const start = match.index ?? 0
    if (match[1]) {
      parts.push(body.slice(last, start))
      const ref = refs.find(r => r.type === match[1] && r.external_id === match[2])
      parts.push(
        <button
          key={`m${start}`}
          type="button"
          className="social-chip"
          onClick={() => openMedia({ type: match[1] as MediaRef['type'], title: match[3], cover_url: ref?.cover_url ?? null, year: ref?.year ?? null })}
        >
          {emojiOf(match[1])} {match[3]}
        </button>,
      )
      last = start + match[0].length
    } else if (match[5]) {
      const mention = known.get(match[5].toLowerCase())
      const at = start + match[4].length
      parts.push(body.slice(last, at))
      parts.push(mention
        ? <Link key={`u${start}`} to={`/u/${mention.username}`} className="social-mention">@{mention.username}</Link>
        : `@${match[5]}`)
      last = start + match[0].length
    } else if (match[6]) {
      parts.push(body.slice(last, start))
      parts.push(<a key={`l${start}`} href={match[6]} target="_blank" rel="noopener noreferrer nofollow" className="social-link">{match[6]}</a>)
      last = start + match[0].length
    }
  }
  parts.push(body.slice(last))
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`} style={{ fontSize: 16, lineHeight: 1.55 }}>
      {parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}
    </p>
  )
}

import { useMemo, useState } from 'react'
import { usePolling } from '../../../hooks/usePolling'
import { ago } from '../../../format'
import type { ApiResponse, NewsItem, SocialPost } from '../../../types'
import { Empty, Skeleton, SourceBadge } from '../../ui'
import { Panel } from '../Panel'
import type { PanelProps } from './types'

export function NewsPanel({ onClose, style, className }: PanelProps) {
  const news = usePolling<ApiResponse<NewsItem[]>>('/api/news', 600000)
  const social = usePolling<ApiResponse<SocialPost[]>>('/api/news/social', 600000)
  const [src, setSrc] = useState('all')
  const sources = useMemo(() => [...new Set(news.data?.data.map((n) => n.source) ?? [])], [news.data])
  const items = (news.data?.data ?? []).filter((n) => src === 'all' || n.source === src)

  return (
    <Panel title="Actualités" subtitle="Presse locale et réseaux · actualisé toutes les 10 min" meta={news.data?.meta}
      onClose={onClose} style={style} className={className}>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {['all', ...sources].map((s) => (
          <button key={s} type="button" aria-pressed={src === s} onClick={() => setSrc(s)}
            className={`pill shrink-0 whitespace-nowrap ${src === s ? 'pill-on' : 'pill-off'}`}>
            {s === 'all' ? 'Toutes' : s}
          </button>
        ))}
      </div>

      {news.loading && !news.data ? <Skeleton h={300} /> : items.length === 0 ? <Empty>Aucun article.</Empty> : (
        <div className="flex flex-col -mt-1">
          {items.map((n) => (
            <article key={n.id} className="flex gap-3 py-3 border-b border-line last:border-0">
              {n.image && <img src={n.image} alt="" loading="lazy" className="w-[72px] h-[60px] rounded-lg object-cover shrink-0" />}
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex gap-2 items-center text-[11px]">
                  <span className="font-bold text-ink2">{n.source}</span>
                  <span className="font-mono text-muted">{ago(n.published)}</span>
                </div>
                <a href={n.link ?? '#'} target="_blank" rel="noreferrer" className="text-[14px] leading-snug font-semibold text-ink no-underline hover:text-accent">{n.title}</a>
                {n.summary && <p className="m-0 text-[13px] leading-relaxed text-muted line-clamp-2">{n.summary}</p>}
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h3 className="m-0 text-sm font-semibold">Réseaux sociaux</h3>
          <SourceBadge meta={social.data?.meta} />
        </div>
        {social.data?.data.map((s) => (
          <div key={s.id} className="inner p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-xs"><span className="font-bold text-tag">{s.account}</span><span className="font-mono text-muted">{ago(s.published)}</span></div>
            <p className="m-0 text-[13px] leading-snug text-ink2">{s.text}</p>
            <span className="text-[11px] text-muted">via {s.via}{s.link && <> · <a href={s.link} target="_blank" rel="noreferrer" className="text-accent">voir</a></>}</span>
          </div>
        ))}
        {social.data && social.data.meta.status !== 'live' && (
          <p className="m-0 text-xs text-muted">Configurez <code className="font-mono">SOCIAL_FEEDS</code> (flux RSS Mastodon, RSS-Bridge…) pour afficher les publications réelles.</p>
        )}
      </section>
    </Panel>
  )
}

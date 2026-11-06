import { useState } from 'react'
import { rankImage, rankLabel, type RankAsset, type RankState } from '../game/ranks'

/** Rang-Abzeichen (aus der API) – ohne Bild ein schlichtes ◆ */
export function RankBadge({ rank, assets, className = '' }: { rank: Pick<RankState, 'tier' | 'sub'>; assets: readonly RankAsset[]; className?: string }) {
  const src = rankImage(rank, assets)
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span className={`rank-badge ${className}`}>
      {src && failed !== src
        ? <img src={src} alt={rankLabel(rank, assets)} draggable={false} onError={() => setFailed(src)} />
        : <span className="rank-badge-fallback" aria-label={rankLabel(rank, assets)}>◆</span>}
    </span>
  )
}

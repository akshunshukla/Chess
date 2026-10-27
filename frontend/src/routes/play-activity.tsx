import { Link } from 'react-router'
import { usePlay } from '@/features/play/use-play'

export function PlayActivity() {
  const { queue, game } = usePlay()
  const live = game?.status === 'active' || game?.status === 'waiting'
  const searching = queue === 'joining' || queue === 'searching' || queue === 'leaving'
  if (!live && !searching && queue !== 'recovering') return null

  const label = queue === 'recovering' ? 'Restore your match'
    : live ? 'View your match'
      : queue === 'leaving' ? 'Cancelling search…' : 'Finding an opponent…'

  return (
    <Link to="/play" className="mt-4 flex w-fit items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </Link>
  )
}

import { History, ScanLine, Swords } from 'lucide-react'
import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'

const destinations = [
  { to: '/play', label: 'Play', icon: Swords },
  { to: '/history', label: 'History', icon: History },
  { to: '/analysis', label: 'Analysis', icon: ScanLine },
] as const

export function AppNavigation({ className }: { className?: string }) {
  return (
    <nav aria-label="Main navigation" className={cn('grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-1.5', className)}>
      {destinations.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => cn(
            'flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-xs font-medium transition-colors lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:py-3 lg:text-sm',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon className="size-4 shrink-0 lg:size-5" aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

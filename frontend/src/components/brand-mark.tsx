export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" />
      <rect x="18" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="2" y="18" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="18" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  )
}

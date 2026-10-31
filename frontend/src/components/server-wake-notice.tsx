import { useSyncExternalStore } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { isServerWaking, subscribeToServerWake } from '@/lib/server-wake'

export function ServerWakeNotice() {
  const waking = useSyncExternalStore(subscribeToServerWake, isServerWaking)
  if (!waking) return null

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
      <Alert role="status" className="border-primary/30 shadow-lg">
        <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <AlertDescription>Waking the free server, this takes about a minute.</AlertDescription>
      </Alert>
    </div>
  )
}

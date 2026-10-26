import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface AuthNoticeProps {
  message: string
  variant?: 'error' | 'success' | 'info'
}

export function AuthNotice({ message, variant = 'info' }: AuthNoticeProps) {
  const Icon = variant === 'error' ? CircleAlert : variant === 'success' ? CircleCheck : Info

  return (
    <Alert
      variant={variant === 'error' ? 'destructive' : 'default'}
      role={variant === 'error' ? 'alert' : 'status'}
      className={variant === 'success' ? 'border-primary/30 bg-primary/5' : undefined}
    >
      <Icon aria-hidden="true" className={variant === 'success' ? 'text-primary' : undefined} />
      <AlertDescription className="leading-6 break-words">{message}</AlertDescription>
    </Alert>
  )
}

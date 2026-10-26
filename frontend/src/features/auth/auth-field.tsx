import { useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuthFieldProps extends ComponentProps<typeof Input> {
  id: string
  name: string
  label: string
  error?: string
  hint?: string
}

export function AuthField({ id, label, error, hint, type, ...inputProps }: AuthFieldProps) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  const isPassword = type === 'password'
  const descriptionIds = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ')

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          {...inputProps}
          id={id}
          type={isPassword && passwordVisible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionIds || undefined}
          className={isPassword ? 'h-11 pr-12' : 'h-11'}
        />
        {isPassword && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            aria-pressed={passwordVisible}
            aria-controls={id}
            onClick={() => setPasswordVisible((visible) => !visible)}
            className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
          >
            {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        )}
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs leading-5 text-destructive">{error}</p>}
    </div>
  )
}

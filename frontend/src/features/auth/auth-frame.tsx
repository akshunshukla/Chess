import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { BrandMark } from '@/components/brand-mark'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'

interface AuthFrameProps {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}

export function AuthFrame({ eyebrow, title, description, children }: AuthFrameProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <a href="#auth-content" className="sr-only rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50">
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6 sm:px-10">
          <Link to="/" aria-label="Chess home" className="flex items-center gap-3 rounded-sm">
            <BrandMark className="size-8 text-primary" />
            <span className="text-2xl font-bold tracking-tight">chess<span className="text-primary">.</span></span>
          </Link>
          <Link to="/" className="flex items-center gap-2 rounded-sm text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back home
          </Link>
        </div>
      </header>

      <main id="auth-content" tabIndex={-1} className="flex flex-1 items-center justify-center px-5 py-10 outline-none sm:px-8 sm:py-16">
        <Card className="w-full max-w-lg gap-6 py-7 [--card-spacing:--spacing(6)] sm:py-8 sm:[--card-spacing:--spacing(8)]">
          <CardHeader className="gap-3">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">{eyebrow}</p>
            <h1 className="text-3xl leading-tight font-semibold tracking-tight break-words">{title}</h1>
            <CardDescription className="text-sm leading-6">{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>

      <footer className="px-6 pb-6 text-center text-xs text-muted-foreground">Less noise. More chess.</footer>
    </div>
  )
}

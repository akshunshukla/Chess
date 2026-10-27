import type { ReactNode } from 'react'
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'

interface FeaturePreviewProps {
  icon: LucideIcon
  title: string
  description: string
  children?: ReactNode
}

export function FeaturePreview({ icon: Icon, title, description, children }: FeaturePreviewProps) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[auto_1fr] lg:gap-8">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-secondary text-primary">
          <Icon className="size-7" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-5">
          <div>
            <Badge variant="outline" className="mb-4 text-muted-foreground">Coming soon</Badge>
            <h2 className="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
      </CardContent>
      <CardFooter className="px-6 py-4 sm:px-8">
        <Button asChild variant="outline" className="h-10 gap-2">
          <Link to="/play"><ArrowLeft className="size-4" aria-hidden="true" />Back to Play</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

import { Dialog } from 'radix-ui'
import { defaultPieces } from 'react-chessboard'
import { Button } from '@/components/ui/button'

type PromotionPiece = 'q' | 'r' | 'b' | 'n'

interface PromotionDialogProps {
  open: boolean
  color: 'w' | 'b'
  onChoose: (piece: PromotionPiece) => void
  onCancel: () => void
  onRestoreFocus: () => void
}

const choices = [
  { piece: 'q', name: 'Queen' },
  { piece: 'r', name: 'Rook' },
  { piece: 'b', name: 'Bishop' },
  { piece: 'n', name: 'Knight' },
] as const

export function PromotionDialog({ open, color, onChoose, onCancel, onRestoreFocus }: PromotionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xl outline-none sm:p-6"
          onCloseAutoFocus={(event) => {
            // A board move opens this dialog, so there is no trigger to restore.
            event.preventDefault()
            onRestoreFocus()
          }}
        >
          <div className="space-y-2">
            <Dialog.Title className="text-lg font-semibold">Promote your pawn</Dialog.Title>
            <Dialog.Description className="text-sm leading-6 text-muted-foreground">
              Choose the piece your pawn becomes.
            </Dialog.Description>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {choices.map(({ piece, name }) => {
              const Piece = defaultPieces[`${color}${piece.toUpperCase()}`]
              return (
                <Button
                  key={piece}
                  type="button"
                  variant="outline"
                  className="h-auto min-w-0 flex-col gap-1 px-1 py-3 text-xs"
                  onClick={() => onChoose(piece)}
                >
                  {Piece && (
                    <span aria-hidden="true" className="size-10">
                      <Piece svgStyle={{ width: '100%', height: '100%' }} />
                    </span>
                  )}
                  <span>{name}</span>
                </Button>
              )
            })}
          </div>
          <Dialog.Close asChild>
            <Button type="button" variant="ghost" className="h-10 w-full">Cancel</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

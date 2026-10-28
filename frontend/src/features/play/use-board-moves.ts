import { useMemo, useState, type CSSProperties } from 'react'
import { Chess, type Square } from 'chess.js'
import { movePiece } from '@/stores/play-store'
import type { PlayGame, PlaySnapshot } from '@/types/play'
import type { MoveInput } from '@/ws/protocol'

export function isSquare(value: string): value is Square {
  return /^[a-h][1-8]$/.test(value)
}

function readPosition(fen: string): Chess | null {
  try { return new Chess(fen) } catch { return null }
}

export function useBoardMoves(game: PlayGame, play: PlaySnapshot) {
  const position = useMemo(() => readPosition(game.fen), [game.fen])
  const connected = play.connection.status === 'connected' && play.queue !== 'recovering'
  const canMove = Boolean(position) && connected && play.queue === 'matched' && game.status === 'active' &&
    game.turn === game.color && !play.pendingMove && !play.resigning && !play.drawPending
  const [selected, setSelected] = useState<Square | null>(null)
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const interactionKey = `${game.gameId}:${game.fen}:${canMove}`
  const [previousKey, setPreviousKey] = useState(interactionKey)
  // Reset selection before painting a different position or changing control.
  if (previousKey !== interactionKey) {
    setPreviousKey(interactionKey)
    setSelected(null)
    setPromotion(null)
    setMessage(null)
  }

  // The stored game stays server-confirmed. This temporary position disappears
  // automatically when the controller clears an acknowledged or rejected move.
  const displayPosition = useMemo(() => {
    const next = readPosition(game.fen)
    const pending = play.pendingMove
    if (next && pending?.gameId === game.gameId && pending.expectedPly === game.moveCount) {
      try { next.move(pending) } catch { return readPosition(game.fen) }
    }
    return next
  }, [game.fen, game.gameId, game.moveCount, play.pendingMove])

  function submit(from: Square, to: Square, promoteTo?: MoveInput['promotion']): boolean {
    if (!canMove || !position) return false
    const legal = position.moves({ square: from, verbose: true }).filter((move) => move.to === to)
    if (!legal.length || position.get(from)?.color !== game.color) {
      setMessage('That move is not available. Choose a highlighted square.')
      return false
    }
    if (legal.some((move) => move.promotion) && !promoteTo) {
      setPromotion({ from, to })
      setMessage(null)
      return false
    }
    if (!legal.some((move) => move.promotion === promoteTo)) return false
    const accepted = movePiece({ from, to, ...(promoteTo ? { promotion: promoteTo } : {}) })
    if (accepted) { setSelected(null); setPromotion(null); setMessage(null) }
    return accepted
  }

  function select(square: string): void {
    if (!canMove || promotion || !position || !isSquare(square)) return
    if (square === selected) { setSelected(null); setMessage(null); return }
    if (selected) {
      const destinations = position.moves({ square: selected, verbose: true })
      if (destinations.some((move) => move.to === square)) {
        submit(selected, square)
        return
      }
    }
    setSelected(position.get(square)?.color === game.color ? square : null)
    setMessage(null)
  }

  function startDrag(square: string | null): void {
    if (canMove && square && isSquare(square) && position?.get(square)?.color === game.color) {
      setSelected(square)
      setMessage(null)
    }
  }

  const styles: Record<string, CSSProperties> = {}
  const lastMove = play.pendingMove ?? (game.historyComplete && game.moves.length === game.moveCount ? game.moves.at(-1) : undefined)
  if (lastMove) {
    styles[lastMove.from] = { backgroundColor: 'var(--board-last-move)' }
    styles[lastMove.to] = { backgroundColor: 'var(--board-last-move)' }
  }
  if (displayPosition?.isCheck()) {
    const king = displayPosition.board().flat().find((piece) => piece?.type === 'k' && piece.color === displayPosition.turn())
    if (king) styles[king.square] = { backgroundColor: 'var(--board-check)' }
  }
  if (selected && canMove && position) {
    styles[selected] = { ...styles[selected], boxShadow: 'inset 0 0 0 4px var(--primary-foreground)' }
    for (const move of position.moves({ square: selected, verbose: true })) {
      styles[move.to] = {
        ...styles[move.to],
        backgroundImage: move.captured
          ? 'radial-gradient(transparent 55%, var(--board-marker) 56%, var(--board-marker) 68%, transparent 69%)'
          : 'radial-gradient(var(--board-marker) 22%, transparent 24%)',
      }
    }
  }

  return {
    canMove, position, displayPosition, styles, message, promotion,
    select, startDrag, submit,
    cancelPromotion: () => { setPromotion(null); setSelected(null) },
    choosePromotion: (piece: NonNullable<MoveInput['promotion']>) => {
      if (promotion) submit(promotion.from, promotion.to, piece)
    },
  }
}

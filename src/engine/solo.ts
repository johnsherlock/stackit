import { type Board, type Placement, canPlay, createBoard, placeCard, startBoard } from './board';
import { type Card, createDeck, createRng, isWild, shuffle } from './cards';
import { type Bounds, DEFAULT_BOUNDS, startPos } from './geometry';

/**
 * SOLO STACK — use the whole DECK to build a single STACK.
 *
 * Draw a card and STACK it, or put it face up on the discard pile. The top of the
 * discard pile can be played at any point instead of drawing. Special cards have no
 * effect; Wilds still turn the STACK and lock everything played before them.
 */

export interface SoloOptions {
  seed: number;
  /** Variation: remove the 4 Wilds before starting. */
  noWilds: boolean;
  /** Variation: when the draw pile runs out, flip the discard pile over and keep going. */
  secondChances: boolean;
}

export type SoloStatus = 'playing' | 'won' | 'finished';

export interface SoloState {
  mode: 'solo';
  options: SoloOptions;
  board: Board;
  /** Last element is the top of the pile. */
  drawPile: Card[];
  /** Last element is the top of the pile. */
  discardPile: Card[];
  /** The card currently in hand, waiting to be played or discarded. */
  hand: Card | null;
  totalCards: number;
  /** Cards placed since the discard pile was last flipped over (null if never flipped). */
  placedSinceRecycle: number | null;
  status: SoloStatus;
}

export type SoloAction =
  | { type: 'draw' }
  | { type: 'take-discard' }
  | { type: 'place'; placement: Placement }
  | { type: 'discard' }
  | { type: 'recycle' };


export function newSoloGame(options: SoloOptions, bounds: Bounds = DEFAULT_BOUNDS): SoloState {
  const rng = createRng(options.seed);
  const drawPile = shuffle(createDeck({ includeWilds: !options.noWilds }), rng);
  const totalCards = drawPile.length;

  // The first card can be anything but a Wild; a Wild goes back into the middle of the DECK.
  let first = drawPile.pop()!;
  while (isWild(first)) {
    drawPile.splice(Math.floor(drawPile.length / 2), 0, first);
    first = drawPile.pop()!;
  }

  return {
    mode: 'solo',
    options,
    board: startBoard(createBoard(bounds), first, startPos(bounds)),
    drawPile,
    discardPile: [],
    hand: null,
    totalCards,
    placedSinceRecycle: null,
    status: 'playing',
  };
}

export const discardTop = (state: SoloState): Card | null => state.discardPile.at(-1) ?? null;

export function canTakeDiscard(state: SoloState): boolean {
  const top = discardTop(state);
  return state.status === 'playing' && state.hand === null && top !== null && canPlay(state.board, top);
}

export function canRecycle(state: SoloState): boolean {
  return (
    state.status === 'playing' &&
    state.options.secondChances &&
    state.hand === null &&
    state.drawPile.length === 0 &&
    state.discardPile.length > 0 &&
    // Stop once a full pass through the pile places nothing.
    (state.placedSinceRecycle === null || state.placedSinceRecycle > 0)
  );
}

export class IllegalActionError extends Error {}

function fail(message: string): never {
  throw new IllegalActionError(message);
}

export function applySoloAction(state: SoloState, action: SoloAction): SoloState {
  if (state.status !== 'playing') fail('The game is over');
  const next = structuredClone(state);

  switch (action.type) {
    case 'draw':
      if (next.hand) fail('Play or discard your card first');
      if (next.drawPile.length === 0) fail('The draw pile is empty');
      next.hand = next.drawPile.pop()!;
      break;

    case 'take-discard':
      if (!canTakeDiscard(state)) fail('The top discard cannot be taken');
      next.hand = next.discardPile.pop()!;
      break;

    case 'place':
      if (!next.hand) fail('No card in hand');
      next.board = placeCard(next.board, next.hand, action.placement);
      next.hand = null;
      if (next.placedSinceRecycle !== null) next.placedSinceRecycle++;
      break;

    case 'discard':
      if (!next.hand) fail('No card in hand');
      next.discardPile.push(next.hand);
      next.hand = null;
      break;

    case 'recycle':
      if (!canRecycle(state)) fail('Cannot flip the discard pile now');
      // Flipping the pile over puts the first discarded card on top.
      next.drawPile = next.discardPile.reverse();
      next.discardPile = [];
      next.placedSinceRecycle = 0;
      break;
  }

  next.status = statusOf(next);
  return next;
}

function statusOf(state: SoloState): SoloStatus {
  if (state.board.placed.length === state.totalCards) return 'won';
  if (state.hand || state.drawPile.length > 0) return 'playing';
  if (canTakeDiscard(state) || canRecycle(state)) return 'playing';
  return 'finished';
}

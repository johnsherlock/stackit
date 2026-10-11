import { type Card, type Suit, isLetter, isNumber, isWild } from './cards';
import {
  type Bounds,
  type Pos,
  type Surface,
  DIRS,
  ROTATIONS,
  add,
  coveringPos,
  hexInBounds,
  hexTriKeys,
  mod,
  posKey,
  samePos,
  surfaceOfTri,
  trisOfSurface,
} from './geometry';

export interface PlacedCard {
  card: Card;
  pos: Pos;
  /** Multiples of 60° anticlockwise. */
  rotation: number;
  /** Suit called when this Wild was played, if the mode calls suits. */
  calledSuit?: Suit;
}

/**
 * A single STACK. Cards are kept in play order: later cards physically lie on top
 * of earlier ones.
 */
export interface Board {
  bounds: Bounds;
  placed: PlacedCard[];
  /** Cards whose TOP can't be played on this turn (a ZERO blocks the next player). */
  blockedTops?: number[];
}

export interface Placement {
  pos: Pos;
  rotation: number;
}

export interface Touch {
  /** Index into `board.placed`. */
  index: number;
  surface: Surface;
}

export type PlacementCheck =
  | { ok: true; touches: Touch[] }
  | { ok: false; reason: PlacementError };

export type PlacementError =
  | 'out-of-bounds'
  | 'wrong-orientation'
  | 'no-contact'
  | 'tucked-under'
  | 'occupied'
  | 'blocked'
  | 'mismatch';

export function createBoard(bounds: Bounds): Board {
  return { bounds, placed: [] };
}

/** Flip the first card of the STACK. */
export function startBoard(board: Board, card: Card, pos: Pos): Board {
  if (board.placed.length > 0) throw new Error('Board already started');
  if (!hexInBounds(pos, board.bounds)) throw new Error('Start position is off the table');
  return { ...board, placed: [{ card, pos, rotation: 0 }] };
}

interface Cover {
  index: number;
  tri: number;
}

/** For every lattice triangle that has a card on it, the topmost card and its local triangle. */
function visibleCover(board: Board): Map<string, Cover> {
  const cover = new Map<string, Cover>();
  board.placed.forEach((p, index) => {
    hexTriKeys(p.pos).forEach((key, tri) => cover.set(key, { index, tri }));
  });
  return cover;
}

/** Can `card` be stacked onto `surface` of `target`? */
export function surfaceAccepts(target: PlacedCard, surface: Surface, card: Card): boolean {
  if (isWild(target.card)) {
    // A Wild only offers its TOP — to any card, or the called suit if one was called.
    if (surface !== 'top') return false;
    return isWild(card) || target.calledSuit === undefined || card.suit === target.calledSuit;
  }
  if (isWild(card)) return surface === 'top';
  switch (surface) {
    case 'top':
      return card.suit === target.card.suit;
    case 'side':
      return isNumber(card) && isNumber(target.card) && card.rank === target.card.rank;
    case 'face':
      return isLetter(card) && isLetter(target.card) && card.rank === target.card.rank;
  }
}

interface Contact {
  touch: Touch;
  /** True if the spot covers both halves of the (fully visible) surface. */
  full: boolean;
}

/** Could any card ever be played onto this surface? (A number has no letter to match, etc.) */
function canEverMatch(target: PlacedCard, surface: Surface): boolean {
  if (surface === 'top') return true;
  if (isWild(target.card)) return false;
  return surface === 'side' ? isNumber(target.card) : isLetter(target.card);
}

/**
 * The surfaces a card is played onto: every one it fully covers, except a dead surface
 * (a number's FACE, a letter's SIDE, a Wild's sides) on a card that is already out of play.
 * Covering those changes nothing. A dead surface on a card still in play has to "match",
 * which nothing can, so it can't be covered.
 */
function playedOnto(board: Board, found: Contact[], cover: Map<string, Cover>): Contact[] {
  return found.filter((c) => {
    if (!c.full) return false;
    const target = board.placed[c.touch.index];
    return canEverMatch(target, c.touch.surface) || !outOfPlay(board, c.touch.index, cover);
  });
}

/** The visible surfaces a card at `pos` would overlap, and whether it covers each one fully. */
function contacts(board: Board, pos: Pos, cover: Map<string, Cover>): Contact[] {
  const touched = new Map<string, Contact>();
  for (const key of hexTriKeys(pos)) {
    const hit = cover.get(key);
    if (!hit) continue;
    const surface = surfaceOfTri(hit.tri, board.placed[hit.index].rotation);
    const id = `${hit.index}:${surface}`;
    const seen = touched.get(id);
    if (seen) seen.full = true;
    else touched.set(id, { touch: { index: hit.index, surface }, full: false });
  }
  return [...touched.values()];
}

/**
 * Would a card at `pos` be tucked in directly below `target`, cutting into the bottom of
 * both its FACE and SIDE? Overhanging a card from above is fine (the half-covered surface
 * is just blocked), but a card can't be slid in underneath one.
 */
function tuckedUnder(target: PlacedCard, pos: Pos): boolean {
  return samePos(pos, add(target.pos, DIRS[mod(4 + target.rotation, ROTATIONS)]));
}

/** Can a card at `pos` overhang every surface it only half-covers? */
function overlapsAreFine(board: Board, pos: Pos, found: Contact[]): boolean {
  return found.every((c) => c.full || !tuckedUnder(board.placed[c.touch.index], pos));
}

/**
 * Check whether `card` may be played at `placement`.
 *
 * Every visible surface the card fully covers is one it's played onto (unless it's a dead
 * surface on a card already out of play): it must not be blocked by a ZERO, and must match. It must be played
 * onto at least one. Surfaces it only half-covers become blocked, which is fine unless it's
 * tucked in below that card.
 */
export function checkPlacement(
  board: Board,
  card: Card,
  placement: Placement,
  cover: Map<string, Cover> = visibleCover(board),
): PlacementCheck {
  const { pos, rotation } = placement;
  if (!hexInBounds(pos, board.bounds)) return { ok: false, reason: 'out-of-bounds' };
  // Never right on top of another card, hiding it completely.
  if (board.placed.some((p) => samePos(p.pos, pos))) return { ok: false, reason: 'occupied' };

  const found = contacts(board, pos, cover);
  if (found.some((c) => !c.full && tuckedUnder(board.placed[c.touch.index], pos))) {
    return { ok: false, reason: 'tucked-under' };
  }
  const touches = playedOnto(board, found, cover).map((c) => c.touch);
  if (touches.length === 0) return { ok: false, reason: 'no-contact' };

  // A card lines up with the cards it's played onto; a Wild turns away from them.
  const turned = (r: number) => (isWild(card) ? !wildTurns(r).includes(rotation) : rotation !== r);
  if (touches.some((t) => turned(board.placed[t.index].rotation))) {
    return { ok: false, reason: 'wrong-orientation' };
  }

  for (const touch of touches) {
    if (touch.surface === 'top' && board.blockedTops?.includes(touch.index)) {
      return { ok: false, reason: 'blocked' };
    }
    if (!surfaceAccepts(board.placed[touch.index], touch.surface, card)) {
      return { ok: false, reason: 'mismatch' };
    }
  }
  return { ok: true, touches };
}

/**
 * The rotations a Wild played onto a card turned `from` may take: 60° or 120° either way,
 * never the same direction or straight back the way the STACK came.
 */
export function wildTurns(from: number): number[] {
  const back = mod(from + ROTATIONS / 2, ROTATIONS);
  return Array.from({ length: ROTATIONS }, (_, r) => r).filter((r) => r !== from && r !== back);
}

/** Every legal placement for `card`. Only cells next to a card can touch it. */
export function legalPlacements(board: Board, card: Card): Placement[] {
  const candidates = new Map<string, Pos>();
  for (const p of board.placed) {
    for (const d of DIRS) {
      const n = add(p.pos, d);
      candidates.set(posKey(n), n);
    }
  }

  // Non-Wilds line up with the card they're played onto, so only rotations already in use.
  const rotations = isWild(card)
    ? Array.from({ length: ROTATIONS }, (_, r) => r)
    : [...new Set(board.placed.map((p) => p.rotation))];

  const cover = visibleCover(board);
  const result: Placement[] = [];
  for (const pos of candidates.values()) {
    for (const rotation of rotations) {
      if (checkPlacement(board, card, { pos, rotation }, cover).ok) result.push({ pos, rotation });
    }
  }
  return result;
}

export const canPlay = (board: Board, card: Card): boolean => legalPlacements(board, card).length > 0;

/** Play `card`. Throws if the placement is illegal. */
export function placeCard(
  board: Board,
  card: Card,
  placement: Placement,
  calledSuit?: Suit,
): Board {
  const check = checkPlacement(board, card, placement);
  if (!check.ok) throw new Error(`Illegal placement: ${check.reason}`);

  const placed: PlacedCard = { card, pos: placement.pos, rotation: placement.rotation };
  if (isWild(card) && calledSuit) placed.calledSuit = calledSuit;

  return { ...board, placed: [...board.placed, placed] };
}

/**
 * Games saved before cards lined up with the card they're played onto can hold cards at
 * the wrong angle. Turn each non-Wild card to match the first card it covers.
 */
export function realign(board: Board): Board {
  const placed: PlacedCard[] = [];
  for (const p of board.placed) {
    let rotation = p.rotation;
    if (!isWild(p.card) && placed.length > 0) {
      const sofar: Board = { ...board, placed: [...placed] };
      const sofarCover = visibleCover(sofar);
      const [onto] = playedOnto(sofar, contacts(sofar, p.pos, sofarCover), sofarCover);
      if (onto) rotation = placed[onto.touch.index].rotation;
    }
    placed.push(rotation === p.rotation ? p : { ...p, rotation });
  }
  return { ...board, placed };
}

/** The surfaces of `placed[index]` that are still fully visible. */
export function visibleSurfaces(board: Board, index: number, cover = visibleCover(board)): Surface[] {
  const keys = hexTriKeys(board.placed[index].pos);
  const rotation = board.placed[index].rotation;
  return (['top', 'face', 'side'] as const).filter((surface) =>
    trisOfSurface(surface, rotation).every((tri) => cover.get(keys[tri])?.index === index),
  );
}

/** Out of play: no surface left that anything could ever be played onto. */
export function outOfPlay(board: Board, index: number, cover = visibleCover(board)): boolean {
  const target = board.placed[index];
  return !visibleSurfaces(board, index, cover).some((surface) => canEverMatch(target, surface));
}

/**
 * Is there room for a card on the TOP of `placed[index]`? The spot that covers it must
 * be on the table, it can't be tucked under another card, and it can't also cover a dead
 * surface of a card still in play.
 */
export function topIsOpen(board: Board, index: number): boolean {
  const target = board.placed[index];
  const spot = coveringPos(target.pos, 'top', target.rotation);
  if (!hexInBounds(spot, board.bounds)) return false;
  const cover = visibleCover(board);
  const found = contacts(board, spot, cover);
  const onTop = found.some((c) => c.full && c.touch.index === index && c.touch.surface === 'top');
  // Also covering a dead surface of a card still in play: nothing could match it.
  const matchable = playedOnto(board, found, cover).every((c) =>
    canEverMatch(board.placed[c.touch.index], c.touch.surface),
  );
  return onTop && matchable && overlapsAreFine(board, spot, found);
}

/**
 * A Wild turned so that nothing can be played on its TOP (off the table, tucked under a
 * card, or also covering a surface nothing matches). Legal, but a dead end.
 */
export function isDeadEndWild(board: Board, card: Card, placement: Placement): boolean {
  if (!isWild(card)) return false;
  const next = placeCard(board, card, placement);
  return !topIsOpen(next, next.placed.length - 1);
}

/**
 * How open the STACK is: each surface something could still be STACKED onto counts
 * 1 / (number of surfaces that spot must match), so easy single matches count most.
 */
export function openness(board: Board): number {
  const cover = visibleCover(board);
  const spots = new Map<string, number>();
  board.placed.forEach((p, index) => {
    const surfaces: Surface[] = isWild(p.card) ? ['top'] : ['top', 'face', 'side'];
    for (const surface of surfaces) {
      if (surface === 'top' && board.blockedTops?.includes(index)) continue;
      const spot = coveringPos(p.pos, surface, p.rotation);
      const key = posKey(spot);
      if (spots.has(key) || !hexInBounds(spot, board.bounds)) continue;
      const found = contacts(board, spot, cover);
      const onto = playedOnto(board, found, cover).length;
      if (onto > 0 && overlapsAreFine(board, spot, found)) spots.set(key, 1 / onto);
    }
  });
  let total = 0;
  for (const v of spots.values()) total += v;
  return total;
}

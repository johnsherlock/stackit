import { type Placement, isDeadEndWild, openness, placeCard } from './board';
import { type Card, SUITS, type Suit, isLetter, isNumber, isWild } from './cards';
import { type UhOhAction, type UhOhState, actingPlayer, nextSeat, placementsFor } from './uhoh';

/**
 * A simple UH OH! bot. It's greedy and a bit sneaky: it counters attacks when it
 * can, plays duplicates together, saves Wilds for when it's stuck, and goes for the
 * QUEEN SWEEP.
 */

const pick = <T>(items: readonly T[], rng: () => number): T => items[Math.floor(rng() * items.length)];

/** How much the bot wants to keep a card (low = give it away first). */
function keepValue(card: Card, hand: Card[]): number {
  if (isWild(card)) return 10;
  if (card.rank === 'K' || card.rank === 'J' || card.rank === 'Q') return 7;
  if (card.rank === 'A') return 6;
  const twins = hand.filter((c) => c.rank === card.rank).length - 1;
  return 2 + twins;
}

function playScore(state: UhOhState, card: Card, hand: Card[]): number {
  const nextHand = state.players[nextSeat(state)].hand.length;
  if (isWild(card)) return 0;
  if (card.rank === 'Q') return hand.length === 2 ? 20 : 4; // QUEEN SWEEP
  if (card.rank === 'K') return nextHand <= 3 ? 9 : 5;
  if (card.rank === 'J') return nextHand <= 3 ? 8 : 4.5;
  if (card.rank === 'A') return 6;
  if (isNumber(card)) {
    const twins = hand.filter((c) => c.rank === card.rank).length - 1;
    return 3 + twins * 2 + (card.rank === 0 ? 0.5 : 0);
  }
  return isLetter(card) ? 3 : 1;
}

function favouriteSuit(hand: Card[], rng: () => number): Suit {
  const counts = new Map<Suit, number>();
  for (const c of hand) if (!isWild(c)) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  const best = Math.max(0, ...counts.values());
  const top = SUITS.filter((s) => (counts.get(s) ?? 0) === best);
  return pick(top, rng);
}

export function chooseBotAction(state: UhOhState, rng: () => number = Math.random): UhOhAction {
  const player = actingPlayer(state);
  if (player === null) throw new Error('The game is over');
  const hand = state.players[player].hand;

  if (state.phase.kind === 'give') {
    const sorted = [...hand].sort((a, b) => keepValue(a, hand) - keepValue(b, hand));
    return { type: 'give', player, cardIds: sorted.slice(0, state.phase.amount).map((c) => c.id) };
  }
  if (state.phase.kind !== 'turn') throw new Error('Nothing to do');

  const options = hand
    .map((card) => ({ card, placements: placementsFor(state, card) }))
    .filter((o) => o.placements.length > 0);

  if (options.length === 0) {
    if (state.phase.attack) return { type: 'accept', player };
    if (state.phase.chainRank !== null) return { type: 'end-turn', player };
    return { type: 'draw', player };
  }

  const best = Math.max(...options.map((o) => playScore(state, o.card, hand)));
  const choice = pick(
    options.filter((o) => playScore(state, o.card, hand) === best),
    rng,
  );
  const rest = hand.filter((c) => c.id !== choice.card.id);
  return {
    type: 'place',
    player,
    cardId: choice.card.id,
    placement: bestPlacement(state, choice.card, choice.placements, rng),
    calledSuit: isWild(choice.card) ? favouriteSuit(rest, rng) : undefined,
  };
}

/** Prefer the spot that leaves the STACK most open; never point a Wild into a dead end. */
function bestPlacement(state: UhOhState, card: Card, placements: Placement[], rng: () => number): Placement {
  const live = placements.filter((p) => !isDeadEndWild(state.board, card, p));
  const pool = live.length > 0 ? live : placements;
  const scored = pool.map((p) => ({ p, score: openness(placeCard(state.board, card, p)) }));
  const best = Math.max(...scored.map((s) => s.score));
  return pick(
    scored.filter((s) => s.score >= best - 1e-9).map((s) => s.p),
    rng,
  );
}

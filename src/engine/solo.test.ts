import { describe, expect, it } from 'vitest';
import { legalPlacements } from './board';
import { isWild } from './cards';
import { type SoloState, applySoloAction, canRecycle, newSoloGame } from './solo';

const options = { seed: 42, noWilds: false, secondChances: false };

/** Greedy bot: play the first legal placement, otherwise discard. */
function autoplay(state: SoloState): SoloState {
  let s = state;
  for (let guard = 0; s.status === 'playing' && guard < 1000; guard++) {
    if (s.hand) {
      const [placement] = legalPlacements(s.board, s.hand);
      s = applySoloAction(s, placement ? { type: 'place', placement } : { type: 'discard' });
    } else if (s.drawPile.length > 0) {
      s = applySoloAction(s, { type: 'draw' });
    } else if (canRecycle(s)) {
      s = applySoloAction(s, { type: 'recycle' });
    } else {
      s = applySoloAction(s, { type: 'take-discard' });
    }
  }
  return s;
}

describe('Solo Stack', () => {
  it('deals the whole DECK and flips a non-Wild first card', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = newSoloGame({ ...options, seed });
      expect(s.totalCards).toBe(60);
      expect(s.drawPile).toHaveLength(59);
      expect(isWild(s.board.placed[0].card)).toBe(false);
    }
  });

  it('is deterministic for a seed', () => {
    expect(newSoloGame(options)).toEqual(newSoloGame(options));
  });

  it('removes Wilds in the No Wilds variation', () => {
    const s = newSoloGame({ ...options, noWilds: true });
    expect(s.totalCards).toBe(56);
    expect(s.drawPile.some(isWild)).toBe(false);
  });

  it('rejects drawing with a card in hand', () => {
    const s = applySoloAction(newSoloGame(options), { type: 'draw' });
    expect(() => applySoloAction(s, { type: 'draw' })).toThrow();
  });

  it('plays through to the end and accounts for every card', () => {
    for (let seed = 0; seed < 20; seed++) {
      const end = autoplay(newSoloGame({ ...options, seed }));
      expect(end.status).not.toBe('playing');
      expect(end.board.placed.length + end.discardPile.length).toBe(end.totalCards);
    }
  });

  it('Second Chances flips the discard pile and stops after a pass with no plays', () => {
    const end = autoplay(newSoloGame({ ...options, secondChances: true }));
    expect(end.status).not.toBe('playing');
    expect(end.placedSinceRecycle === null || end.placedSinceRecycle === 0 || end.status === 'won').toBe(true);
  });
});

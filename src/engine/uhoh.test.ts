import { describe, expect, it } from 'vitest';
import { createBoard, startBoard } from './board';
import { chooseBotAction } from './bot';
import { type Card, type Rank, type Suit, createRng, isNumber } from './cards';
import { type Pos, DIRS, add, coveringPos } from './geometry';
import {
  type UhOhAction,
  type UhOhState,
  applyUhOhAction,
  newUhOhGame,
  playableCards,
  tableBounds,
} from './uhoh';

let nextId = 0;
const card = (rank: Rank, suit: Suit): Card => ({ id: `t${nextId++}-${rank}${suit}`, suit, rank });

const ORIGIN: Pos = { a: 0, b: 0 };
const TOP = coveringPos(ORIGIN, 'top', 0);
const SIDE = coveringPos(ORIGIN, 'side', 0);
const FACE = coveringPos(ORIGIN, 'face', 0);
const at = (pos: Pos, rotation = 0) => ({ pos, rotation });

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, kind: 'bot' as const }));

/** A hand-built game: `first` is the starting card at the origin. */
function setup(hands: Card[][], first: Card, drawPile: Card[] = []): UhOhState {
  return {
    mode: 'uhoh',
    options: { seed: 0, seats: seats(hands.length) },
    board: startBoard(createBoard(tableBounds(hands.length)), first, ORIGIN),
    drawPile,
    players: hands.map((hand, i) => ({ name: `P${i}`, kind: 'human', hand })),
    current: 0,
    direction: 1,
    phase: { kind: 'turn', attack: null, chainRank: null },
    pendingBlocks: [],
    log: [],
  };
}

const play = (s: UhOhState, c: Card, pos: Pos, extra: Partial<UhOhAction> = {}) =>
  applyUhOhAction(s, { type: 'place', player: s.current, cardId: c.id, placement: at(pos), ...extra } as UhOhAction);

const filler = (n: number) => Array.from({ length: n }, () => card(9, 'clubs'));

describe('setup', () => {
  it.each([
    [2, 7, 60],
    [4, 7, 60],
    [5, 5, 60],
    [6, 7, 120],
    [10, 5, 120],
  ])('%i players get %i cards each from %i cards', (n, size, total) => {
    const s = newUhOhGame({ seed: 7, seats: seats(n) });
    expect(s.players.every((p) => p.hand.length === size)).toBe(true);
    expect(s.drawPile.length + n * size + 1).toBe(total);
  });

  it('starts on a number card 2–10', () => {
    for (let seed = 0; seed < 50; seed++) {
      const first = newUhOhGame({ seed, seats: seats(3) }).board.placed[0].card;
      expect(isNumber(first) && first.rank !== 0).toBe(true);
    }
  });
});

describe('turns', () => {
  it('play a match and pass the turn on', () => {
    const c = card(5, 'spades');
    const s = play(setup([[c, ...filler(2)], filler(3)], card(4, 'spades')), c, TOP);
    expect(s.current).toBe(1);
    expect(s.players[0].hand).toHaveLength(2);
  });

  it('drawing a card ends your turn', () => {
    const drawn = card(2, 'hearts');
    const s = applyUhOhAction(setup([filler(2), filler(2)], card(4, 'spades'), [drawn]), { type: 'draw', player: 0 });
    expect(s.players[0].hand).toContainEqual(drawn);
    expect(s.current).toBe(1);
  });

  it('rejects acting out of turn', () => {
    const s = setup([filler(2), filler(2)], card(4, 'spades'), [card(2, 'hearts')]);
    expect(() => applyUhOhAction(s, { type: 'draw', player: 1 })).toThrow('not your turn');
  });

  it('first player out of cards wins', () => {
    const c = card(5, 'spades');
    const s = play(setup([[c], filler(3)], card(4, 'spades')), c, TOP);
    expect(s.phase).toEqual({ kind: 'over', winners: [0], reason: 'empty-hand' });
  });
});

describe('special cards', () => {
  it('JACK: the next player draws 1, then still takes their turn', () => {
    const jack = card('J', 'spades');
    const pile = [card(2, 'clubs')];
    let s = play(setup([[jack, ...filler(2)], filler(3)], card(4, 'spades'), pile), jack, TOP);
    expect(s.phase).toMatchObject({ kind: 'turn', attack: { rank: 'J', amount: 1 } });
    expect(() => applyUhOhAction(s, { type: 'draw', player: 1 })).toThrow();
    s = applyUhOhAction(s, { type: 'accept', player: 1 });
    expect(s.players[1].hand).toHaveLength(4);
    expect(s.current).toBe(1);
    expect(s.phase).toMatchObject({ kind: 'turn', attack: null });
  });

  it('countering a JACK adds up and passes it on', () => {
    const j1 = card('J', 'spades');
    const j2 = card('J', 'hearts');
    let s = setup([[j1, ...filler(2)], [j2, ...filler(2)], filler(3)], card('J', 'clubs'), filler(5));
    s = play(s, j1, FACE);
    // Countered with the same letter, on the first JACK's FACE.
    s = play(s, j2, coveringPos(FACE, 'face', 0));
    expect(s.current).toBe(2);
    expect(s.phase).toMatchObject({ attack: { rank: 'J', amount: 2 } });
    s = applyUhOhAction(s, { type: 'accept', player: 2 });
    expect(s.players[2].hand).toHaveLength(5);
  });

  it('only the same letter counters', () => {
    const jack = card('J', 'spades');
    const king = card('K', 'spades');
    let s = setup([[jack, ...filler(2)], [king, ...filler(2)]], card(4, 'spades'), filler(5));
    s = play(s, jack, TOP);
    expect(playableCards(s)).toEqual([]);
    expect(() => play(s, king, coveringPos(TOP, 'top', 0))).toThrow('Counter with a J');
  });

  it('KING: the next player draws 2', () => {
    const king = card('K', 'spades');
    let s = play(setup([[king, ...filler(2)], filler(3)], card(4, 'spades'), filler(5)), king, TOP);
    s = applyUhOhAction(s, { type: 'accept', player: 1 });
    expect(s.players[1].hand).toHaveLength(5);
  });

  it('QUEEN: you choose a card to give to the next player', () => {
    const queen = card('Q', 'spades');
    const gift = card(3, 'hearts');
    let s = play(setup([[queen, gift, card(8, 'clubs')], filler(3)], card(4, 'spades')), queen, TOP);
    s = applyUhOhAction(s, { type: 'accept', player: 1 });
    expect(s.phase).toEqual({ kind: 'give', giver: 0, receiver: 1, amount: 1 });
    expect(() => applyUhOhAction(s, { type: 'give', player: 1, cardIds: [gift.id] })).toThrow();
    s = applyUhOhAction(s, { type: 'give', player: 0, cardIds: [gift.id] });
    expect(s.players[1].hand).toContainEqual(gift);
    expect(s.current).toBe(1);
    expect(s.phase).toMatchObject({ kind: 'turn', attack: null });
  });

  it('QUEEN SWEEP: giving away your last card wins', () => {
    const queen = card('Q', 'spades');
    const last = card(3, 'hearts');
    let s = play(setup([[queen, last], filler(3)], card(4, 'spades')), queen, TOP);
    s = applyUhOhAction(s, { type: 'accept', player: 1 });
    s = applyUhOhAction(s, { type: 'give', player: 0, cardIds: [last.id] });
    expect(s.phase).toEqual({ kind: 'over', winners: [0], reason: 'empty-hand' });
  });

  it('ACE: take another turn', () => {
    const ace = card('A', 'spades');
    const s = play(setup([[ace, ...filler(2)], filler(3)], card(4, 'spades')), ace, TOP);
    expect(s.current).toBe(0);
  });

  it('ZERO: reverses play with 3+ players and blocks its TOP for the next player', () => {
    const zero = card(0, 'spades');
    const spade = card(6, 'spades');
    let s = setup([[zero, ...filler(2)], filler(3), [spade, ...filler(2)]], card(4, 'spades'));
    s = play(s, zero, TOP);
    expect(s.direction).toBe(-1);
    expect(s.current).toBe(2);
    const onZero = coveringPos(TOP, 'top', 0);
    expect(() => play(s, spade, onZero)).toThrow('blocked');

    // The block lasts for that turn only.
    s = applyUhOhAction({ ...s, drawPile: filler(2) }, { type: 'draw', player: 2 });
    expect(s.board.blockedTops).toEqual([]);
  });

  it('ZERO with 2 players does not reverse', () => {
    const zero = card(0, 'spades');
    const s = play(setup([[zero, ...filler(2)], filler(3)], card(4, 'spades')), zero, TOP);
    expect(s.direction).toBe(1);
    expect(s.current).toBe(1);
  });
});

describe('multiple numbers', () => {
  it('play several of the same number in one turn', () => {
    const fiveH = card(5, 'hearts');
    const fiveC = card(5, 'clubs');
    let s = setup([[fiveH, fiveC, card('K', 'hearts')], filler(3)], card(5, 'spades'));
    s = play(s, fiveH, SIDE);
    expect(s.current).toBe(0);
    expect(s.phase).toMatchObject({ chainRank: 5 });
    expect(playableCards(s)).toEqual([fiveC]);
    s = play(s, fiveC, coveringPos(SIDE, 'side', 0));
    // No more fives: the turn passes automatically.
    expect(s.current).toBe(1);
  });

  it('each extra number goes beside the last one', () => {
    // Reported game: after the 9♥, the 9♣ could also match a club TOP elsewhere.
    const fourH = card(4, 'hearts');
    const fourC = card(4, 'clubs');
    let s = setup([[fourH, fourC, card('K', 'hearts')], filler(3)], card(4, 'clubs'));
    s = play(s, fourH, SIDE);
    const beside = coveringPos(SIDE, 'side', 0);
    expect(playableCards(s)).toEqual([fourC]);
    expect(() => play(s, fourC, TOP)).toThrow(/beside/);
    s = play(s, fourC, beside);
    expect(s.board.placed.at(-1)?.card).toEqual(fourC);
  });

  it('ends the turn, and says why, when the next number has no room beside the last', () => {
    const fourH = card(4, 'hearts');
    const fourS = card(4, 'spades');
    let s = setup([[fourH, fourS, card('K', 'hearts')], filler(3)], card(4, 'clubs'));
    const beside = coveringPos(SIDE, 'side', 0);
    // A 7♦ whose TOP is exactly that spot: the next 4 would also have to be a diamond.
    const blocker = { card: card(7, 'diamonds'), pos: add(beside, DIRS[4]), rotation: 0 };
    s = { ...s, board: { ...s.board, placed: [...s.board.placed, blocker] } };
    s = play(s, fourH, SIDE);
    expect(s.current).toBe(1);
    expect(s.log.at(-1)).toEqual({ type: 'chain-blocked', player: 0, rank: 4 });
  });

  it('you can stop early', () => {
    const fiveH = card(5, 'hearts');
    const fiveC = card(5, 'clubs');
    let s = setup([[fiveH, fiveC, card('K', 'hearts')], filler(3)], card(5, 'spades'));
    s = play(s, fiveH, SIDE);
    s = applyUhOhAction(s, { type: 'end-turn', player: 0 });
    expect(s.current).toBe(1);
  });

  it('can win by playing the last pair', () => {
    const a = card(7, 'hearts');
    const b = card(7, 'clubs');
    let s = setup([[a, b], filler(3)], card(7, 'spades'));
    s = play(s, a, SIDE);
    s = play(s, b, coveringPos(SIDE, 'side', 0));
    expect(s.phase).toMatchObject({ kind: 'over', winners: [0] });
  });

  it('letters cannot be chained', () => {
    const j1 = card('J', 'hearts');
    const j2 = card('J', 'clubs');
    const s = play(setup([[j1, j2, ...filler(2)], filler(3)], card(4, 'hearts')), j1, TOP);
    expect(s.current).toBe(1);
  });
});

describe('wilds', () => {
  it('need a called suit, and the next player must follow it on the Wild TOP', () => {
    const wild = card('W', 'clubs');
    const heart = card(9, 'hearts');
    const diamond = card(9, 'diamonds');
    let s = setup([[wild, ...filler(2)], [heart, diamond, ...filler(2)]], card(4, 'spades'));
    expect(() => applyUhOhAction(s, { type: 'place', player: 0, cardId: wild.id, placement: at(TOP, 1) })).toThrow(
      'Call a suit',
    );
    s = applyUhOhAction(s, { type: 'place', player: 0, cardId: wild.id, placement: at(TOP, 1), calledSuit: 'diamonds' });
    expect(playableCards(s)).toEqual([diamond]);
  });

  it("can't be your last card", () => {
    const wild = card('W', 'clubs');
    const s = setup([[wild], filler(3)], card(4, 'spades'), filler(3));
    expect(playableCards(s)).toEqual([]);
    expect(() =>
      applyUhOhAction(s, { type: 'place', player: 0, cardId: wild.id, placement: at(TOP, 2), calledSuit: 'clubs' }),
    ).toThrow();
  });
});

describe('running out', () => {
  it('when the draw pile runs out, the fewest cards wins', () => {
    const s = applyUhOhAction(setup([filler(4), filler(2), filler(3)], card(4, 'spades'), []), {
      type: 'draw',
      player: 0,
    });
    expect(s.phase).toEqual({ kind: 'over', winners: [1], reason: 'draw-pile-empty' });
  });
});

describe('bots', () => {
  it.each([2, 3, 5, 6, 10])('a %i-bot game always finishes and keeps every card', (n) => {
    for (let seed = 0; seed < 8; seed++) {
      let s = newUhOhGame({ seed, seats: seats(n) });
      const total = s.drawPile.length + s.board.placed.length + s.players.reduce((t, p) => t + p.hand.length, 0);
      const rng = createRng(seed);
      let moves = 0;
      while (s.phase.kind !== 'over' && moves < 3000) {
        s = applyUhOhAction(s, chooseBotAction(s, rng));
        moves++;
      }
      expect(s.phase.kind).toBe('over');
      const count = s.drawPile.length + s.board.placed.length + s.players.reduce((t, p) => t + p.hand.length, 0);
      expect(count).toBe(total);
    }
  });
});

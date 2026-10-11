import { describe, expect, it } from 'vitest';
import {
  type Board,
  checkPlacement,
  createBoard,
  legalPlacements,
  outOfPlay,
  placeCard,
  realign,
  startBoard,
  visibleSurfaces,
} from './board';
import type { Card, Rank, Suit } from './cards';
import { type Pos, DIRS, add, coveringPos, mod } from './geometry';

const BOUNDS = { minX: -20, maxX: 20, minY: -20, maxY: 20 };
const ORIGIN: Pos = { a: 0, b: 0 };

let nextId = 0;
const card = (rank: Rank, suit: Suit): Card => ({ id: `t${nextId++}`, suit, rank });

const start = (c: Card): Board => startBoard(createBoard(BOUNDS), c, ORIGIN);

const TOP = coveringPos(ORIGIN, 'top', 0);
const SIDE = coveringPos(ORIGIN, 'side', 0);
const FACE = coveringPos(ORIGIN, 'face', 0);

describe('geometry', () => {
  it('covers the top from directly above and the side/face from the lower right/left', () => {
    expect(TOP).toEqual(DIRS[1]);
    expect(SIDE).toEqual(DIRS[5]);
    expect(FACE).toEqual(DIRS[3]);
  });
});

describe('cardinal rules', () => {
  it('matching suits STACK on the TOP', () => {
    const board = start(card(2, 'spades'));
    expect(checkPlacement(board, card(3, 'spades'), { pos: TOP, rotation: 0 }).ok).toBe(true);
    expect(checkPlacement(board, card(3, 'hearts'), { pos: TOP, rotation: 0 })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('matching numbers STACK on the SIDE, including zeroes', () => {
    const board = start(card(5, 'hearts'));
    expect(checkPlacement(board, card(5, 'clubs'), { pos: SIDE, rotation: 0 }).ok).toBe(true);
    expect(checkPlacement(board, card(6, 'hearts'), { pos: SIDE, rotation: 0 }).ok).toBe(false);
    const zero = start(card(0, 'hearts'));
    expect(checkPlacement(zero, card(0, 'spades'), { pos: SIDE, rotation: 0 }).ok).toBe(true);
  });

  it('matching letters STACK on the FACE, never on the SIDE', () => {
    const board = start(card('J', 'hearts'));
    expect(checkPlacement(board, card('J', 'spades'), { pos: FACE, rotation: 0 }).ok).toBe(true);
    expect(checkPlacement(board, card('K', 'spades'), { pos: FACE, rotation: 0 }).ok).toBe(false);
    expect(checkPlacement(board, card('J', 'spades'), { pos: SIDE, rotation: 0 }).ok).toBe(false);
  });

  it('numbers do not STACK on the FACE', () => {
    const board = start(card(3, 'spades'));
    expect(checkPlacement(board, card(3, 'hearts'), { pos: FACE, rotation: 0 }).ok).toBe(false);
  });

  it('must touch the STACK', () => {
    const board = start(card(3, 'spades'));
    const far = { a: 5, b: 5 };
    expect(checkPlacement(board, card(3, 'spades'), { pos: far, rotation: 0 })).toEqual({
      ok: false,
      reason: 'no-contact',
    });
  });

  it('must be played onto a whole surface, not just half of two', () => {
    const board = start(card(3, 'spades'));
    // Upper-right neighbour only overlaps half the TOP and half the SIDE.
    expect(checkPlacement(board, card(3, 'spades'), { pos: DIRS[0], rotation: 0 })).toEqual({
      ok: false,
      reason: 'no-contact',
    });
  });
});

describe('the fourth position', () => {
  // 4♠ at the origin, 5♠ on its top, 4♥ on its side. The cell between the top
  // and side cards covers the top card's SIDE and the side card's TOP.
  let board = start(card(4, 'spades'));
  board = placeCard(board, card(5, 'spades'), { pos: TOP, rotation: 0 });
  board = placeCard(board, card(4, 'hearts'), { pos: SIDE, rotation: 0 });
  const between = add(TOP, SIDE);

  it('is the same cell as top-of-side and side-of-top', () => {
    expect(between).toEqual(DIRS[0]);
    expect(coveringPos(SIDE, 'top', 0)).toEqual(between);
    expect(coveringPos(TOP, 'side', 0)).toEqual(between);
  });

  it('needs a card matching both the number and the suit', () => {
    const at = { pos: between, rotation: 0 };
    expect(checkPlacement(board, card(5, 'hearts'), at).ok).toBe(true);
    expect(checkPlacement(board, card(5, 'clubs'), at).ok).toBe(false);
    expect(checkPlacement(board, card(6, 'hearts'), at).ok).toBe(false);
  });

  it('covered surfaces are no longer visible', () => {
    expect(visibleSurfaces(board, 0)).toEqual(['face']);
    expect(visibleSurfaces(board, 1)).toEqual(['top', 'face', 'side']);
  });

  it('a card with only dead surfaces left is out of play', () => {
    // The 4♠ only shows its FACE, and a number's FACE takes nothing.
    expect(outOfPlay(board, 0)).toBe(true);
    expect(outOfPlay(board, 1)).toBe(false);
  });
});

describe('blocked surfaces', () => {
  it('rulebook page 8: overhanging a card blocks the half it covers', () => {
    // 2♠ with 3♠ on top. A 3♥ on the 3♠'s SIDE half-covers the 2♠'s open SIDE: legal.
    let board = start(card(2, 'spades'));
    board = placeCard(board, card(3, 'spades'), { pos: TOP, rotation: 0 });
    const onThreeSide = coveringPos(TOP, 'side', 0);
    expect(checkPlacement(board, card(3, 'hearts'), { pos: onThreeSide, rotation: 0 }).ok).toBe(true);
    board = placeCard(board, card(3, 'hearts'), { pos: onThreeSide, rotation: 0 });

    // The 2♠'s SIDE is now blocked: nothing can be played onto it.
    expect(legalPlacements(board, card(2, 'clubs'))).toEqual([]);

    // A 5♥ on the 3♥'s TOP half-covers the 3♠'s open TOP: also legal, and blocks it.
    const onHeartTop = coveringPos(onThreeSide, 'top', 0);
    board = placeCard(board, card(5, 'hearts'), { pos: onHeartTop, rotation: 0 });
    expect(legalPlacements(board, card(9, 'spades'))).toEqual([]);
  });

  it("can't be tucked in directly below a card", () => {
    // 4♠ with 4♥ on its SIDE. The spot under the 4♥ would cut into its FACE and SIDE.
    let board = start(card(4, 'spades'));
    board = placeCard(board, card(4, 'hearts'), { pos: SIDE, rotation: 0 });
    const below = add(SIDE, DIRS[4]);
    expect(checkPlacement(board, card(4, 'clubs'), { pos: below, rotation: 0 })).toEqual({
      ok: false,
      reason: 'tucked-under',
    });
  });

  it('reported game: nothing goes under the 2♥ next to the 7♠', () => {
    // Column 9♠, 7♠, 2♠, 4♠ with the 9♦ on the 9♠'s SIDE.
    let board = start(card(9, 'spades'));
    const up = (n: number) => ({ a: 0, b: n });
    board = placeCard(board, card(7, 'spades'), { pos: up(1), rotation: 0 });
    board = placeCard(board, card(2, 'spades'), { pos: up(2), rotation: 0 });
    board = placeCard(board, card(4, 'spades'), { pos: up(3), rotation: 0 });
    board = placeCard(board, card(9, 'diamonds'), { pos: SIDE, rotation: 0 });

    // On the 9♦'s TOP, next to the 7♠: needs a 7 and a diamond.
    const cell = { pos: coveringPos(SIDE, 'top', 0), rotation: 0 };
    expect(checkPlacement(board, card('A', 'diamonds'), cell).ok).toBe(false);
    expect(checkPlacement(board, card(7, 'hearts'), cell).ok).toBe(false);
    expect(checkPlacement(board, card(7, 'diamonds'), cell).ok).toBe(true);

    // The 2♥ on the 2♠'s SIDE overhangs the 7♠'s SIDE from above: legal.
    const rightOf2 = { pos: coveringPos(up(2), 'side', 0), rotation: 0 };
    expect(checkPlacement(board, card(2, 'hearts'), rightOf2).ok).toBe(true);
    board = placeCard(board, card(2, 'hearts'), rightOf2);

    // Now that cell is tucked under the 2♥, so even the 7♦ can't go there.
    expect(checkPlacement(board, card(7, 'diamonds'), cell)).toEqual({ ok: false, reason: 'tucked-under' });
  });

  it('respects the table edge', () => {
    const board = startBoard(createBoard({ minX: -1, maxX: 1, minY: -1, maxY: 1 }), card(2, 'spades'), ORIGIN);
    expect(checkPlacement(board, card(3, 'spades'), { pos: TOP, rotation: 0 })).toEqual({
      ok: false,
      reason: 'out-of-bounds',
    });
  });
});

describe('wilds', () => {
  const base = start(card(7, 'hearts'));

  it('only STACK on a TOP, and must be rotated', () => {
    const wild = card('W', 'clubs');
    expect(checkPlacement(base, wild, { pos: TOP, rotation: 0 })).toEqual({
      ok: false,
      reason: 'wrong-orientation',
    });
    expect(checkPlacement(base, wild, { pos: TOP, rotation: 2 }).ok).toBe(true);
    expect(checkPlacement(base, wild, { pos: SIDE, rotation: 2 }).ok).toBe(false);
    expect(checkPlacement(base, wild, { pos: FACE, rotation: 2 }).ok).toBe(false);
  });

  it('offers four orientations on each open top, never straight back', () => {
    const placements = legalPlacements(base, card('W', 'spades'));
    expect(placements.map((p) => p.rotation).sort()).toEqual([1, 2, 4, 5]);
    expect(placements.every((p) => p.pos.a === TOP.a && p.pos.b === TOP.b)).toBe(true);
    expect(checkPlacement(base, card('W', 'spades'), { pos: TOP, rotation: 3 })).toEqual({
      ok: false,
      reason: 'wrong-orientation',
    });
  });

  it('turns the STACK; earlier cards stay playable, lined up with them', () => {
    let board = placeCard(base, card(7, 'spades'), { pos: SIDE, rotation: 0 });
    board = placeCard(board, card('W', 'clubs'), { pos: TOP, rotation: 1 });

    // The 7♠'s SIDE is still open, and a card there lines up with the 7♠, not the Wild.
    const onSevenSide = coveringPos(SIDE, 'side', 0);
    expect(checkPlacement(board, card(7, 'clubs'), { pos: onSevenSide, rotation: 0 }).ok).toBe(true);
    expect(checkPlacement(board, card(7, 'clubs'), { pos: onSevenSide, rotation: 1 })).toEqual({
      ok: false,
      reason: 'wrong-orientation',
    });

    // The Wild's TOP has moved with its rotation and takes any card, at the new orientation.
    const onWild = coveringPos(TOP, 'top', 1);
    expect(checkPlacement(board, card(9, 'diamonds'), { pos: onWild, rotation: 1 }).ok).toBe(true);
    expect(checkPlacement(board, card(9, 'diamonds'), { pos: onWild, rotation: 0 }).ok).toBe(false);
  });

  it('reported game: Aces next to the A♦ stay upright after a Wild elsewhere', () => {
    let board = start(card('A', 'diamonds'));
    board = placeCard(board, card('W', 'clubs'), { pos: TOP, rotation: 1 });
    // Beside the A♦ (on its FACE) only upright; the other spot is the Wild's TOP.
    const nextTo = (b: Board, c: Card, pos: Pos) =>
      legalPlacements(b, c).filter((p) => p.pos.a === pos.a && p.pos.b === pos.b);
    expect(nextTo(board, card('A', 'hearts'), FACE)).toEqual([{ pos: FACE, rotation: 0 }]);
    board = placeCard(board, card('A', 'hearts'), { pos: FACE, rotation: 0 });
    // The next Ace goes on the A♥'s FACE, also upright.
    const besideHeart = coveringPos(FACE, 'face', 0);
    expect(nextTo(board, card('A', 'clubs'), besideHeart)).toEqual([{ pos: besideHeart, rotation: 0 }]);
  });

  it('straightens cards saved at the wrong angle', () => {
    let board = start(card('A', 'diamonds'));
    board = placeCard(board, card('W', 'clubs'), { pos: TOP, rotation: 1 });
    // An old save: the A♥ beside the A♦ was turned to match the Wild.
    const crooked: Board = {
      ...board,
      placed: [...board.placed, { card: card('A', 'hearts'), pos: FACE, rotation: 1 }],
    };
    const fixed = realign(crooked);
    expect(fixed.placed.map((p) => p.rotation)).toEqual([0, 1, 0]);
    expect(realign(fixed)).toEqual(fixed);
  });

  it("a dead FACE can be covered only once its card is out of play", () => {
    // Stack turned one step clockwise. 10♣ with an 8♠ whose FACE lies under the spot
    // beside the 10♣. Only a letter could ever match a number's FACE.
    const r = 5;
    let board = start(card(10, 'clubs'));
    board = { ...board, placed: [{ ...board.placed[0], rotation: r }] };
    const beside = coveringPos(ORIGIN, 'side', r);
    const eight = { card: card(8, 'spades'), pos: add(beside, DIRS[mod(r + 3 + 3, 6)]), rotation: r };
    board = { ...board, placed: [...board.placed, eight] };
    expect(coveringPos(eight.pos, 'face', r)).toEqual(beside);
    const ten = { pos: beside, rotation: r };

    // The 8♠'s TOP and SIDE are still open (reported K♥-on-8♥ case): the FACE can't be covered.
    expect(checkPlacement(board, card(10, 'spades'), ten)).toEqual({ ok: false, reason: 'mismatch' });

    // Cover the 8♠'s TOP and SIDE (reported 10♠-beside-10♣ case): now it's out of play.
    for (const surface of ['top', 'side'] as const) {
      const pos = coveringPos(eight.pos, surface, r);
      board = { ...board, placed: [...board.placed, { card: card(8, 'clubs'), pos, rotation: r }] };
    }
    expect(outOfPlay(board, 1)).toBe(true);
    expect(checkPlacement(board, card(10, 'spades'), ten).ok).toBe(true);
  });

  it('never goes exactly on top of another card', () => {
    // A 10 card whose only live surface is its TOP; at its own spot, a 10♠ would hide it.
    const board = start(card(10, 'clubs'));
    expect(checkPlacement(board, card(10, 'clubs'), { pos: ORIGIN, rotation: 0 })).toEqual({
      ok: false,
      reason: 'occupied',
    });
  });

  it('a called suit restricts the Wild TOP', () => {
    const board = placeCard(base, card('W', 'clubs'), { pos: TOP, rotation: 1 }, 'spades');
    const onWild = coveringPos(TOP, 'top', 1);
    expect(checkPlacement(board, card(2, 'spades'), { pos: onWild, rotation: 1 }).ok).toBe(true);
    expect(checkPlacement(board, card(2, 'hearts'), { pos: onWild, rotation: 1 }).ok).toBe(false);
  });

  it('Wilds STACK on Wilds', () => {
    const board = placeCard(base, card('W', 'clubs'), { pos: TOP, rotation: 1 });
    const onWild = coveringPos(TOP, 'top', 1);
    expect(checkPlacement(board, card('W', 'hearts'), { pos: onWild, rotation: 3 }).ok).toBe(true);
    expect(checkPlacement(board, card('W', 'hearts'), { pos: onWild, rotation: 1 }).ok).toBe(false);
    // Straight back the way the STACK came.
    expect(checkPlacement(board, card('W', 'hearts'), { pos: onWild, rotation: 4 }).ok).toBe(false);
  });

  it('a card may overhang the side or face of a Wild', () => {
    // Reported game: Wild turned one step clockwise with J♠ on its TOP. The only spot on
    // the J♠'s FACE also overlaps half of the Wild's face.
    const wildPos = TOP;
    let board = placeCard(base, card('W', 'clubs'), { pos: wildPos, rotation: 5 }, 'spades');
    const jackPos = coveringPos(wildPos, 'top', 5);
    board = placeCard(board, card('J', 'spades'), { pos: jackPos, rotation: 5 });
    const onJackFace = coveringPos(jackPos, 'face', 5);
    expect(checkPlacement(board, card('J', 'clubs'), { pos: onJackFace, rotation: 5 }).ok).toBe(true);
    expect(legalPlacements(board, card('J', 'hearts'))).toEqual([{ pos: onJackFace, rotation: 5 }]);
  });

  it('reported game: a Wild fits on the J♣ but not the J♥ next to the 0♠', () => {
    // Wild turned one step clockwise; J♠ on its TOP, J♥ on the J♠'s FACE, J♣ on the J♥'s
    // FACE, then 0♠ on the J♠'s TOP.
    const r = 5;
    let board = placeCard(base, card('W', 'clubs'), { pos: TOP, rotation: r }, 'spades');
    const js = coveringPos(TOP, 'top', r);
    board = placeCard(board, card('J', 'spades'), { pos: js, rotation: r });
    const jh = coveringPos(js, 'face', r);
    board = placeCard(board, card('J', 'hearts'), { pos: jh, rotation: r });
    const jc = coveringPos(jh, 'face', r);
    board = placeCard(board, card('J', 'clubs'), { pos: jc, rotation: r });
    board = placeCard(board, card(0, 'spades'), { pos: coveringPos(js, 'top', r), rotation: r });

    const wild = card('W', 'hearts');
    // The J♥'s TOP spot also covers the 0♠'s FACE. Nothing matches a number's FACE, and the
    // 0♠ is still in play (its SIDE is open), so it can't be covered.
    expect(checkPlacement(board, wild, { pos: coveringPos(jh, 'top', r), rotation: 0 }).ok).toBe(false);
    // The J♣'s TOP spot overhangs the J♥'s TOP, which just becomes blocked.
    expect(checkPlacement(board, wild, { pos: coveringPos(jc, 'top', r), rotation: 0 }).ok).toBe(true);
  });

  it('the side and face of a Wild are not playable', () => {
    const board = placeCard(base, card('W', 'clubs'), { pos: TOP, rotation: 1 });
    for (const surface of ['side', 'face'] as const) {
      const pos = coveringPos(TOP, surface, 1);
      expect(checkPlacement(board, card(7, 'clubs'), { pos, rotation: 1 }).ok).toBe(false);
    }
  });
});

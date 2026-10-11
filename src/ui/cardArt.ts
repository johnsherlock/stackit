import { type Card, type Suit, SUIT_SYMBOL, isLetter, isRedSuit, isWild } from '../engine/cards';
import type { Surface } from '../engine/geometry';
import { svg } from './svg';

/**
 * Cards are drawn in local coordinates: a pointy-top hexagon of radius 1 centred on
 * the origin, SVG y pointing down. Each surface's artwork is drawn in a 100×100
 * square and mapped onto its rhombus, which gives the isometric skew for free.
 */

const C = Math.sqrt(3) / 2;

export const HEX_POINTS = `0,-1 ${C},-0.5 ${C},0.5 0,1 ${-C},0.5 ${-C},-0.5`;

export const SURFACE_POINTS: Record<Surface, string> = {
  top: `0,0 ${-C},-0.5 0,-1 ${C},-0.5`,
  face: `0,0 0,1 ${-C},0.5 ${-C},-0.5`,
  side: `0,0 ${C},-0.5 ${C},0.5 0,1`,
};

/** Maps the 100×100 artwork square onto each surface. */
const SURFACE_MATRIX: Record<Surface, string> = {
  top: `matrix(${C / 100} ${-0.5 / 100} ${C / 100} ${0.5 / 100} ${-C} -0.5)`,
  face: `matrix(${C / 100} ${0.5 / 100} 0 0.01 ${-C} -0.5)`,
  side: `matrix(${C / 100} ${-0.5 / 100} 0 0.01 0 0)`,
};

const suitColor = (suit: Suit): string => (isRedSuit(suit) ? 'var(--suit-red)' : 'var(--suit-black)');

function glyph(text: string, attrs: { x?: number; y?: number; size: number; fill: string; opacity?: number; cls?: string }) {
  return svg(
    'text',
    {
      x: attrs.x ?? 50,
      y: attrs.y ?? 52,
      'font-size': attrs.size,
      fill: attrs.fill,
      opacity: attrs.opacity,
      class: attrs.cls ?? 'glyph',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    },
    [text],
  );
}

function surfaceArt(surface: Surface, children: SVGElement[]): SVGGElement {
  return svg('g', { transform: SURFACE_MATRIX[surface] }, children);
}

const EMBLEM: Record<string, string> = { J: '🧢', Q: '👑', K: '👑', A: '★' };

function cardFaces(card: Card): SVGGElement[] {
  if (isWild(card)) {
    return [
      surfaceArt('top', [glyph('↻', { size: 70, fill: 'var(--wild-ink)', cls: 'glyph symbol' })]),
      surfaceArt('face', [glyph('W', { size: 62, fill: 'var(--wild-ink)', opacity: 0.55 })]),
      surfaceArt('side', [glyph('★', { size: 50, fill: 'var(--wild-ink)', opacity: 0.45, cls: 'glyph symbol' })]),
    ];
  }

  const color = suitColor(card.suit);
  const suit = SUIT_SYMBOL[card.suit];
  const rank = String(card.rank);
  const index = glyph(rank, { x: rank.length > 1 ? 18 : 14, y: 16, size: 13, fill: color });

  // The big glyph on each side surface shows what matches there: letters on the
  // FACE, numbers on the SIDE. The other surface just shows the suit, faded.
  if (isLetter(card)) {
    return [
      surfaceArt('top', [glyph(suit, { size: 64, fill: color, opacity: 0.22, cls: 'glyph symbol' })]),
      surfaceArt('face', [
        index,
        glyph(rank, { size: 54, fill: color }),
        glyph(EMBLEM[rank], { x: 78, y: 18, size: 18, fill: color, cls: 'glyph symbol' }),
      ]),
      surfaceArt('side', [glyph(suit, { size: 48, fill: color, opacity: 0.3, cls: 'glyph symbol' })]),
    ];
  }

  return [
    surfaceArt('top', [glyph(suit, { size: 64, fill: color, opacity: 0.22, cls: 'glyph symbol' })]),
    surfaceArt('face', [index, glyph(suit, { size: 54, fill: color, opacity: 0.85, cls: 'glyph symbol' })]),
    surfaceArt('side', [glyph(rank, { size: rank.length > 1 ? 36 : 56, fill: color })]),
  ];
}

export function drawCard(card: Card, options: { calledSuit?: Suit } = {}): SVGGElement {
  const kind = isWild(card) ? 'wild' : 'plain';
  const group = svg('g', { class: `card card-${kind}` }, [
    svg('polygon', { points: SURFACE_POINTS.top, class: 'surface surface-top' }),
    svg('polygon', { points: SURFACE_POINTS.face, class: 'surface surface-face' }),
    svg('polygon', { points: SURFACE_POINTS.side, class: 'surface surface-side' }),
    ...cardFaces(card),
    svg('polygon', { points: HEX_POINTS, class: 'card-outline' }),
  ]);
  if (options.calledSuit) {
    group.append(
      surfaceArt('top', [
        svg('circle', { cx: 50, cy: 50, r: 24, fill: 'white' }),
        glyph(SUIT_SYMBOL[options.calledSuit], { size: 34, fill: suitColor(options.calledSuit), cls: 'glyph symbol' }),
      ]),
    );
  }
  return group;
}

/** Face-down card: a plain blue cube. */
export function drawCardBack(): SVGGElement {
  return svg('g', { class: 'card card-back' }, [
    svg('polygon', { points: SURFACE_POINTS.top, class: 'surface surface-top' }),
    svg('polygon', { points: SURFACE_POINTS.face, class: 'surface surface-face' }),
    svg('polygon', { points: SURFACE_POINTS.side, class: 'surface surface-side' }),
    surfaceArt('top', [glyph('?', { size: 56, fill: 'var(--wild-ink)', opacity: 0.6 })]),
    svg('polygon', { points: HEX_POINTS, class: 'card-outline' }),
  ]);
}

/** A standalone SVG showing one card (for the hand and piles). */
export function cardIcon(content: SVGGElement | null, label: string): SVGSVGElement {
  const root = svg('svg', { viewBox: '-1.05 -1.05 2.1 2.1', class: 'card-icon', role: 'img', 'aria-label': label });
  if (content) root.append(content);
  else root.append(svg('polygon', { points: HEX_POINTS, class: 'card-empty' }));
  return root;
}

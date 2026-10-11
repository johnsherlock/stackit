/**
 * Board geometry.
 *
 * A STACK IT card is a pointy-top hexagon drawn as an isometric cube. Splitting the
 * hexagon from its centre to its six corners gives six equilateral triangles; each
 * pair forms one of the three visible surfaces (top, face, side).
 *
 * Card centres and corners all sit on one triangular lattice, addressed with axial
 * coordinates (a, b) where world position = a·u0 + b·u1 (unit edge length, y up):
 *
 *   u0 = ( √3/2, 1/2)  → 30°   (upper-right corner)
 *   u1 = (    0,   1)  → 90°   (top corner)
 *
 * DIRS[i] is the unit step towards corner i, at angle 30° + 60°·i.
 * Local triangle i of a hexagon is (centre, centre + DIRS[i], centre + DIRS[i+1]).
 *
 * Two cards whose centres are one step apart overlap in exactly two triangles —
 * one whole surface if those two triangles belong to the same surface, or half of
 * two surfaces otherwise (which is never legal).
 */

export interface Pos {
  a: number;
  b: number;
}

export interface Point {
  x: number;
  y: number;
}

export const DIRS: readonly Pos[] = [
  { a: 1, b: 0 }, //   30° upper-right
  { a: 0, b: 1 }, //   90° top
  { a: -1, b: 1 }, // 150° upper-left
  { a: -1, b: 0 }, // 210° lower-left
  { a: 0, b: -1 }, // 270° bottom
  { a: 1, b: -1 }, // 330° lower-right
];

export type Surface = 'top' | 'face' | 'side';

/** Surface of each local triangle for an unrotated card. */
const SURFACE_OF_TRI: readonly Surface[] = ['top', 'top', 'face', 'face', 'side', 'side'];

/** First local triangle of each surface for an unrotated card. */
const FIRST_TRI: Record<Surface, number> = { top: 0, face: 2, side: 4 };

export const ROTATIONS = 6;

export const mod = (n: number, m: number): number => ((n % m) + m) % m;

export const add = (p: Pos, q: Pos): Pos => ({ a: p.a + q.a, b: p.b + q.b });

export const posKey = (p: Pos): string => `${p.a},${p.b}`;

export const samePos = (p: Pos, q: Pos): boolean => p.a === q.a && p.b === q.b;

const SQRT3_2 = Math.sqrt(3) / 2;

export function toWorld(p: Pos): Point {
  return { x: p.a * SQRT3_2, y: p.a * 0.5 + p.b };
}

/** Surface shown by local triangle `tri` of a card turned `rotation` × 60° anticlockwise. */
export function surfaceOfTri(tri: number, rotation: number): Surface {
  return SURFACE_OF_TRI[mod(tri - rotation, ROTATIONS)];
}

/** The two local triangles that make up `surface` on a card with `rotation`. */
export function trisOfSurface(surface: Surface, rotation: number): [number, number] {
  const first = mod(FIRST_TRI[surface] + rotation, ROTATIONS);
  return [first, mod(first + 1, ROTATIONS)];
}

/** Where a card must be centred to exactly cover `surface` of a card at `pos`. */
export function coveringPos(pos: Pos, surface: Surface, rotation: number): Pos {
  const [, second] = trisOfSurface(surface, rotation);
  return add(pos, DIRS[second]);
}

/** Canonical key for the lattice triangle with the given three corners. */
function triKey(p: Pos, q: Pos, r: Pos): string {
  return [posKey(p), posKey(q), posKey(r)].sort().join('|');
}

/** Lattice-triangle keys for the six local triangles of a hexagon centred at `pos`. */
export function hexTriKeys(pos: Pos): string[] {
  const keys: string[] = [];
  for (let i = 0; i < ROTATIONS; i++) {
    keys.push(triKey(pos, add(pos, DIRS[i]), add(pos, DIRS[(i + 1) % ROTATIONS])));
  }
  return keys;
}

/** The six corners of a hexagon centred at `pos`, in world coordinates. */
export function hexCorners(pos: Pos): Point[] {
  return DIRS.map((d) => toWorld(add(pos, d)));
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const EPSILON = 1e-9;

export function hexInBounds(pos: Pos, bounds: Bounds): boolean {
  return hexCorners(pos).every(
    ({ x, y }) =>
      x >= bounds.minX - EPSILON &&
      x <= bounds.maxX + EPSILON &&
      y >= bounds.minY - EPSILON &&
      y <= bounds.maxY + EPSILON,
  );
}

/** Default table: about 23 cards wide and 13 cards tall. */
export const DEFAULT_BOUNDS: Bounds = { minX: -20, maxX: 20, minY: -13, maxY: 13 };

export function scaleBounds(b: Bounds, k: number): Bounds {
  return { minX: b.minX * k, maxX: b.maxX * k, minY: b.minY * k, maxY: b.maxY * k };
}

/** Start low and centred: TOPs grow up, so leave room above the first card. */
export function startPos(bounds: Bounds): Pos {
  const height = bounds.maxY - bounds.minY;
  return { a: 0, b: Math.round(bounds.minY + height * 0.3) };
}

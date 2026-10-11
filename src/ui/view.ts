import type { SoloState } from '../engine/solo';
import type { UhOhState } from '../engine/uhoh';
import type { BoardView } from './boardView';

export type SavedGame = SoloState | UhOhState;

/** What the app shell provides to the view for the running game. */
export interface ViewHost {
  board: BoardView;
  /** Panel area the view owns. */
  slot: HTMLElement;
  save(state: SavedGame): void;
  /** Start a new game with the same settings. */
  playAgain(): void;
}

export interface GameView {
  /** Subtitle under the logo. */
  readonly title: string;
  render(): void;
  /** Returns true if the key was handled. */
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

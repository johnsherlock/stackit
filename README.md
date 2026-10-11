# STACK IT (browser)

A browser version of STACK IT, the hexagonal card game with 3D energy.

Playable modes:
- **Solo Stack** (1 player), with the *No Wilds* and *Second Chances* variations
- **UH OH!** (2–5 players) and **UH OH! PARTY** (6–10, two DECKs, bigger table). Any seat can be a
  human or a bot. Several humans share one device (pass and play), and hands are hidden between turns.

Play it at **https://johnsherlock.github.io/stackit/**.

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # engine tests
npm run build
```

Every push to `main` runs the tests, builds, and publishes to GitHub Pages
(`.github/workflows/deploy.yml`).

Controls: pick a card, then click a highlighted spot to STACK it. Wilds: click a spot, click
again or press **R** to rotate, call a suit (UH OH!), then **Enter** to place. Drag to pan,
scroll or pinch to zoom. Other keys are listed under *How to play* in the app.

## How the board works

Every card is a pointy-top hexagon drawn as a cube. Its six centre-to-corner triangles pair
up into the three surfaces: **top** (match suit), **face**/left (match J/Q/K/A) and
**side**/right (match 0–10). All card centres sit on one triangular lattice, and two cards
one step apart overlap in exactly two triangles:

- straight up → covers the **top**
- down-right → covers the **side**
- down-left → covers the **face**
- the other three directions → half of two surfaces, so a card there only overhangs them

This is a flat model of what happens on a real table. The 3D look comes only from the art.

Placement rule (`checkPlacement` in `src/engine/board.ts`), from rulebook page 8: every visible
surface the new card **fully** covers is a surface it's played onto. Each one must match and not be
blocked by a ZERO, and there must be at least one. Some surfaces can never be played on (a
number's FACE, a letter's SIDE, a Wild's side and face). Once a card has nothing else left to play
on, it's out of play (dimmed), and a card may cover those dead surfaces freely. While the card is
still in play, a dead surface can't be covered. A card never goes exactly on top of another one. A card may also overhang a lower
card and half-cover one of its surfaces. That half-covered surface is then blocked: nothing can be
played onto it. But a card can't be tucked in directly below another card, cutting into the bottom of
its FACE and SIDE.

For example, with 3♠ on top of 2♠, a 3♥ on the 3♠'s side half-covers the 2♠'s side, which is now
blocked. With 5♠ on 4♠ and 4♥ on the 4♠'s side, the cell above the 4♥ is the "fourth position":
it covers the 5♠'s side *and* the 4♥'s top, so it needs a card that matches both (the 5♥).

### Rule decisions

Decided for this version where the rulebook is open to interpretation:

- Wilds offer only their **top** surface. Their side and face can never be played on.
- A Wild may turn 60° or 120° either way (4 choices, as pictured on page 7), never straight back the
  way the STACK came. Every non-Wild card is played in the current direction.
- Cards played before a Wild stay in play: their open surfaces can still be STACKED onto, by cards in
  the new direction.
- A non-Wild card lines up with the card(s) it's played onto. A Wild turns away from the card it's
  played onto, so cards after it follow the new direction.
- A Wild can be turned so nothing could ever go on its TOP (off the table, or tucked under a card).
  That's legal, but the UI warns you and bots never do it (`isDeadEndWild`).
- Several of the same number go side by side: each one on the SIDE of the one before.
- In Solo Stack a Wild's top takes any suit (no suit is called). In UH OH! you call a suit, and the
  next card on the Wild's TOP must be that suit (or another Wild).
- Solo Stack: you may discard a card even if it could be played. The top discard can be taken only
  when it has a legal spot. *Second Chances* flips the discard pile, and the game ends after a full pass
  that places nothing.
- The table is about 23 × 13 cards (doubled for a party). The first card goes low and centred,
  because TOPs grow upwards.
- The "UH OH!" call-out is left out for now: the player list just flags anyone on one card.

UH OH! specifics:

- Drawing is always allowed instead of playing, even if you have a match. Drawing ends your turn.
- An attack (J/Q/K) must be dealt with first: counter it with the same letter, or accept it. After
  accepting, you still take your normal turn. Countering adds up: J+J means the next player draws 2.
- QUEEN: the giver picks which cards to hand over, once the attack is accepted. Countered QUEENs add
  up the same way. Giving away your last card wins (the QUEEN SWEEP).
- Several of the same number: after playing a number, you may keep playing that number (each card
  must have its own legal spot), then end your turn. Each ZERO in the run reverses play (3+ players).
- A ZERO blocks its TOP for the whole of the next player's turn, including an ACE's extra turn.
- If a draw can't be made in full because the pile has run out, the game ends and the fewest cards wins.

## Code layout

```
src/engine/   pure, DOM-free game logic (shared with a future server)
  geometry.ts   lattice, triangles, surfaces, bounds
  cards.ts      deck, seeded RNG, shuffle
  board.ts      placement legality, Wild rotation and locking
  solo.ts       Solo Stack state + reducer: applySoloAction(state, action)
  uhoh.ts       UH OH! / PARTY state + reducer: applyUhOhAction(state, action)
  bot.ts        UH OH! bot: chooseBotAction(state) → action
src/ui/       SVG rendering, setup screen, one view per mode
```

### Towards online play

Everything already runs through the reducer, so the same code can run on a server:

- Game state is plain JSON, and every action names its `player`; the reducer rejects out-of-turn
  or illegal moves. A server would hold the state, apply incoming actions, and send each client
  a copy with the other players' hands and the draw pile stripped out.
- Shuffling is seeded, so a game can be replayed from its seed and action log.
- Bots are just another source of actions, so they can sit at an online table too.

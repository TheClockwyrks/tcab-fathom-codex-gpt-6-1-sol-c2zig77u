# Fathom

A bioluminescent maze chase in the deep sea. Graze every plankton mote to descend, read the corridors with sonar, and evade three hunters that track light, sound, and the flash of their own flare.

This is the **Kindle** dive: your circular window grows as you eat. Explored passages remain remembered, but disappear into darkness beyond that window. Amber lights can be food—or a Lanternjaw in disguise.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

## Production

```sh
npm run build
npm run preview
```

Serve `dist/` as a static directory. Its `index.html` and assets work at the server root or under a sub-path, with no backend or external services.

## Controls

| Control | Action |
| --- | --- |
| Arrow keys / WASD | Swim while held |
| Space | Sonar pulse |
| Shift | Ink cloud |
| P / Escape | Pause or resume |
| M | Toggle sound |
| Up / Down | Select a menu item |
| Enter / Space | Confirm |
| Escape | Back |
| Backtick | Diagnostic overlay |

Menus also support pointer and touch. Touch controls appear when playing on a touchscreen. Eat every plankton to clear the maze. Three reserve lives provide four attempts; eaten plankton and explored terrain survive a catch.

## Verification

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests run the actual Simple 2D engine over a native canvas and scripted clocks. The game exports its immutable state contract and debug operations from `src/game.ts`; the engine exposes these through `engine.state`, `engine.debug`, and `engine.apply`. Nothing is installed on the page.

The player presentation and captured gameplay are in `showcase/`. The full design contract is in `specs/`, with engine API documentation in `engine/`.

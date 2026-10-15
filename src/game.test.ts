/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import {
  createEngine,
  ConstantClock,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine, Clock } from "@clockwyrks/simple-2d";
import {
  game,
  BACKGROUND,
  type FathomState,
  type FathomDebugApi,
} from "./game";
import * as C from "./constants";

const engines: Engine<FathomState, FathomDebugApi>[] = [];
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    async (url: string) => new Response(await readFile(url)),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterEach(() => {
  engines.forEach((e) => e.destroy());
  engines.length = 0;
  vi.unstubAllGlobals();
});
async function setup(clock: Clock = new ConstantClock(1000 / C.TICK_HZ)) {
  const events = new EventTarget();
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const e = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game,
    clock,
    background: BACKGROUND,
    layout: C.LAYOUT,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  engines.push(e);
  await e.initialize();
  const key = (code: string, type = "keydown") => {
    const event = new Event(type);
    Object.defineProperties(event, {
      code: { value: code },
      repeat: { value: false },
    });
    events.dispatchEvent(event);
  };
  const d = e.debug;
  return {
    e,
    d,
    key,
    play: () => {
      e.apply((s) => d.clearPredators(s));
      e.apply((s) => d.setScreen(s, "playing"));
    },
  };
}
const fixture = () =>
  Array.from({ length: C.GRID_ROWS }, (_, y) =>
    y === 5 ? "#" + ".".repeat(34) + "#" : "#".repeat(C.GRID_COLS),
  );

describe("Fathom simulation through Simple 2D", () => {
  it("initializes the entire serializable contract and loads all seeded frames", async () => {
    const { e, d } = await setup();
    const s = d.snapshot(e.state);
    expect(s.screen).toBe("title");
    expect(s.lives).toBe(C.START_LIVES);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(s.predators.map((p) => p.kind)).toEqual(C.DEN_ORDER);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(Object.values(e.state.art).reduce((n, a) => n + a.length, 0)).toBe(
      75,
    );
  });
  it("lays out a connected symmetric maze with no dead ends or wide corridors and correct proportions", async () => {
    const { e } = await setup();
    const rows = e.state.tiles;
    const points: [number, number][] = [];
    const neighbors = (x: number, y: number) =>
      [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]
        .map(([a, b]) => [(a + C.GRID_COLS) % C.GRID_COLS, b])
        .filter(([a, b]) => rows[b]?.[a] === ".");
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        if (rows[y][x] === ".") {
          points.push([x, y]);
          expect(neighbors(x, y).length).toBeGreaterThanOrEqual(2);
          expect(
            [rows[y + 1]?.[x], rows[y]?.[x + 1], rows[y + 1]?.[x + 1]].every(
              (t) => t === ".",
            ),
          ).toBe(false);
        }
        if (!"dg".includes(rows[y][x]) && !"dg".includes(rows[y][35 - x]))
          expect(rows[y][x]).toBe(rows[y][35 - x]);
      }
    const seen = new Set<string>();
    const queue = [points[0]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      if (seen.has(`${x},${y}`)) continue;
      seen.add(`${x},${y}`);
      for (const n of neighbors(x, y)) queue.push(n as [number, number]);
    }
    expect(seen.size).toBe(points.length);
    const openness =
      points.reduce((n, [x, y]) => n + neighbors(x, y).length, 0) /
      points.length;
    expect(openness).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(openness).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    expect(points.length / 544).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    const degreeTwo = new Set(
      points
        .filter(([x, y]) => neighbors(x, y).length === 2)
        .map((p) => p.join(",")),
    );
    const lengths: number[] = [];
    while (degreeTwo.size) {
      const start = degreeTwo.values().next().value!;
      const run = [start];
      degreeTwo.delete(start);
      for (let i = 0; i < run.length; i++) {
        const [x, y] = run[i].split(",").map(Number);
        for (const p of neighbors(x, y)) {
          const k = p.join(",");
          if (degreeTwo.delete(k)) run.push(k);
        }
      }
      lengths.push(run.length);
    }
    const mean = lengths.reduce((n, v) => n + v, 0) / lengths.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
  });
  it("runs the countdown and remembers title selection", async () => {
    const { e, d, key } = await setup();
    e.apply((s) => d.setMenuIndex(s, 1));
    key("Enter");
    await e.advance(1);
    expect(e.state.screen).toBe("howto");
    key("Enter", "keyup");
    key("Escape");
    await e.advance(1);
    expect(e.state.menuIndex).toBe(1);
    e.apply((s) => d.setMenuIndex(s, 0));
    key("Enter");
    await e.advance(1);
    expect(e.state.screen).toBe("countdown");
    await e.advance(240);
    expect(e.state.screen).toBe("playing");
    expect(e.state.predators[0].released).toBe(true);
  });
  it("moves continuously at 128 units/sec, stops on release, and preserves prior state", async () => {
    const { e, d, key, play } = await setup();
    e.apply((s) => d.setMaze(s, fixture()));
    e.apply((s) => d.setForagerTile(s, 10, 5));
    e.apply((s) => d.clearPlankton(s));
    play();
    const old = e.state;
    key("ArrowRight");
    await e.advance(60);
    expect(e.state.forager.x - old.forager.x).toBeCloseTo(64);
    expect(old.forager.tx).toBe(10);
    key("ArrowRight", "keyup");
    const x = e.state.forager.x;
    await e.advance(10);
    expect(e.state.forager.x).toBe(x);
    expect(e.state.forager.moving).toBe(false);
  });
  it("carries the same ticks across uneven frame partitions", async () => {
    const a = await setup(new ConstantClock(1000 / 60));
    const b = await setup(new SequenceClock([3, 7, 11, 19]));
    a.play();
    b.play();
    await a.e.advance(60);
    await b.e.advance(100);
    expect(a.e.state.simTime).toBeCloseTo(1);
    expect(b.e.state.simTime).toBeCloseTo(1);
    expect(a.d.snapshot(a.e.state)).toEqual(b.d.snapshot(b.e.state));
  });
  it("eats, holds brightness, then decays on the half-life curve", async () => {
    const { e, d, play } = await setup();
    e.apply((s) => d.clearPlankton(s));
    e.apply((s) => d.setPlankton(s, 17, 16, true));
    e.apply((s) => d.setPlankton(s, 16, 16, true));
    play();
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_PLANKTON);
    expect(e.state.brightness).toBe(C.BRIGHT_PER_EAT);
    await e.advance(120);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    await e.advance(108);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
  });
  it("clears only by eating the final mote, then descends with score and lives", async () => {
    const { e, d, play } = await setup();
    e.apply((s) => d.clearPlankton(s));
    play();
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
    e.apply((s) => d.setPlankton(s, 17, 16, true));
    await e.advance(1);
    expect(e.state.screen).toBe("cleared");
    expect(e.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    await e.advance(240);
    expect(e.state.depth).toBe(2);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.predators).toHaveLength(4);
  });
  it("freezes the world while paused but advances simulation time", async () => {
    const { e, key, play } = await setup();
    play();
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("paused");
    const p = e.state.forager;
    await e.advance(240);
    expect(e.state.forager).toEqual(p);
    expect(e.state.simTime).toBeCloseTo(241 * C.TICK_DT);
    key("Escape", "keyup");
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
  });
  it("emits sonar and ink once per press and respects cooldowns", async () => {
    const { e, key, play } = await setup();
    play();
    key("Space");
    key("ShiftLeft");
    await e.advance(1);
    expect(e.state.pulses[0].source).toBe("forager");
    expect(e.state.inkClouds[0].radius).toBe(C.INK_RADIUS);
    await e.advance(60);
    expect(e.state.pulses).toHaveLength(1);
    expect(e.state.inkClouds).toHaveLength(1);
    key("Space", "keyup");
    key("Space");
    await e.advance(1);
    expect(e.state.pulses).toHaveLength(1);
  });
  it("reconciles derived readings without revealing tiles or advancing time", async () => {
    const { e, d } = await setup();
    e.apply((s) => d.setBrightness(s, 1));
    e.apply((s) => d.setDepth(s, 99));
    e.apply((s) => d.clearFog(s));
    const before = d.snapshot(e.state);
    e.apply(d.reconcile);
    expect(d.snapshot(e.state)).toEqual(before);
    expect(e.state.windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN,
    );
    expect(e.state.predators).toHaveLength(6);
    expect(e.state.sonar.range).toBe(C.SONAR_RANGE_MIN);
  });
  it("keeps fog memory through a lost life and ends after reserves are spent", async () => {
    const { e, d, play } = await setup();
    play();
    await e.advance(1);
    e.apply((s) => d.addPredator(s, "lanternjaw", 17, 16));
    e.apply((s) => d.setPredatorMind(s, 0, false));
    await e.advance(1);
    expect(e.state.lives).toBe(2);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.visibility.join("")).toContain("l");
    e.apply((s) => d.setLives(s, 0));
    e.apply((s) => d.clearPredators(s));
    e.apply((s) => d.addPredator(s, "gloamfin", 17, 16));
    e.apply((s) => d.setPredatorMind(s, 0, false));
    e.apply((s) => d.setScreen(s, "playing"));
    await e.advance(1);
    expect(e.state.screen).toBe("gameover");
  });
  it("hunts light and immediately drops the fix when ink blocks it", async () => {
    const { e, d, key, play } = await setup();
    e.apply((s) => d.setMaze(s, fixture()));
    e.apply((s) => d.setForagerTile(s, 10, 5));
    play();
    e.apply((s) => d.addPredator(s, "lanternjaw", 13, 5));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].alert).toBe(false);
    key("ShiftLeft");
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("wander");
  });
  it("Gloamfin hears through rock and ink while travel is disabled", async () => {
    const { e, d, key, play } = await setup();
    e.apply((s) => d.setMaze(s, fixture()));
    e.apply((s) => d.setForagerTile(s, 10, 5));
    play();
    e.apply((s) => d.addPredator(s, "gloamfin", 12, 5));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    key("ShiftLeft");
    await e.advance(1);
    expect(e.state.predators[0].hearingLock).toBe(true);
    expect(e.state.predators[0].alert).toBe(true);
    expect(e.state.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
    expect(e.state.predators[0].tx).toBe(12);
  });
  it("spawns and consumes drifters without limiting debug spawns", async () => {
    const { e, d, play } = await setup();
    play();
    e.apply((s) => d.setDrifterIn(s, 0));
    await e.advance(1);
    expect(e.state.drifters).toHaveLength(1);
    for (let i = 0; i < 3; i++) e.apply((s) => d.spawnDrifter(s, 17, 16));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_PLANKTON + 3 * C.SCORE_DRIFTER);
    expect(e.state.drifters).toHaveLength(1);
  });
  it("validates fixtures and debug arguments loudly", async () => {
    const { e, d } = await setup();
    expect(() => d.setBrightness(e.state, 2)).toThrow();
    expect(() => d.setScore(e.state, -1)).toThrow();
    expect(() => d.setMaze(e.state, ["."])).toThrow();
    expect(() => d.setMenuIndex(e.state, 4)).toThrow();
    expect(() => d.setPredatorTile(e.state, 20, 1, 1)).toThrow();
  });
  it("mute persists through resets and diagnostic reads reflect current state", async () => {
    const { e, d, key } = await setup();
    key("KeyM");
    await e.advance(1);
    expect(e.state.muted).toBe(true);
    e.apply((s) => d.setScore(s, 320));
    expect(e.diagnostics().find((r) => r.name === "score")?.value).toBe(320);
    e.apply(d.reset);
    expect(e.state.score).toBe(0);
    expect(e.state.muted).toBe(true);
    expect(e.state.simTime).toBe(0);
  });
  it("carries continuous position through the wrap tunnel", async () => {
    const { e, d, key, play } = await setup();
    e.apply((s) => d.setForagerTile(s, 0, 8));
    e.apply((s) => d.clearPlankton(s));
    play();
    key("ArrowLeft");
    await e.advance(30);
    expect(e.state.forager.tx).toBe(35);
    expect(e.state.forager.x).toBeCloseTo(C.GRID_ORIGIN_X + 35.5 * C.TILE);
  });
  it("sonar arrives over time, marks a Gloamfin, and leaves amber bodies unresolved", async () => {
    const { e, d, key, play } = await setup();
    e.apply((s) => d.setMaze(s, fixture()));
    e.apply((s) => d.setForagerTile(s, 5, 5));
    play();
    e.apply((s) => d.addPredator(s, "gloamfin", 11, 5));
    e.apply((s) => d.addPredator(s, "lanternjaw", 12, 5));
    for (let i = 0; i < 2; i++)
      e.apply((s) => d.setPredatorTravel(s, i, false));
    key("Space");
    await e.advance(30);
    expect(e.state.predators[0].state).toBe("wander");
    await e.advance(24);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].lit).toBe(true);
    expect(e.state.predators[1].lit).toBe(false);
    await e.advance(126);
    expect(e.state.sonar.ready).toBe(true);
  });
  it("Flarefish charges, blooms through rock, then re-arms", async () => {
    const { e, d, play } = await setup();
    e.apply((s) => d.setMaze(s, fixture()));
    e.apply((s) => d.setForagerTile(s, 2, 5));
    play();
    e.apply((s) => d.addPredator(s, "flarefish", 25, 5));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    await e.advance(840);
    expect(e.state.predators[0].flareCharging).toBe(true);
    await e.advance(60);
    expect(e.state.predators[0].flaring).toBe(true);
    expect(e.state.visibility[6][25]).toBe("l");
    await e.advance(120);
    expect(e.state.predators[0].flaring).toBe(false);
    expect(e.state.visibility[6][25]).toBe("r");
  }, 15000);
  it("routes a pursuing predator around an obstacle instead of crossing rock", async () => {
    const { e, d, play } = await setup();
    const rows = fixture();
    rows[5] = "#" + ".".repeat(4) + "#" + ".".repeat(29) + "#";
    rows[6] = "#".repeat(4) + "." + "#" + "." + "#".repeat(29);
    rows[7] = "#".repeat(4) + "..." + "#".repeat(29);
    e.apply((s) => d.setMaze(s, rows));
    e.apply((s) => d.setForagerTile(s, 7, 5));
    play();
    e.apply((s) => d.addPredator(s, "lanternjaw", 4, 5));
    e.apply((s) => d.setPredatorState(s, 0, "chase"));
    await e.advance(30);
    expect(e.state.predators[0].dir).toBe("down");
    expect(e.state.predators[0].ty).toBe(6);
    expect(
      e.state.tiles[e.state.predators[0].ty][e.state.predators[0].tx],
    ).toBe(".");
  });
});

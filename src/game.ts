// Fathom keeps the simulation, poses, and drawing on the same state contract.
// Transitions clone their input before building the next value; rendering only reads.
import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";

export const BACKGROUND = "#03060c";
export type Direction = "up" | "down" | "left" | "right";
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";
export type PredatorKind = C.PredatorKind;
export interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Direction;
}
export interface Drifter extends Body {
  lit: boolean;
  mind: boolean;
  travel: boolean;
}
export interface Predator extends Drifter {
  kind: PredatorKind;
  state: "den" | "wander" | "chase" | "search";
  released: boolean;
  speed: number;
  alert: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
  fix: { tx: number; ty: number } | null;
  linger: number;
  alertLeft: number;
  mark: number;
  pingIn: number;
  sincePing: number;
  searchTime: number;
  searchPing: boolean;
  flareIn: number;
  flareTime: number;
  fade: number;
  chaseSpeed: number;
  slot: number | null;
}
export interface Pulse {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  front: number;
  range: number;
  owner: number | null;
  caught: boolean;
}
export interface FathomState {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: Body & { moving: boolean };
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: { x: number; y: number; radius: number; remaining: number }[];
  simTime: number;
  accumulator: number;
  screenTime: number;
  playTime: number;
  desired: Direction;
  seed: number;
  pointerItem: number | null;
  pointerX: number;
  pointerY: number;
  marks: number[];
  art: Record<string, ImageBitmap[]>;
}
type ReadState = DeepReadonly<FathomState>;
const dirs: Direction[] = ["up", "right", "down", "left"];
const vec: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
const opposite = (d: Direction): Direction => dirs[(dirs.indexOf(d) + 2) % 4];
const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  tx,
  ty,
});
const layer = (ch: string) =>
  Array.from({ length: C.GRID_ROWS }, () => ch.repeat(C.GRID_COLS));
const tile = (s: ReadState, x: number, y: number) => s.tiles[y]?.[x] ?? "#";
function put(rows: string[], x: number, y: number, ch: string): void {
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
}
function maze(): string[] {
  const rows = layer("#");
  for (let y = 1; y < C.GRID_ROWS - 1; y++)
    for (let x = 1; x < C.GRID_COLS - 1; x++)
      if (
        [1, 5, 11, 16].includes(y) ||
        [1, 5, 9, 13, 22, 26, 30, 34].includes(x)
      )
        put(rows, x, y, ".");
  for (let x = 0; x < C.GRID_COLS; x++)
    if (x <= 13 || x >= 22) put(rows, x, 8, ".");
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  return rows;
}
function hunter(
  kind: PredatorKind,
  tx: number,
  ty: number,
  slot: number | null,
): Predator {
  return {
    ...center(tx, ty),
    dir: "up",
    lit: false,
    mind: true,
    travel: true,
    kind,
    state: slot === null ? "wander" : "den",
    released: slot === null,
    speed: C.PREDATOR_SPEED,
    alert: false,
    detectRange: kind === "gloamfin" ? null : C.LANTERN_RANGE_BASE,
    hearingRange: kind === "gloamfin" ? C.GLOAMFIN_HEAR : null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    mark: 0,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    sincePing: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flareTime: 0,
    fade: 0,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    slot,
  };
}
function roster(depth: number): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  return kinds.map((k, i) => hunter(k, 16 + (i % 4), 8 + Math.floor(i / 4), i));
}
function fresh(
  art: Record<string, ImageBitmap[]> = {},
  muted = false,
): FathomState {
  const tiles = maze();
  const s: FathomState = {
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) => r.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: layer("u"),
    forager: { ...center(17, 16), dir: "left", moving: false },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    screenTime: 0,
    playTime: 0,
    desired: "left",
    seed: 73471,
    pointerItem: null,
    pointerX: 0,
    pointerY: 0,
    marks: Array(C.GRID_COLS * C.GRID_ROWS).fill(0) as number[],
    art,
  };
  return reconcile(s);
}
function clone(s: ReadState): FathomState {
  return {
    ...s,
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    drifters: s.drifters.map((d) => ({ ...d })),
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((i) => ({ ...i })),
    marks: [...s.marks],
    art: s.art as Record<string, ImageBitmap[]>,
  };
}
function locate(b: Body): void {
  b.tx = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE);
  b.ty = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
}
function reconcile(state: ReadState): FathomState {
  const s = clone(state);
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.join("").split("*").length - 1;
  locate(s.forager);
  for (const d of s.drifters) locate(d);
  for (const p of s.predators) {
    locate(p);
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  }
  return s;
}
function enter(s: FathomState, screen: Screen): void {
  s.screen = screen;
  s.screenTime = 0;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : screen === "paused" || screen === "gameover"
        ? 0
        : null;
  if (screen === "playing" && s.playTime === 0) s.playTime = 0;
}
function newDive(s: FathomState, screen: Screen): FathomState {
  const n = fresh(s.art, s.muted);
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.accumulator = s.accumulator;
  enter(n, screen);
  return n;
}
function neighbor(
  s: ReadState,
  x: number,
  y: number,
  d: Direction,
): [number, number] {
  const [dx, dy] = vec[d];
  let nx = x + dx;
  const ny = y + dy;
  if (
    ny === y &&
    (nx < 0 || nx >= C.GRID_COLS) &&
    tile(s, 0, y) === "." &&
    tile(s, C.GRID_COLS - 1, y) === "."
  )
    nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  return [nx, ny];
}
function open(s: ReadState, x: number, y: number, den = false): boolean {
  const t = tile(s, x, y);
  return t === "." || (den && (t === "d" || t === "g"));
}
function options(s: ReadState, b: Body, den = false): Direction[] {
  return dirs.filter((d) => {
    const [x, y] = neighbor(s, b.tx, b.ty, d);
    return open(s, x, y, den);
  });
}
function random(s: FathomState): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
function wander(s: FathomState, b: Body, den = false): Direction {
  const all = options(s, b, den);
  const choices = all.filter((d) => d !== opposite(b.dir));
  const list = choices.length ? choices : all;
  return list[Math.floor(random(s) * list.length)] ?? b.dir;
}
function distances(
  s: ReadState,
  tx: number,
  ty: number,
  den = false,
): number[] {
  const out = Array(C.GRID_COLS * C.GRID_ROWS).fill(Infinity) as number[];
  if (!open(s, tx, ty, den)) return out;
  const queue: [[number, number]] | [number, number][] = [[tx, ty]];
  out[ty * C.GRID_COLS + tx] = 0;
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const d of dirs) {
      const [nx, ny] = neighbor(s, x, y, d);
      if (open(s, nx, ny, den) && out[ny * C.GRID_COLS + nx] === Infinity) {
        out[ny * C.GRID_COLS + nx] = out[y * C.GRID_COLS + x] + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return out;
}
function route(
  s: ReadState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  if (b.tx === target.tx && b.ty === target.ty) return null;
  const map = distances(s, target.tx, target.ty, den);
  let best = Infinity;
  let result: Direction | null = null;
  for (const d of options(s, b, den)) {
    const [x, y] = neighbor(s, b.tx, b.ty, d);
    if (map[y * C.GRID_COLS + x] < best) {
      best = map[y * C.GRID_COLS + x];
      result = d;
    }
  }
  return result;
}
function move(
  s: FathomState,
  b: Body,
  speed: number,
  choose: () => Direction | null,
  den = false,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  let remaining = speed * C.TICK_DT;
  let moved = false;
  while (remaining > 1e-8) {
    const c = center(b.tx, b.ty);
    const at = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (at) {
      const d = choose();
      if (!d) break;
      b.dir = d;
      if (!options(s, b, den).includes(d)) break;
    }
    const [dx, dy] = vec[b.dir];
    let distance = dx
      ? dx > 0
        ? c.x - b.x
        : c.x * -1 + b.x
      : dy > 0
        ? c.y - b.y
        : b.y - c.y;
    if (distance < 1e-7) distance += C.TILE;
    const travel = Math.min(remaining, distance);
    b.x += dx * travel;
    b.y += dy * travel;
    const right = C.GRID_ORIGIN_X + C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += C.GRID_COLS * C.TILE;
    if (b.x >= right) b.x -= C.GRID_COLS * C.TILE;
    locate(b);
    remaining -= travel;
    moved = true;
  }
  return moved;
}
function los(
  s: ReadState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  targetRock = false,
): boolean {
  const n = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 4);
  const end = {
    tx: Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE),
    ty: Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE),
  };
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const x = Math.floor((a.x + (b.x - a.x) * t - C.GRID_ORIGIN_X) / C.TILE);
    const y = Math.floor((a.y + (b.y - a.y) * t - C.GRID_ORIGIN_Y) / C.TILE);
    if (tile(s, x, y) === "#" && !(targetRock && x === end.tx && y === end.ty))
      return false;
  }
  return true;
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
function blinded(s: ReadState, p: Body): boolean {
  const f = s.forager;
  return s.inkClouds.some((i) => {
    const dx = f.x - p.x,
      dy = f.y - p.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((i.x - p.x) * dx + (i.y - p.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    return Math.hypot(i.x - p.x - t * dx, i.y - p.y - t * dy) <= i.radius;
  });
}
function acquire(s: FathomState, p: Predator, freshFix = false): void {
  if ((p.state !== "chase" || freshFix) && p.kind !== "lanternjaw") {
    p.alertLeft = C.ALERT_TIME;
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  const heading = route(s, p, p.fix);
  if (heading === opposite(p.dir)) p.dir = heading;
  p.flareTime = 0;
  p.flaring = p.kind === "flarefish" ? false : null;
  p.flareCharging = p.kind === "flarefish" ? false : null;
  p.flareRadius = p.kind === "flarefish" ? 0 : null;
}
function cast(
  s: FathomState,
  source: Pulse["source"],
  b: Body,
  tint: Pulse["tint"],
  owner: number | null,
): void {
  s.pulses.push({
    source,
    tint,
    ox: b.tx,
    oy: b.ty,
    front: 0,
    range: source === "forager" ? s.sonar.range : C.GLOAMFIN_PING_RANGE,
    owner,
    caught: false,
  });
}
function sense(s: FathomState): void {
  const flares = s.predators.filter((p) => p.flaring);
  const rows = s.visibility.map((r) => r.replace(/l/g, "r"));
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const c = center(x, y);
      if (
        (distance(c, s.forager) <= s.visionRadius &&
          los(s, s.forager, c, true)) ||
        s.marks[y * C.GRID_COLS + x] > 0 ||
        flares.some((p) => distance(c, p) <= C.FLARE_RADIUS)
      )
        put(rows, x, y, "l");
    }
  s.visibility = rows;
  const light = (b: Body) =>
    (distance(center(b.tx, b.ty), s.forager) <= s.visionRadius &&
      los(s, s.forager, center(b.tx, b.ty), true)) ||
    flares.some((p) => distance(b, p) <= C.FLARE_RADIUS);
  for (const d of s.drifters) d.lit = light(d);
  for (const p of s.predators)
    p.lit =
      p.state !== "den" &&
      (light(p) ||
        (p.kind !== "lanternjaw" && p.mark > 0) ||
        p.alert ||
        !!p.flareCharging);
}
const countdown = (value: number, dt: number): number =>
  value <= dt + 1e-9 ? 0 : value - dt;

function tick(
  s: FathomState,
  held: Direction | null,
  events: Set<string>,
): FathomState {
  const dt = C.TICK_DT;
  s.simTime += dt;
  s.screenTime += dt;
  if (s.screen === "countdown") {
    sense(s);
    if (s.screenTime + 1e-9 >= 2) {
      enter(s, "playing");
      s.playTime = 0;
      for (const p of s.predators) if (p.slot === 0) p.released = true;
    }
    return s;
  }
  if (s.screen === "cleared") {
    if (s.screenTime + 1e-9 >= 2) {
      const n = newDive(s, "countdown");
      n.depth = s.depth + 1;
      n.score = s.score;
      n.lives = s.lives;
      n.predators = roster(n.depth);
      return reconcile(n);
    }
    return s;
  }
  if (s.screen !== "playing") return s;
  s.playTime += dt;
  s.sonar.cooldown = countdown(s.sonar.cooldown, dt);
  s.ink.cooldown = countdown(s.ink.cooldown, dt);
  const decay = Math.max(0, dt - s.brightHold);
  s.brightHold = countdown(s.brightHold, dt);
  s.brightness *= Math.pow(0.5, decay / C.BRIGHT_HALFLIFE);
  if (held) {
    s.desired = held;
    if (held === opposite(s.forager.dir)) s.forager.dir = held;
    s.forager.moving = move(s, s.forager, C.FORAGER_SPEED, () =>
      options(s, s.forager).includes(s.desired)
        ? s.desired
        : options(s, s.forager).includes(s.forager.dir)
          ? s.forager.dir
          : null,
    );
  } else s.forager.moving = false;
  const f = s.forager;
  if (s.plankton[f.ty]?.[f.tx] === "*") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    events.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      enter(s, "cleared");
      events.add(C.CUES.descend);
      return reconcile(s);
    }
  }
  s.inkClouds = s.inkClouds
    .map((i) => ({ ...i, remaining: countdown(i.remaining, dt) }))
    .filter((i) => i.remaining > 0);
  s.marks = s.marks.map((v) => countdown(v, dt));
  for (const p of s.predators) {
    p.mark = countdown(p.mark, dt);
    if (p.mind) p.alertLeft = countdown(p.alertLeft, dt);
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
  }
  for (const pulse of s.pulses) {
    const prev = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * dt;
    const map = distances(s, pulse.ox, pulse.oy, true);
    const hit = (x: number, y: number) => {
      const d = map[y * C.GRID_COLS + x];
      return (
        d <= pulse.range &&
        d <= pulse.front &&
        (d > prev || (prev === 0 && d === 0))
      );
    };
    if (pulse.source === "forager") {
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (hit(x, y)) {
            s.marks[y * C.GRID_COLS + x] = C.SONAR_MARK_TIME;
            for (const d of dirs) {
              const [nx, ny] = neighbor(s, x, y, d);
              if (
                tile(s, nx, ny) === "#" &&
                nx >= 0 &&
                nx < C.GRID_COLS &&
                ny >= 0 &&
                ny < C.GRID_ROWS
              )
                s.marks[ny * C.GRID_COLS + nx] = C.SONAR_MARK_TIME;
            }
          }
      for (const p of s.predators)
        if (p.state !== "den" && hit(p.tx, p.ty)) {
          if (p.kind !== "lanternjaw") p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p, true);
        }
    } else if (!pulse.caught && hit(f.tx, f.ty)) {
      const p = pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (p?.mind) acquire(s, p, true);
      pulse.caught = true;
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
  for (let index = 0; index < s.predators.length; index++) {
    const p = s.predators[index];
    if (p.slot !== null && s.playTime + 1e-8 >= p.slot * C.DEN_RELEASE_GAP)
      p.released = true;
    if (!p.mind) continue;
    if (p.state === "den") {
      const gate = findGate(s);
      if (!gate || !s.tiles.some((r) => r.includes("d"))) continue;
      if (p.released && p.travel) {
        const outside = dirs
          .map((d) => neighbor(s, gate.tx, gate.ty, d))
          .find(([x, y]) => tile(s, x, y) === ".");
        if (outside) {
          move(
            s,
            p,
            p.speed,
            () => route(s, p, { tx: outside[0], ty: outside[1] }, true),
            true,
          );
          if (tile(s, p.tx, p.ty) === ".") p.state = "wander";
        }
      }
      continue;
    }
    p.sincePing += dt;
    p.pingIn = countdown(p.pingIn, dt);
    p.fade = countdown(p.fade, dt);
    if (p.kind === "gloamfin") {
      const was = p.hearingLock;
      p.hearingLock = distance(p, f) <= C.GLOAMFIN_HEAR;
      if (p.hearingLock) acquire(s, p);
      else if (was) p.pingIn = 0;
      if (
        p.state === "chase" &&
        p.fix &&
        p.tx === p.fix.tx &&
        p.ty === p.fix.ty &&
        !p.hearingLock &&
        (p.tx !== f.tx || p.ty !== f.ty)
      ) {
        p.state = "search";
        p.searchTime = 0;
        p.searchPing = false;
      }
      if (p.state === "search") {
        p.searchTime += dt;
        if (p.searchTime + 1e-9 >= C.GLOAMFIN_GIVEUP) {
          p.state = "wander";
          p.fix = null;
        }
      }
      const orange =
        p.state === "search" &&
        p.searchTime + 1e-9 >= C.GLOAMFIN_SEARCH_DELAY &&
        !p.searchPing;
      if (
        !p.hearingLock &&
        p.sincePing + 1e-9 >= C.GLOAMFIN_PING_MIN_GAP &&
        (orange || p.pingIn === 0)
      ) {
        cast(s, "gloamfin", p, orange ? "orange" : "violet", index);
        p.pingIn = C.GLOAMFIN_PING_INTERVAL;
        p.sincePing = 0;
        if (orange) p.searchPing = true;
        events.add(C.CUES.predatorPing);
      }
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * dt) /
            C.GLOAMFIN_RAMP_TIME,
      );
    } else {
      const blind = blinded(s, p);
      const seen =
        !blind &&
        ((distance(p, f) <=
          C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness &&
          los(s, p, f)) ||
          (!!p.flaring && distance(p, f) <= C.FLARE_RADIUS));
      if (seen) acquire(s, p);
      else if (p.state === "chase") {
        p.linger -= dt;
        if (blind || p.linger <= 1e-9) {
          p.state = "wander";
          p.fix = null;
          p.flareIn = C.FLARE_INTERVAL;
        }
      }
      if (p.kind === "flarefish") {
        if (p.state === "wander") {
          if (p.flareTime > 0) {
            const before = p.flareTime;
            p.flareTime = countdown(p.flareTime, dt);
            if (
              before > C.FLARE_BLOOM + 1e-9 &&
              p.flareTime <= C.FLARE_BLOOM + 1e-9
            )
              events.add(C.CUES.flare);
            if (p.flareTime <= 0) {
              p.flareTime = 0;
              p.flareIn = C.FLARE_INTERVAL;
              p.fade = 0.4;
            }
          } else {
            p.flareIn = countdown(p.flareIn, dt);
            if (p.flareIn <= 0) p.flareTime = C.FLARE_CHARGE + C.FLARE_BLOOM;
          }
        }
        p.flareCharging = p.flareTime > C.FLARE_BLOOM + 1e-9;
        p.flaring = p.flareTime > 0 && p.flareTime <= C.FLARE_BLOOM + 1e-9;
        p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
      }
    }
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    p.speed =
      p.kind === "lanternjaw" && p.state === "wander"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
    if (p.travel)
      move(s, p, p.speed, () => {
        let d: Direction | null;
        if (p.state === "chase" && p.fix) d = route(s, p, p.fix);
        else if (p.state === "search" && p.fix) {
          const map = distances(s, p.fix.tx, p.fix.ty);
          d =
            map[p.ty * C.GRID_COLS + p.tx] >= C.GLOAMFIN_SEARCH_ROAM
              ? route(s, p, p.fix)
              : wander(s, p);
        } else d = wander(s, p);
        if (
          d &&
          p.kind === "gloamfin" &&
          p.state === "chase" &&
          d !== p.dir &&
          d !== opposite(p.dir)
        ) {
          p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
          p.speed = p.chaseSpeed;
        }
        return d;
      });
  }
  s.drifterIn = countdown(s.drifterIn, dt);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const g = findGate(s);
    if (g) {
      const adjacent = dirs
        .map((d) => neighbor(s, g.tx, g.ty, d))
        .find(([x, y]) => tile(s, x, y) === ".");
      if (adjacent) {
        s.drifters.push({
          ...center(...adjacent),
          dir: "up",
          lit: false,
          mind: true,
          travel: true,
        });
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  for (const d of s.drifters)
    if (d.mind && d.travel) move(s, d, C.DRIFTER_SPEED, () => wander(s, d));
  s.drifters = s.drifters.filter((d) => {
    if (d.tx === f.tx && d.ty === f.ty) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  if (
    s.predators.some((p) => p.state !== "den" && p.tx === f.tx && p.ty === f.ty)
  ) {
    events.add(C.CUES.caught);
    if (s.lives === 0) enter(s, "gameover");
    else {
      s.lives--;
      s.forager = { ...center(17, 16), dir: "left", moving: false };
      s.predators = roster(s.depth);
      s.brightness = 0;
      s.brightHold = 0;
      s.drifters = [];
      s.drifterIn = C.DRIFTER_INTERVAL;
      s.pulses = [];
      s.inkClouds = [];
      s.sonar.cooldown = 0;
      s.ink.cooldown = 0;
      s.marks = s.marks.map(() => 0);
      s.playTime = 0;
      enter(s, "countdown");
    }
  }
  s = reconcile(s);
  sense(s);
  return s;
}
function findGate(s: ReadState): { tx: number; ty: number } | null {
  for (let y = 0; y < C.GRID_ROWS; y++) {
    const x = s.tiles[y].indexOf("g");
    if (x >= 0) return { tx: x, ty: y };
  }
  return null;
}
const items = (s: ReadState): readonly string[] =>
  s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
function rect(
  s: ReadState,
  index: number,
): { x: number; y: number; w: number; h: number } | null {
  return Number.isInteger(index) && index >= 0 && index < items(s).length
    ? { x: 490, y: 430 + index * 58, w: 300, h: 46 }
    : null;
}
function confirm(s: FathomState): FathomState {
  const i = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = i ?? 0;
    return i === 0 ? newDive(s, "countdown") : (enter(s, "howto"), s);
  }
  if (s.screen === "paused") {
    if (i === 0) enter(s, "playing");
    else return newDive(s, i === 1 ? "countdown" : "title");
  } else if (s.screen === "gameover")
    return newDive(s, i === 0 ? "countdown" : "title");
  return s;
}
function controls(
  s: FathomState,
  api: UpdateApi,
): { s: FathomState; held: Direction | null } {
  const pressed = Object.fromEntries(
    C.ACTIONS.map((a) => [a, api.input.pressed(a)]),
  ) as Record<C.ActionName, boolean>;
  if (pressed.mute) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  const held = dirs.filter((d) => api.input.value(d) > 0);
  const newlyPressed = dirs.find((d) => pressed[d]);
  const direction =
    newlyPressed ??
    (held.includes(s.desired) ? s.desired : (held[held.length - 1] ?? null));
  const pointer = api.input.pointer();
  const hit = items(s).findIndex((_, i) => {
    const r = rect(s, i)!;
    return (
      pointer.x >= r.x &&
      pointer.x <= r.x + r.w &&
      pointer.y >= r.y &&
      pointer.y <= r.y + r.h
    );
  });
  if ((pointer.x !== s.pointerX || pointer.y !== s.pointerY) && hit >= 0)
    s.menuIndex = hit;
  s.pointerX = pointer.x;
  s.pointerY = pointer.y;
  // Read individual samples: a press and release may arrive in one frame.
  let click = false;
  for (const sample of api.input.pointerSamples()) {
    if (
      !sample.primary ||
      (sample.button !== null && sample.button !== "primary")
    )
      continue;
    const item = items(s).findIndex((_, i) => {
      const r = rect(s, i)!;
      return (
        sample.x >= r.x &&
        sample.x <= r.x + r.w &&
        sample.y >= r.y &&
        sample.y <= r.y + r.h
      );
    });
    if (sample.type === "down") {
      s.pointerItem = s.screen === "howto" ? -2 : item >= 0 ? item : null;
      if (item >= 0) s.menuIndex = item;
    } else if (sample.type === "up") {
      if (
        s.pointerItem !== null &&
        (s.screen === "howto" ? s.pointerItem === -2 : s.pointerItem === item)
      ) {
        click = true;
        if (item >= 0) s.menuIndex = item;
      }
      s.pointerItem = null;
    }
  }
  if (s.screen === "playing") {
    if (pressed.pause) {
      enter(s, "paused");
      return { s, held: null };
    }
    if (pressed.a && s.sonar.ready) {
      cast(s, "forager", s.forager, "cyan", null);
      s.sonar.cooldown = C.SONAR_COOLDOWN;
      api.audio.play(C.CUES.sonar);
    }
    if (pressed.b && s.ink.ready) {
      s.inkClouds.push({
        x: s.forager.x,
        y: s.forager.y,
        radius: C.INK_RADIUS,
        remaining: C.INK_LIFE,
      });
      s.ink.cooldown = C.INK_COOLDOWN;
      api.audio.play(C.CUES.ink);
    }
  } else if (s.screen === "paused" && (pressed.pause || pressed.back))
    enter(s, "playing");
  else if (s.screen === "howto" && (pressed.confirm || pressed.back || click))
    s = newDive(s, "title");
  else if (s.screen === "gameover" && pressed.back) s = newDive(s, "title");
  else if (items(s).length) {
    const n = items(s).length;
    if (pressed.up) s.menuIndex = ((s.menuIndex ?? 0) + n - 1) % n;
    if (pressed.down) s.menuIndex = ((s.menuIndex ?? 0) + 1) % n;
    if (pressed.confirm || click) s = confirm(s);
  }
  return { s, held: direction };
}
function valid(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}
function number(n: number, min = 0, max = Infinity, integer = false): void {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
    `Invalid number: ${n}`,
  );
}
function position(s: ReadState, x: number, y: number, den = false): void {
  number(x, 0, C.GRID_COLS - 1, true);
  number(y, 0, C.GRID_ROWS - 1, true);
  valid(open(s, x, y, den), "Tile is closed");
}
function pred(s: FathomState, i: number): Predator {
  number(i, 0, s.predators.length - 1, true);
  return s.predators[i];
}
function drift(s: FathomState, i: number): Drifter {
  number(i, 0, s.drifters.length - 1, true);
  return s.drifters[i];
}
function pose(s: ReadState, fn: (next: FathomState) => void): FathomState {
  const n = clone(s);
  fn(n);
  return reconcile(n);
}
const debug = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s: ReadState) =>
    fresh(s.art as Record<string, ImageBitmap[]>, s.muted),
  snapshot: (s: ReadState) => {
    const n = reconcile(s);
    return {
      version: n.version,
      screen: n.screen,
      menuIndex: n.menuIndex,
      titleIndex: n.titleIndex,
      depth: n.depth,
      score: n.score,
      lives: n.lives,
      muted: n.muted,
      planktonRemaining: n.planktonRemaining,
      drifterIn: n.drifterIn,
      brightness: n.brightness,
      brightHold: n.brightHold,
      visionRadius: n.visionRadius,
      windowRadius: n.windowRadius,
      sonar: n.sonar,
      ink: n.ink,
      grid: n.grid,
      tiles: n.tiles,
      plankton: n.plankton,
      visibility: n.visibility,
      forager: n.forager,
      drifters: n.drifters.map(({ x, y, tx, ty, lit, mind, travel }) => ({
        x,
        y,
        tx,
        ty,
        lit,
        mind,
        travel,
      })),
      predators: n.predators.map(
        ({
          kind,
          x,
          y,
          tx,
          ty,
          dir,
          state,
          released,
          mind,
          travel,
          speed,
          alert,
          lit,
          detectRange,
          hearingRange,
          hearingLock,
          flareCharging,
          flaring,
          flareRadius,
        }) => ({
          kind,
          x,
          y,
          tx,
          ty,
          dir,
          state,
          released,
          mind,
          travel,
          speed,
          alert,
          lit,
          detectRange,
          hearingRange,
          hearingLock,
          flareCharging,
          flaring,
          flareRadius,
        }),
      ),
      pulses: n.pulses.map(({ source, tint, ox, oy, front, range }) => ({
        source,
        tint,
        ox,
        oy,
        front,
        range,
      })),
      inkClouds: n.inkClouds,
      simTime: n.simTime,
    };
  },
  reconcile,
  setScreen: (s: ReadState, value: Screen) =>
    pose(s, (n) => {
      valid(
        [
          "title",
          "howto",
          "countdown",
          "playing",
          "paused",
          "cleared",
          "gameover",
        ].includes(value),
        "Invalid screen",
      );
      enter(n, value);
      if (value === "playing" && s.screen !== "paused") n.playTime = 0;
    }),
  setMenuIndex: (s: ReadState, index: number) =>
    pose(s, (n) => {
      number(index, 0, items(s).length - 1, true);
      n.menuIndex = index;
    }),
  setTitleIndex: (s: ReadState, index: number) =>
    pose(s, (n) => {
      number(index, 0, C.TITLE_ITEMS.length - 1, true);
      n.titleIndex = index;
    }),
  menuItemRect: rect,
  setScore: (s: ReadState, value: number) =>
    pose(s, (n) => {
      number(value, 0, Infinity, true);
      n.score = value;
    }),
  setLives: (s: ReadState, value: number) =>
    pose(s, (n) => {
      number(value, 0, Infinity, true);
      n.lives = value;
    }),
  setDepth: (s: ReadState, value: number) =>
    pose(s, (n) => {
      number(value, 1, Infinity, true);
      n.depth = value;
      n.predators = roster(value);
    }),
  setMaze: (s: ReadState, rows: readonly string[]) =>
    pose(s, (n) => {
      valid(
        rows.length === C.GRID_ROWS &&
          rows.every((r) => r.length === C.GRID_COLS && /^[#.gd]+$/.test(r)),
        "Invalid maze",
      );
      const all = rows.join("");
      valid(
        !/[gd]/.test(all) || all.split("g").length === 2,
        "Invalid gate count",
      );
      n.tiles = [...rows];
    }),
  setPlankton: (s: ReadState, x: number, y: number, present: boolean) =>
    pose(s, (n) => {
      position(s, x, y);
      put(n.plankton, x, y, present ? "*" : "-");
    }),
  clearPlankton: (s: ReadState) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s: ReadState) =>
    pose(s, (n) => {
      n.visibility = layer("u");
      n.marks = n.marks.map(() => 0);
    }),
  setForagerTile: (s: ReadState, x: number, y: number) =>
    pose(s, (n) => {
      position(s, x, y);
      Object.assign(n.forager, center(x, y), { moving: false });
    }),
  setForagerDir: (s: ReadState, d: Direction) =>
    pose(s, (n) => {
      valid(dirs.includes(d), "Invalid direction");
      n.forager.dir = d;
      n.desired = d;
      n.forager.moving = false;
    }),
  setBrightness: (s: ReadState, g: number) =>
    pose(s, (n) => {
      number(g, 0, 1);
      n.brightness = g;
    }),
  setBrightHold: (s: ReadState, t: number) =>
    pose(s, (n) => {
      number(t, 0, C.BRIGHT_HOLD);
      n.brightHold = t;
    }),
  clearPredators: (s: ReadState) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s: ReadState, kind: PredatorKind, x: number, y: number) =>
    pose(s, (n) => {
      valid(C.DEN_ORDER.includes(kind), "Invalid kind");
      position(s, x, y);
      n.predators.push(hunter(kind, x, y, null));
    }),
  setPredatorTile: (s: ReadState, i: number, x: number, y: number) =>
    pose(s, (n) => {
      position(s, x, y, true);
      Object.assign(pred(n, i), center(x, y));
    }),
  setPredatorDir: (s: ReadState, i: number, d: Direction) =>
    pose(s, (n) => {
      valid(dirs.includes(d), "Invalid direction");
      pred(n, i).dir = d;
    }),
  setPredatorState: (
    s: ReadState,
    i: number,
    value: "den" | "wander" | "chase",
  ) =>
    pose(s, (n) => {
      const p = pred(n, i);
      valid(
        ["den", "wander", "chase"].includes(value),
        "Invalid predator state",
      );
      valid(
        value === "den"
          ? ["d", "g"].includes(tile(s, p.tx, p.ty))
          : tile(s, p.tx, p.ty) === ".",
        "Invalid state on tile",
      );
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = value === "chase" ? C.LINGER_TIME : 0;
      p.alert = false;
      p.alertLeft = 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    }),
  setPredatorReleased: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      pred(n, i).released = v;
    }),
  setPredatorMind: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      pred(n, i).mind = v;
    }),
  setPredatorTravel: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      pred(n, i).travel = v;
    }),
  spawnDrifter: (s: ReadState, x: number, y: number) =>
    pose(s, (n) => {
      position(s, x, y);
      n.drifters.push({
        ...center(x, y),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
    }),
  clearDrifters: (s: ReadState) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      drift(n, i).mind = v;
    }),
  setDrifterTravel: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      drift(n, i).travel = v;
    }),
  setDrifterIn: (s: ReadState, t: number) =>
    pose(s, (n) => {
      number(t, 0, C.DRIFTER_INTERVAL);
      n.drifterIn = t;
    }),
  setSonarCooldown: (s: ReadState, t: number) =>
    pose(s, (n) => {
      number(t);
      n.sonar.cooldown = t;
    }),
  setInkCooldown: (s: ReadState, t: number) =>
    pose(s, (n) => {
      number(t);
      n.ink.cooldown = t;
    }),
};
export type FathomDebugApi = typeof debug;

function draw(s: ReadState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  ctx.imageSmoothingEnabled = false;
  const text = (
    value: string,
    x: number,
    y: number,
    size = 16,
    color = "#9cb7bf",
    align: CanvasTextAlign = "left",
  ) => {
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  const line = (x: number, y: number, w: number, color = "#15313b") => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 1);
  };
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const sprite = (
    name: string,
    frame: number,
    x: number,
    y: number,
    size = C.TILE,
  ) => {
    const image = s.art[name]?.[frame];
    if (image) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
  };
  const pair = (b: DeepReadonly<Body>, rate = 7) =>
    ({ down: 0, up: 2, left: 4, right: 6 })[b.dir] +
    (Math.floor(s.simTime * rate) % 2);
  const amber = (b: DeepReadonly<Body>) => {
    glow(b.x, b.y, 22, "#f276334a");
    ctx.fillStyle = "#ffa36e";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  };
  const terrain = () => {
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const v = s.visibility[y][x];
        if (v === "u") continue;
        const t = tile(s, x, y);
        const p = center(x, y);
        let frame = 16;
        if (t === "#") {
          frame = 0;
          for (const [d, bit] of [
            ["up", 1],
            ["right", 2],
            ["down", 4],
            ["left", 8],
          ] as const) {
            const [dx, dy] = vec[d];
            if (tile(s, x + dx, y + dy) === "#") frame += bit;
          }
        } else if (t === "g") frame = 18;
        ctx.globalAlpha = v === "r" ? 0.28 : 1;
        sprite("trench-walls", frame, p.x, p.y);
        if (s.plankton[y][x] === "*") {
          ctx.fillStyle = "#b3f8e6";
          ctx.shadowColor = "#66f8d9";
          ctx.shadowBlur = v === "r" ? 0 : 10;
          ctx.beginPath();
          ctx.arc(p.x, p.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    ctx.globalAlpha = 1;
  };
  const mazeView = ["countdown", "playing", "paused", "cleared"].includes(
    s.screen,
  );
  if (mazeView) {
    // The fog frame is a uniform opaque swatch; one draw covers the grid.
    const fog = s.art["trench-walls"]?.[17];
    if (fog)
      ctx.drawImage(
        fog,
        C.GRID_ORIGIN_X,
        C.GRID_ORIGIN_Y,
        C.GRID_COLS * C.TILE,
        C.GRID_ROWS * C.TILE,
      );
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      C.GRID_ORIGIN_X,
      C.GRID_ORIGIN_Y,
      C.GRID_COLS * C.TILE,
      C.GRID_ROWS * C.TILE,
    );
    ctx.clip();
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
    ctx.clip();
    terrain();
    glow(s.forager.x, s.forager.y, s.windowRadius, "#29d4cf0e");
    for (const d of s.drifters) {
      if (d.lit) sprite("drifter", Math.floor(s.simTime * 8) % 8, d.x, d.y);
      amber(d);
    }
    for (const p of s.predators)
      if (p.kind === "lanternjaw" && p.state !== "den") amber(p);
    ctx.restore();
    for (const p of s.predators)
      if (p.flaring) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
        ctx.clip();
        terrain();
        ctx.restore();
      }
    for (const cloud of s.inkClouds) {
      ctx.fillStyle = "#00040af0";
      ctx.beginPath();
      ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pulse of s.pulses) {
      const map = distances(s, pulse.ox, pulse.oy, true);
      const color =
        pulse.tint === "cyan"
          ? "#68ffed"
          : pulse.tint === "orange"
            ? "#ff9b53"
            : "#c692ff";
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++) {
          const d = map[y * C.GRID_COLS + x];
          const a = 1 - Math.abs(d - pulse.front) / 1.15;
          if (a > 0 && d <= pulse.range) {
            const p = center(x, y);
            ctx.globalAlpha = a * 0.8;
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 14;
            ctx.fillRect(p.x - 13, p.y - 13, 26, 26);
          }
        }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    for (const p of s.predators) {
      if (p.state === "den") continue;
      if (p.lit) {
        sprite(
          p.kind,
          p.kind === "lanternjaw" && p.state === "wander"
            ? 8 + (Math.floor(s.simTime * 8) % 8)
            : pair(p),
          p.x,
          p.y,
        );
      }
      if (p.alert) {
        const color = p.kind === "gloamfin" ? "#c8a0ff" : "#ffbe7c";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y,
          18 + (1 - p.alertLeft / C.ALERT_TIME) * 30,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        text("!", p.x, p.y - 25, 22, color, "center");
      }
      if (p.flareCharging || p.flaring || p.fade > 0) {
        const frame = p.flareCharging
          ? Math.min(
              2,
              Math.floor(
                ((C.FLARE_CHARGE + C.FLARE_BLOOM - p.flareTime) /
                  C.FLARE_CHARGE) *
                  3,
              ),
            )
          : p.flaring
            ? 3 + Math.min(2, Math.floor((1 - p.flareTime / C.FLARE_BLOOM) * 3))
            : p.fade > 0.2
              ? 6
              : 7;
        sprite("flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
      }
    }
    glow(s.forager.x, s.forager.y, 42, "#66fff543");
    sprite(
      "glimmerfin",
      { down: 0, up: 2, left: 4, right: 6 }[s.forager.dir] +
        (s.forager.moving ? Math.floor(s.simTime * 9) % 2 : 0),
      s.forager.x,
      s.forager.y,
    );
    ctx.restore();
    text("F A T H O M", 64, 35, 19, "#b5eee9");
    text(C.DIVE_LABEL, 64, 57, 11, "#587b89");
    text(String(s.score).padStart(6, "0"), 640, 59, 48, "#defbf4", "center");
    text(
      "PLANKTON  " + String(s.planktonRemaining).padStart(3, "0"),
      1216,
      40,
      14,
      "#7ba4af",
      "right",
    );
    text("P  PAUSE   /   M  SOUND", 1216, 61, 10, "#52717f", "right");
    line(64, 72, 1152);
    line(64, 663, 1152);
    text(`DEPTH ${String(s.depth).padStart(2, "0")}`, 64, 701, 18, "#c7e9e8");
    for (let i = 0; i < s.lives; i++)
      sprite("glimmerfin", 6, 242 + i * 27, 693, 24);
    const gauge = (
      x: number,
      label: string,
      cooldown: number,
      total: number,
    ) => {
      text(label, x, 690, 12, cooldown === 0 ? "#8deedc" : "#537581");
      ctx.fillStyle = "#14252f";
      ctx.fillRect(x, 700, 154, 3);
      ctx.fillStyle = cooldown === 0 ? "#75e8d1" : "#427b89";
      ctx.fillRect(x, 700, 154 * Math.max(0, 1 - cooldown / total), 3);
    };
    gauge(710, "SPACE  /  SONAR", s.sonar.cooldown, C.SONAR_COOLDOWN);
    gauge(925, "SHIFT  /  INK", s.ink.cooldown, C.INK_COOLDOWN);
    text("●", 1205, 701, 12, s.muted ? "#40545d" : "#7be7ce");
  }
  if (s.screen === "title" || s.screen === "gameover") {
    // A quiet bathymetric chart frames the title, with its own abstract current lines.
    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = `rgba(48,117,133,${0.08 + i * 0.012})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(640, 300, 260 + i * 46, 105 + i * 28, -0.18, 0, Math.PI * 2);
      ctx.stroke();
    }
    glow(640, 282, 260, "#0f69672a");
    for (let i = 0; i < 65; i++) {
      const x = (i * 193 + 71) % 1280,
        y = (i * 113 + 49) % 720;
      ctx.fillStyle = i % 4 === 0 ? "#32616b" : "#152b36";
      ctx.fillRect(x, y, 2, 2);
    }
    text(
      "A B Y S S A L   F I E L D   N O T E S     /     0 1",
      64,
      55,
      11,
      "#597885",
    );
    text("K I N D L E", 1216, 55, 11, "#597885", "right");
    sprite("glimmerfin", 6, 640, 182, 52);
    glow(640, 182, 65, "#50ead32c");
    if (s.screen === "title") {
      text(C.TITLE_TEXT, 640, 303, 112, "#d5fff3", "center");
      text(
        C.TAGLINE_TEXT.split("").join(" "),
        640,
        352,
        16,
        "#77c2c0",
        "center",
      );
    } else {
      text("DIVE ENDED", 640, 275, 54, "#d5fff3", "center");
      text(
        `SCORE ${s.score}    /    DEPTH ${s.depth}`,
        640,
        343,
        22,
        "#77c2c0",
        "center",
      );
    }
    line(64, 654, 1152);
    text("DEEP WATER. SMALL LIGHT. KEEP MOVING.", 64, 686, 11, "#668a96");
    text("↑ ↓  SELECT    ENTER  CONFIRM", 1216, 686, 11, "#668a96", "right");
  }
  if (s.screen === "howto") {
    text("FIELD GUIDE", 64, 70, 15, "#68b9b8");
    text("Learn to disappear.", 64, 131, 44, "#dcfff3");
    line(64, 166, 1152);
    const guide = [
      [
        "01   MOVE & GRAZE",
        "Arrow keys / WASD to swim. Eat every plankton mote to descend.",
        "Eating makes your light grow. A brighter meal brings sharper danger.",
      ],
      [
        "02   READ THE DARK",
        "Space sends sonar around corners. Revealed ground stays remembered.",
        "Your circular window grows as you eat; beyond it, the abyss closes in.",
      ],
      [
        "03   BREAK THE HUNT",
        "Shift releases ink. It blinds the hunters that see, but cannot stop sound.",
        "P / Escape pauses. M toggles sound. Save your light. Keep an escape route.",
      ],
    ];
    guide.forEach((g, i) => {
      const y = 219 + i * 131;
      text(g[0], 64, y, 18, "#7ee5d4");
      text(g[1], 64, y + 32, 14, "#adcad0");
      text(g[2], 64, y + 56, 13, "#668d9b");
    });
    const names = ["LANTERNJAW", "GLOAMFIN", "FLAREFISH"];
    const desc = [
      "Follows your light. An amber glimmer may be bait.",
      "Hears you through stone. Your sonar gives you away.",
      "A sudden bloom sees straight through the rock.",
    ];
    names.forEach((name, i) => {
      sprite(C.DEN_ORDER[i], 6, 890, 226 + i * 131, 48);
      text(name, 930, 219 + i * 131, 16, ["#f3ad76", "#b8a0f0", "#ffc59b"][i]);
      const words = desc[i].split(". ");
      words.forEach((v, j) =>
        text(v, 864, 258 + i * 131 + j * 21, 11, "#8dabb6"),
      );
    });
    line(64, 654, 1152);
    text(
      "ENTER / ESC / CLICK ANYWHERE TO RETURN",
      640,
      691,
      13,
      "#9de6db",
      "center",
    );
  }
  if (
    s.screen === "paused" ||
    s.screen === "cleared" ||
    s.screen === "countdown"
  ) {
    ctx.fillStyle = s.screen === "paused" ? "#03090fd9" : "#03090f88";
    ctx.fillRect(300, 220, 680, s.screen === "paused" ? 400 : 230);
    const title =
      s.screen === "paused"
        ? "SUSPENDED"
        : s.screen === "cleared"
          ? `DEPTH ${s.depth} CLEARED`
          : C.TITLE_ITEMS[0];
    text(
      title,
      640,
      s.screen === "paused" ? 325 : 306,
      44,
      "#d8fff3",
      "center",
    );
    text(
      s.screen === "paused"
        ? "THE DEEP CAN WAIT"
        : s.screen === "cleared"
          ? `+${C.SCORE_CLEAR}  /  DESCENDING`
          : `${Math.max(1, Math.ceil(2 - s.screenTime))}`,
      640,
      365,
      20,
      "#6ec7c0",
      "center",
    );
  }
  items(s).forEach((label, i) => {
    const r = rect(s, i)!;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#103638" : "#07141c";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#65d7c4" : "#18313c";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = "#87f2d8";
      ctx.fillRect(r.x, r.y, 3, r.h);
      text("›", r.x + 20, r.y + 30, 22, "#9dfce2");
    }
    text(label, 640, r.y + 29, 17, selected ? "#caffed" : "#6e98a6", "center");
  });
}
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    Object.values(C.CUES).forEach((cue, i) =>
      api.audio.define(cue, {
        wave: i % 2 ? "triangle" : "sine",
        freq: [740, 430, 100, 250, 160, 90, 520][i],
        freqTo: [980, 80, 40, 650, 900, 30, 1040][i],
        durationMs: [50, 350, 230, 260, 420, 500, 600][i],
        gain: 0.13,
      }),
    );
    const art: Record<string, ImageBitmap[]> = {};
    await Promise.all(
      [
        ["glimmerfin", 8],
        ["lanternjaw", 16],
        ["gloamfin", 8],
        ["flarefish", 8],
        ["drifter", 8],
        ["flare-bloom", 8],
        ["trench-walls", 19],
      ].map(async ([folder, count]) => {
        art[String(folder)] = await Promise.all(
          Array.from({ length: Number(count) }, (_, i) =>
            api.assets.loadImage(`${folder}/${i}.png`),
          ),
        );
      }),
    );
    for (const key of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(key, (s) => s[key]);
    api.diagnostics.register("sonar", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`predator ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "none";
      });
    return [fresh(art), debug];
  },
  update(state, api, dt) {
    const input = controls(clone(state), api);
    let s = input.s;
    s.accumulator += dt;
    while (s.accumulator + 1e-10 >= C.TICK_DT) {
      s.accumulator = Math.max(0, s.accumulator - C.TICK_DT);
      const events = new Set<string>();
      s = tick(s, input.held, events);
      for (const cue of events) api.audio.play(cue);
    }
    return reconcile(s);
  },
  render(s, api) {
    draw(s, api.ctx);
  },
};

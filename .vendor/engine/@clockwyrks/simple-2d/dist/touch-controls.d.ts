/**
 * The on-screen touch controls: what a touchscreen player is given for the
 * selected layout, and the engine's one place that draws chrome for input.
 *
 * A layout names a control scheme and the actions it drives, and a build on a
 * phone is playable only if something on the screen drives those actions. This
 * module draws that something. It is a DOM overlay rather than part of the
 * canvas, for three reasons that each rule the canvas out on their own:
 *
 * - The canvas is the game's own picture. The draw-command recorder and a
 *   captured frame hold what the build drew, and a set of buttons baked into it
 *   would misreport that.
 * - A contact on a control has to be told apart from a contact on the game, and
 *   the element that received the event is what tells them apart. On a canvas
 *   every contact is a contact on the game, and the engine would be hit-testing
 *   its own chrome against the pointer module's every event.
 * - The browser's own gesture handling is per element. A control declines the
 *   browser's touch gestures and text selection with two properties; a region of
 *   a canvas cannot.
 *
 * The controls drive the actions through the same seam a key does —
 * {@link ActionDriver.setAction}, which is `InputRegistry.setAction` — so the game
 * reads one number whichever source moved it: an analog action receives the
 * partial magnitude a slider gives, a digital one quantizes it, and each crossing
 * from rest arms the edge `pressed` reports exactly as a keypress would.
 *
 * **Appearance.** The controls are hidden at construction and shown by the first
 * `pointerdown` whose `pointerType` is `"touch"`. A `keydown`, or a `pointerdown`
 * or `pointermove` from a mouse or a pen, hides them again, and the next touch
 * shows them, so a device carrying both a touchscreen and a keyboard shows them
 * exactly while the screen is in use. Those listeners go on the same target the
 * key and pointer listeners use ({@link SurfaceMetrics.events}), so a caller that
 * dispatches events into a target of its own reaches them by the path a player
 * does. Only pointer and key events are read, never `mousedown` or `touchstart`:
 * a browser does not synthesize a `pointerdown` with `pointerType: "mouse"` from
 * a touch, so the compatibility mouse events cannot hide the controls by mistake.
 * The rule holds wherever the pointer lands: a mouse or a pen reaching a control
 * hides the controls rather than operating them, and a control acts on a touch
 * alone.
 *
 * **Isolation.** A contact on a control belongs to the control. Its `pointerdown`,
 * `pointermove`, `pointerup`, and `pointercancel` stop propagating at the control,
 * so they never reach the pointer module listening on the document, and the
 * control captures the pointer so a thumb that slides off keeps driving until it
 * lifts. The touch that first reveals the controls lands on the game, not on a
 * control, and reaches the pointer as any other. A control whose overlay is
 * hidden is not there: it ignores its pointer events, which go on to the target
 * as a touch on the game does, so a driver dispatching at a hidden control
 * drives nothing.
 *
 * **Driving is never cached.** A control drives its actions afresh on every
 * contact it reads and on every release, and hiding the controls releases every
 * control. The registry accepts a repeat harmlessly, and a memory of the last
 * value sent would go stale the moment a key or a caller moved the action in
 * between, leaving the control unable to drive it back.
 *
 * **No document, no controls.** An engine built over a surface whose event target
 * has no document behind it — the headless case — has nowhere to put an overlay.
 * The class is then inert: it draws nothing, listens to nothing, and reports
 * `null`, and the engine keeps working exactly as it did. Once detached, the
 * overlay is gone and the class reports `null` likewise.
 *
 * This module depends on the surface, the one method of the registry it drives,
 * the layout, and an emit function, and on nothing else in the engine. It is the
 * reference the other engines' controls are ported from, so what a control *is*
 * is kept in the pure functions at the bottom of the file, and what it *does to
 * the DOM* in the class above them.
 */
import type { EngineEventMap, SurfaceMetrics, TouchControlsState, TouchLayout } from "./contract";
/** The one thing the controls need of the action registry. */
export interface ActionDriver {
    /** Drive `name` to `value`, through the same resolution a key goes through. */
    setAction(name: string, value: number): void;
}
/** What the controls are built from. */
export interface TouchControlsOptions {
    /** The surface whose event target the visibility listeners go on. */
    surface: SurfaceMetrics;
    /** Where a control's value goes. */
    actions: ActionDriver;
    /** The selected layout, whose controls are drawn. */
    layout: TouchLayout;
    /** The engine's event broadcaster. */
    emit: <K extends keyof EngineEventMap>(event: K, payload: EngineEventMap[K]) => void;
}
/**
 * The attribute the container carries, valued with the layout's name, and the
 * prefix the control attributes share.
 *
 * The names carry no engine-specific prefix because the engine's own container
 * scopes them: a driver or a check finds the container first and the controls
 * inside it, so the names need only be unique within the overlay.
 */
export declare const CONTAINER_ATTRIBUTE = "data-touch-controls";
/** The attribute naming the action a control drives (the first, on a slider or a pad). */
export declare const ACTION_ATTRIBUTE = "data-action";
/** The attribute listing every action a slider or a pad drives, space-separated. */
export declare const ACTIONS_ATTRIBUTE = "data-actions";
/**
 * The fraction of a slider's or a pad's half-extent inside which a contact reads
 * as rest.
 *
 * A thumb that lands on a slider lands near its middle, and without a dead zone
 * the first contact would drive the action by whatever few pixels it missed the
 * centre by. Past the zone the deflection is rescaled to reach `1` at the edge,
 * so the zone costs no range.
 */
export declare const DEAD_ZONE = 0.15;
/**
 * The magnitudes one contact gives a control's actions, by action name.
 *
 * A slider gives one of its pair the deflection and the other `0`; a pad gives
 * the engaged directions their axis magnitudes; a button gives its action `1`.
 */
export type Contribution = Readonly<Record<string, number>>;
/** A control as it is described before it is built. */
type ControlSpec = {
    kind: "button";
    action: string;
    label: string;
    classes: string[];
} | {
    kind: "slider";
    positive: string;
    negative: string;
    classes: string[];
} | {
    kind: "pad";
    up: string;
    down: string;
    left: string;
    right: string;
    classes: string[];
};
/** Where the menu strip goes for a layout. */
type MenuPlacement = "centre" | "right";
export declare class TouchControls {
    #private;
    /**
     * Builds the overlay for `layout` in the document behind the surface's event
     * target, hidden, and attaches the visibility listeners to that target.
     *
     * Built at construction rather than at first touch so the elements a driver
     * finds by their markers exist from the moment the engine does, hidden or not,
     * and so the first touch has nothing to build and shows the controls at once.
     *
     * @throws for a layout with no drawing (see {@link layoutControls}), before
     * anything has been added to the document or listened to, so a refused build
     * leaves the page as it found it.
     */
    constructor(options: TouchControlsOptions);
    /**
     * The layout and whether its controls are showing, as a fresh copy, or `null`
     * when there was no document to draw them in or the overlay has been detached.
     */
    state(): TouchControlsState | null;
    /**
     * Releases every held control, removes the overlay and its stylesheet, and
     * detaches the visibility listeners. Idempotent, because teardown races.
     *
     * The controls are released before anything is removed, so an action a thumb
     * was holding when the engine went away is driven back to rest rather than
     * left reading held.
     */
    detach(): void;
}
/** A rect's extent along one axis, as `getBoundingClientRect` reports it. */
export interface Extent {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}
/** A client-space point. */
export interface Point {
    readonly x: number;
    readonly y: number;
}
/**
 * A contact's deflection in `[-1, 1]` along one axis of `rect`, positive toward
 * `start`, with the dead zone applied and the remaining travel rescaled to reach
 * `1` at the edge.
 *
 * `0` for a rect with no extent: an element that has not been laid out gives a
 * contact no place to be measured against, so it reads as rest rather than as a
 * division by zero.
 */
export declare function axisDeflection(contact: number, start: number, extent: number): number;
/**
 * A vertical slider's deflection: `1` at its top edge, `-1` at its bottom, `0`
 * across the dead zone about its middle.
 */
export declare function sliderDeflection(rect: Extent, contact: Point): number;
/**
 * What a pad gives its four directions for a contact: eight ways, each engaged
 * direction receiving the deflection along its own axis.
 *
 * The eight ways are the four axes and the four diagonals, each a 45° sector
 * about its heading, so a thumb pushed up-and-right engages `up` and `right`
 * together and one pushed almost straight up engages `up` alone. Inside the dead
 * zone nothing is engaged.
 */
export declare function padDirections(rect: Extent, contact: Point): {
    up: number;
    down: number;
    left: number;
    right: number;
};
/** What one contact on a control of `spec` gives each of the control's actions. */
export declare function contributionOf(spec: ControlSpec, rect: Extent, contact: Point): Contribution;
/**
 * The drawing for `layout`.
 *
 * @throws for a layout with no drawing, naming it: the catalogue and this table
 * must agree, and a layout that can be selected but not drawn is a build that
 * runs and shows a phone nothing.
 */
export declare function layoutControls(layout: TouchLayout): {
    menu: MenuPlacement;
    controls: ControlSpec[];
};
export {};
//# sourceMappingURL=touch-controls.d.ts.map
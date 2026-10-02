"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DOTS, DOT_COUNT } from "../lib/dots";

export type DotState = "idle" | "available" | "used" | "wrong";

interface Point {
  x: number;
  y: number;
}

const RING_CENTER: Point = { x: 50, y: 50 };
const RECEDE_TRANSITION = "x1 600ms ease, y1 600ms ease, x2 600ms ease, y2 600ms ease, opacity 600ms ease, filter 600ms ease, stroke-width 600ms ease";
const RECEDE_STOP_TRANSITION = "stop-color 600ms ease";

function transformDot(dot: Point, scale: number): Point {
  return {
    x: RING_CENTER.x + (dot.x - RING_CENTER.x) * scale,
    y: RING_CENTER.y + (dot.y - RING_CENTER.y) * scale,
  };
}

/**
 * A "generation" is one full pass through all 8 dots. The moment every one of the 8 has been used
 * at least once, that ring is considered complete and a fresh ring takes over as the active,
 * interactive one. This derives which generation every tap in `trail` belonged to purely from the
 * trail itself, plus which generation is currently active — no separate state to keep in sync.
 *
 * The dot that completes a ring (the 8th distinct one) does double duty: it's the LAST dot of the
 * ring that just finished, but it's ALSO already "spent" in the brand-new ring that starts right on
 * top of it — no separate re-tap of it required. So every ring after the first only takes 7 fresh
 * taps to complete, not 8, and the whole sequence of rings reads as one continuous chain rather than
 * 8-tap chunks with a seam between them. `usedInActiveRing` is exposed directly from here (rather
 * than reconstructed elsewhere) because it's the one place that knows about this carried-over
 * boundary dot.
 *
 * Two different generation numbers matter for that same boundary tap, for two different purposes:
 *  - `perTap` tags it with the OLD generation — it's still genuinely the closing tap of that ring.
 *  - `renderGen` tags it with the NEW generation instead — for POSITION/opacity purposes, this dot
 *    is one of the fixed, always-foreground buttons of the ring that's now active, not something
 *    that should recede toward the center along with the rest of the ring it just closed out. This
 *    is what makes the last mesh line of a just-completed ring visually run from the receding
 *    background out to a dot that's still sitting right where it always was in the foreground —
 *    a single continuous, seamless line rather than two disconnected pieces.
 */
export function computeGenerations(trail: number[]) {
  const perTap: number[] = [];
  const renderGen: number[] = [];
  let currentGen = 0;
  let usedInGen = new Set<number>();
  for (const dotId of trail) {
    perTap.push(currentGen);
    usedInGen.add(dotId);
    if (usedInGen.size === DOT_COUNT) {
      renderGen.push(currentGen + 1); // boundary dot renders as part of the ring it also opens
      currentGen += 1;
      usedInGen = new Set([dotId]); // the boundary dot carries over as already-used in the new ring
    } else {
      renderGen.push(currentGen);
    }
  }
  return { perTap, renderGen, activeGeneration: currentGen, usedInActiveRing: usedInGen };
}

/**
 * Completed rings' MESH sits equidistantly between the active ring and the shared center — not a
 * shrinking-by-half series. With N completed rings, they divide that span into N+1 equal steps:
 * the oldest sits closest to center (1 step out of N+1), the most recently completed sits closest
 * to the active ring (N steps out of N+1). Every time a new ring completes, N grows and EVERY
 * existing background mesh's position recomputes to keep them equidistant — which is what pushes
 * older ones further inward. Scale doubles as this position: the mesh literally sits at that
 * fraction of the way from center to the active ring's own scale (1).
 */
function meshScale(genIndex: number, activeGeneration: number): number {
  if (genIndex === activeGeneration) return 1;
  return (genIndex + 1) / (activeGeneration + 1);
}

/** Every mesh line — active ring or long-receded into the background — renders at this same
 *  opacity, with no blur either. Depth is conveyed purely by scale (smaller, nearer the center);
 *  the color itself stays completely constant and sharp at every depth, so the whole accumulated
 *  history keeps reading as one intact, continuously rainbow-colored trace rather than fading or
 *  washing out the further back it sits. */
const MESH_OPACITY = 0.95;

// The whole game, first dot ever tapped to the latest one — across however many rings have come
// and gone — is one continuous red -> violet spectrum. A ring completing and receding doesn't
// reset it; the spectrum just keeps stretching to reach whatever the latest tap is.
const HUE_RED = 0;
const HUE_VIOLET = 275;

function hueAt(fraction: number) {
  return HUE_RED + (HUE_VIOLET - HUE_RED) * fraction;
}

function spectrumColor(hue: number) {
  return `hsl(${hue}, 75%, 55%)`;
}

// A gradient with only a start and end stop interpolates in RGB space, not around the hue wheel —
// a straight red-to-violet 2-stop gradient cuts directly through RGB and skips right past the
// orange/yellow/green/blue/indigo bands instead of sweeping through them. Sampling several
// in-between hues as explicit stops forces the gradient to actually pass through every band. Hue
// is all a stop carries now — opacity for a whole line is applied once, on the line itself (see
// the render loop below), rather than baked into every stop, since a single value transitions
// reliably across browsers in a way that animating 21 separate stop-opacities in lockstep does not.
const GRADIENT_SAMPLES = 20;

function hueStops(hueStart: number, hueEnd: number) {
  return Array.from({ length: GRADIENT_SAMPLES + 1 }, (_, i) => {
    const t = i / GRADIENT_SAMPLES;
    return { offset: `${t * 100}%`, color: spectrumColor(hueStart + (hueEnd - hueStart) * t) };
  });
}

interface DotRingProps {
  getDotState: (id: number) => DotState;
  onDotClick?: (id: number) => void;
  interactive?: boolean;
  /** Ordered dot ids tapped so far, across however many completed rings. Only the newest hop animates. */
  trail?: number[];
  wrongEdge?: { from: number; to: number } | null;
  center?: ReactNode;
}

export default function DotRing({
  getDotState,
  onDotClick,
  interactive = false,
  trail = [],
  wrongEdge = null,
  center,
}: DotRingProps) {
  // A dot already used THIS ring can't be tapped again — a connection can only ever form between
  // two not-yet-used dots. Once the ring completes and a fresh one starts, all 8 are open again —
  // except the boundary dot that just completed the old ring, which is already "spent" here too
  // (see computeGenerations).
  const { renderGen, activeGeneration, usedInActiveRing } = computeGenerations(trail);
  const totalHops = Math.max(trail.length - 1, 0);

  // Rings are colored to match the mesh line that passes through them — the hue of whichever tap
  // most recently used that physical dot (its latest occurrence anywhere in the trail, including
  // across earlier, now-receded rings).
  const lastTapIndex = new Map<number, number>();
  trail.forEach((dotId, idx) => lastTapIndex.set(dotId, idx));

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]">
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="rr-arrow-wrong" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-red-500" />
          </marker>
        </defs>

        {/* The rainbow mesh: one line per hop, spanning the WHOLE game so far as a single continuous
            spectrum — a completed ring receding doesn't restart it. Only the MESH recedes when a
            ring completes; the dots that formed it aren't drawn again in the background at all (see
            the active-ring-only dot rendering below) — completed rings live on purely as this
            shrinking, equidistantly-spaced trace. A stable key per hop means the CSS transition
            above actually animates the recession rather than snapping, and re-triggers every time a
            new ring's completion shifts everyone else's equidistant position inward. Drawn first, so
            every dot (below) always paints on top of every line, foreground ring included. */}
        {trail.slice(0, -1).map((fromId, i) => {
          const toId = trail[i + 1];
          const genFrom = renderGen[i];
          const genTo = renderGen[i + 1];
          const scaleFrom = meshScale(genFrom, activeGeneration);
          const scaleTo = meshScale(genTo, activeGeneration);
          const avgScale = (scaleFrom + scaleTo) / 2;
          const pFrom = transformDot(DOTS[fromId], scaleFrom);
          const pTo = transformDot(DOTS[toId], scaleTo);
          const hueStart = hueAt(i / totalHops);
          const hueEnd = hueAt((i + 1) / totalHops);
          const gradId = `rr-mesh-${i}-${fromId}-${toId}`;
          return (
            <g key={gradId}>
              <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={pFrom.x} y1={pFrom.y} x2={pTo.x} y2={pTo.y}>
                {hueStops(hueStart, hueEnd).map((s, idx) => (
                  <stop key={idx} offset={s.offset} stopColor={s.color} style={{ transition: RECEDE_STOP_TRANSITION }} />
                ))}
              </linearGradient>
              <line
                x1={pFrom.x}
                y1={pFrom.y}
                x2={pTo.x}
                y2={pTo.y}
                stroke={`url(#${gradId})`}
                strokeWidth={0.16 * avgScale}
                strokeLinecap="round"
                style={{
                  opacity: MESH_OPACITY,
                  transition: RECEDE_TRANSITION,
                }}
              />
            </g>
          );
        })}

        {/* The hop that was just tapped: draws from the previous dot to the new one, then erases
            the same way. Uses each end's own current mesh transform, same as above, so it lines up
            exactly with the persistent line it's drawn on top of. Still drawn before the dots below,
            so the animated hop never paints over a dot either. */}
        {trail.length > 1 &&
          (() => {
            const i = trail.length - 2;
            const pFrom = transformDot(DOTS[trail[i]], meshScale(renderGen[i], activeGeneration));
            const pTo = transformDot(DOTS[trail[i + 1]], meshScale(renderGen[i + 1], activeGeneration));
            return (
              <AnimatedLine
                key={`${trail[i]}-${trail[i + 1]}-${trail.length}`}
                from={pFrom}
                to={pTo}
                hueStart={hueAt(i / totalHops)}
                hueEnd={hueAt((i + 1) / totalHops)}
              />
            );
          })()}

        {/* A failed tap stays drawn permanently (game-over state), no erase. Always within the
            currently-active ring, so no transform needed beyond the raw dot positions. */}
        {wrongEdge && <AnimatedLine key="wrong" from={DOTS[wrongEdge.from]} to={DOTS[wrongEdge.to]} wrong persist />}

        {/* Only the ACTIVE ring's dots are ever drawn — a completed ring's dots don't recede into
            the background at all, only its mesh does (above). Drawn last so they always sit on top
            of every line. Open rings, not filled disks: a dot still available to tap is a solid
            black (or white, in dark mode) ring — an unambiguous "you can click here." A dot already
            used this ring takes on the hue of the tap that used it (matching the mesh line passing
            through it) and fades to show it's locked; the button below is disabled to match. Once
            the ring completes and recedes, every dot is available again and turns back to black. */}
        {DOTS.map((dot) => {
          const state = getDotState(dot.id);
          const isWrong = state === "wrong";
          const isUsed = usedInActiveRing.has(dot.id);
          const r = state === "idle" ? 1.6 : 2;
          let stroke: string;
          let opacity: number;
          if (isWrong) {
            stroke = "#dc2626"; // red-600
            opacity = 1;
          } else if (isUsed) {
            const idx = lastTapIndex.get(dot.id) ?? 0;
            stroke = spectrumColor(hueAt(totalHops > 0 ? idx / totalHops : 0));
            opacity = 0.45; // faded: locked, not clickable right now
          } else {
            stroke = "currentColor"; // driven by colorClass below (black/white, or idle gray)
            opacity = 1;
          }
          const colorClass =
            !isWrong && !isUsed
              ? state === "idle"
                ? "text-neutral-400"
                : "text-neutral-900 dark:text-white"
              : "";
          return (
            <circle
              key={dot.id}
              cx={dot.x}
              cy={dot.y}
              r={r}
              fill="none"
              stroke={stroke}
              strokeWidth={0.9}
              style={{ opacity }}
              className={`${colorClass} transition-opacity duration-200`}
            />
          );
        })}
      </svg>

      {DOTS.map((dot) => (
        <button
          key={dot.id}
          type="button"
          disabled={!interactive || usedInActiveRing.has(dot.id)}
          onClick={() => onDotClick?.(dot.id)}
          aria-label={`Dot ${dot.id + 1}`}
          style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
          className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 touch-manipulation rounded-full sm:h-[72px] sm:w-[72px]"
        />
      ))}

      {center && <div className="absolute inset-0 flex items-center justify-center px-6">{center}</div>}
    </div>
  );
}

const DRAW_MS = 110;
const HOLD_MS = 40;
const ERASE_MS = 160;

/**
 * Animates a directional hop from `from` to `to`:
 *  - draw phase: the tip grows from `from` toward `to` (0 -> 1)
 *  - erase phase: the tail retracts from `from` toward `to` (1 -> 2), same direction, so it
 *    visually "chases" itself off the board and disappears exactly at `to`.
 * Pass `persist` to stop after the draw phase and stay fully drawn (used for the game-over hop).
 */
function AnimatedLine({
  from,
  to,
  wrong = false,
  persist = false,
  hueStart,
  hueEnd,
}: {
  from: Point;
  to: Point;
  wrong?: boolean;
  persist?: boolean;
  /** When provided (and not `wrong`), stroked with the real rainbow gradient for this hop instead
   *  of a flat color — using `from`/`to` as FIXED gradient coordinates (not the currently animating
   *  x1/y1/x2/y2 below) means whatever partial segment is drawn mid-animation still samples the
   *  correct slice of that fixed-in-space gradient, so it never disagrees with the persistent line
   *  it's drawn on top of. */
  hueStart?: number;
  hueEnd?: number;
}) {
  const [progress, setProgress] = useState(0); // 0 = not started, 1 = fully drawn, 2 = fully erased

  useEffect(() => {
    let raf: number;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;

      if (elapsed < DRAW_MS) {
        setProgress(elapsed / DRAW_MS);
        raf = requestAnimationFrame(tick);
        return;
      }

      if (persist || wrong) {
        setProgress(1);
        return;
      }

      const afterHold = elapsed - DRAW_MS - HOLD_MS;
      if (afterHold < 0) {
        setProgress(1);
        raf = requestAnimationFrame(tick);
        return;
      }

      if (afterHold < ERASE_MS) {
        setProgress(1 + afterHold / ERASE_MS);
        raf = requestAnimationFrame(tick);
        return;
      }

      setProgress(2);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Runs once per mount — the parent always gives this component a fresh `key` for each new hop,
    // so a remount (not a dependency change) is what restarts the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (progress >= 2) return null;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  let x1 = from.x;
  let y1 = from.y;
  let x2: number;
  let y2: number;

  if (progress <= 1) {
    x2 = lerp(from.x, to.x, progress);
    y2 = lerp(from.y, to.y, progress);
  } else {
    const e = progress - 1;
    x1 = lerp(from.x, to.x, e);
    y1 = lerp(from.y, to.y, e);
    x2 = to.x;
    y2 = to.y;
  }

  const gradId = !wrong && hueStart !== undefined && hueEnd !== undefined ? "rr-anim-grad" : null;

  return (
    <>
      {gradId && (
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
          {hueStops(hueStart!, hueEnd!).map((s, idx) => (
            <stop key={idx} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
      )}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        strokeWidth={0.45}
        strokeLinecap="round"
        markerEnd={wrong ? "url(#rr-arrow-wrong)" : undefined}
        stroke={gradId ? `url(#${gradId})` : undefined}
        className={wrong ? "stroke-red-500" : gradId ? undefined : "stroke-black dark:stroke-white"}
      />
    </>
  );
}
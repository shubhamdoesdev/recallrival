"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DOTS, type DotSpec } from "../lib/dots";

export type DotState = "idle" | "available" | "used" | "wrong";

interface DotRingProps {
  getDotState: (id: number) => DotState;
  onDotClick?: (id: number) => void;
  interactive?: boolean;
  /** Ordered dot ids visited so far this turn. Only the newest hop animates. */
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
  const last = trail.length > 1 ? { from: trail[trail.length - 2], to: trail[trail.length - 1] } : null;

  // Track which dot should replay its tap-ripple: whenever a new dot lands
  // at the end of the trail, bump a nonce so that dot (and only that dot)
  // re-triggers its ripple animation.
  const [pulse, setPulse] = useState<{ dotId: number; nonce: number } | null>(null);
  const seenLast = useRef<number | null>(null);
  const nonce = useRef(0);

  useEffect(() => {
    const newest = trail.length > 0 ? trail[trail.length - 1] : null;
    if (newest !== null && newest !== seenLast.current) {
      nonce.current += 1;
      setPulse({ dotId: newest, nonce: nonce.current });
    }
    seenLast.current = newest;
  }, [trail]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]">
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="rr-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-black dark:fill-white" />
          </marker>
          <marker id="rr-arrow-wrong" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-red-500" />
          </marker>
        </defs>

        {/* The hop that was just tapped: draws from the previous dot to the new one, then erases the same way. */}
        {last && (
          <AnimatedLine
            key={`${last.from}-${last.to}-${trail.length}`}
            from={DOTS[last.from]}
            to={DOTS[last.to]}
          />
        )}

        {/* A failed tap stays drawn permanently (game-over state), no erase. */}
        {wrongEdge && (
          <AnimatedLine key="wrong" from={DOTS[wrongEdge.from]} to={DOTS[wrongEdge.to]} wrong persist />
        )}
      </svg>

      {DOTS.map((dot) => (
        <button
          key={dot.id}
          type="button"
          disabled={!interactive}
          onClick={() => onDotClick?.(dot.id)}
          aria-label={`Dot ${dot.id + 1}`}
          style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
          className="absolute grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 touch-manipulation place-items-center rounded-full sm:h-[72px] sm:w-[72px]"
        >
          <DotVisual state={getDotState(dot.id)} ripple={dot.id === pulse?.dotId ? pulse?.nonce : undefined} />
        </button>
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
}: {
  from: DotSpec;
  to: DotSpec;
  wrong?: boolean;
  persist?: boolean;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.id, to.id, persist, wrong]);

  if (progress >= 2) return null;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  let x1 = from.x;
  let y1 = from.y;
  let x2: number;
  let y2: number;

  if (progress <= 1) {
    // Draw phase: tip travels from `from` to `to`.
    x2 = lerp(from.x, to.x, progress);
    y2 = lerp(from.y, to.y, progress);
  } else {
    // Erase phase: tail travels from `from` to `to`, tip stays put at `to`.
    const e = progress - 1;
    x1 = lerp(from.x, to.x, e);
    y1 = lerp(from.y, to.y, e);
    x2 = to.x;
    y2 = to.y;
  }

  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      strokeWidth={0.6}
      strokeLinecap="round"
      markerEnd={progress > 0.05 ? (wrong ? "url(#rr-arrow-wrong)" : "url(#rr-arrow)") : undefined}
      className={wrong ? "stroke-red-500" : "stroke-black dark:stroke-white"}
    />
  );
}

const RIPPLE_GROW_MS = 150;
const RIPPLE_SHRINK_MS = 280;

/**
 * The tap feedback: a soft grey circle grows around the dot the instant it's
 * tapped, then shrinks back down to nothing shortly after — a ripple, not a
 * permanent marker. The dot itself always returns to its normal look.
 */
function DotVisual({ state, ripple }: { state: DotState; ripple?: number }) {
  const [phase, setPhase] = useState<"idle" | "grow" | "shrink">("idle");
  const seenRipple = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (ripple !== undefined && ripple !== seenRipple.current) {
      seenRipple.current = ripple;
      setPhase("grow");
      const shrinkTimer = setTimeout(() => setPhase("shrink"), RIPPLE_GROW_MS);
      const idleTimer = setTimeout(() => setPhase("idle"), RIPPLE_GROW_MS + RIPPLE_SHRINK_MS);
      return () => {
        clearTimeout(shrinkTimer);
        clearTimeout(idleTimer);
      };
    }
  }, [ripple]);

  const isWrong = state === "wrong";

  const rippleClasses =
    phase === "grow"
      ? "scale-100 opacity-40 duration-150 ease-out"
      : phase === "shrink"
      ? "scale-0 opacity-0 duration-300 ease-in"
      : "scale-0 opacity-0 duration-0";

  // "used" and "available" look identical once the tap ripple finishes — the
  // dot just returns to its normal state, no permanent marker is left behind.
  const dot =
    state === "idle"
      ? "h-3 w-3 bg-neutral-400"
      : isWrong
      ? "h-3.5 w-3.5 bg-red-600"
      : "h-3.5 w-3.5 bg-neutral-900 dark:bg-white";

  return (
    <span className="relative grid h-11 w-11 place-items-center">
      <span
        className={`absolute h-11 w-11 rounded-full bg-neutral-300 transition-all dark:bg-neutral-600 ${
          isWrong ? "scale-100 bg-red-200 opacity-100 dark:bg-red-950" : rippleClasses
        }`}
      />
      <span className={`relative rounded-full transition-all duration-200 ${dot}`} />
    </span>
  );
}
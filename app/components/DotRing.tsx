"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DOTS, DOT_COUNT, type DotSpec } from "../lib/dots";

export type DotState = "idle" | "available" | "used" | "wrong";

const MESH_MIN_OPACITY = 0.03;
const MESH_MAX_OPACITY = 0.16;
// Ramps from faint to max across one full pass of the board, then holds at max.
const MESH_STEP = (MESH_MAX_OPACITY - MESH_MIN_OPACITY) / (DOT_COUNT - 1);

function meshOpacityAt(hopIndex: number) {
  return Math.min(MESH_MIN_OPACITY + MESH_STEP * hopIndex, MESH_MAX_OPACITY);
}

// --- Pillar mode -----------------------------------------------------------
// Each dot is a pillar. The first rope-end that ever attaches to a pillar
// lands at its base (level 1). Every later attachment to that SAME pillar
// stacks one level higher. Height grows fast at first, then tapers off and
// approaches a hard ceiling asymptotically — so a pillar tapped 30 times still
// can't physically grow past the container. Past 8 levels it also fades out,
// so an extremely over-used pillar reads as "topped out and receding," not
// "broken/still growing but invisible."
const PILLAR_MAX_HEIGHT = 9; // viewBox units (viewBox is 0-100)
const PILLAR_DECAY_TAU = 3.2;
const PILLAR_LEAN_X = 0.32; // small horizontal nudge so pillars read as tilted, not vertical sticks
const PILLAR_FADE_START_LEVEL = 8;
const PILLAR_FADE_DECAY = 0.75;

function pillarHeight(level: number) {
  return PILLAR_MAX_HEIGHT * (1 - Math.exp(-(level - 1) / PILLAR_DECAY_TAU));
}

function pillarLevelFade(level: number) {
  if (level <= PILLAR_FADE_START_LEVEL) return 1;
  return Math.pow(PILLAR_FADE_DECAY, level - PILLAR_FADE_START_LEVEL);
}

function projectPillar(dot: DotSpec, level: number) {
  const h = pillarHeight(level);
  return { x: dot.x + h * PILLAR_LEAN_X, y: dot.y - h };
}

/** For each trail index, which visit-to-that-dot this is (1st, 2nd, 3rd...). */
function visitRanks(trail: number[]): number[] {
  const seen = new Map<number, number>();
  return trail.map((id) => {
    const next = (seen.get(id) ?? 0) + 1;
    seen.set(id, next);
    return next;
  });
}

interface DotRingProps {
  getDotState: (id: number) => DotState;
  onDotClick?: (id: number) => void;
  interactive?: boolean;
  /** Ordered dot ids visited so far this turn. Only the newest hop animates. */
  trail?: number[];
  wrongEdge?: { from: number; to: number } | null;
  center?: ReactNode;
  /** Experimental: render the persistent trail as 3D-ish pillars instead of flat lines. */
  pillars?: boolean;
}

export default function DotRing({
  getDotState,
  onDotClick,
  interactive = false,
  trail = [],
  wrongEdge = null,
  center,
  pillars = false,
}: DotRingProps) {
  const last = trail.length > 1 ? { from: trail[trail.length - 2], to: trail[trail.length - 1] } : null;
  const ranks = pillars ? visitRanks(trail) : null;

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

        {pillars && ranks ? (
          <>
            {/* Pillars: a faint pole at every dot that's been touched, rising from its base up to
                the height its tallest current visit level reaches. Background structure — drawn
                before the ropes so the ropes read as sitting on top of/among the pillars. */}
            {Array.from(new Set(trail)).map((dotId) => {
              const lastIdx = trail.lastIndexOf(dotId);
              const level = ranks[lastIdx];
              const base = DOTS[dotId];
              const top = projectPillar(base, level);
              const opacity = MESH_MAX_OPACITY * 1.3 * pillarLevelFade(level);
              return (
                <line
                  key={`pillar-${dotId}`}
                  x1={base.x}
                  y1={base.y}
                  x2={top.x}
                  y2={top.y}
                  strokeWidth={0.3}
                  strokeLinecap="round"
                  style={{ opacity }}
                  className="stroke-black dark:stroke-white"
                />
              );
            })}

            {/* Ropes: same recency gradient as flat mode, but strung between each hop's PROJECTED
                (elevated) endpoints instead of the dots' base positions, and additionally faded by
                how tall/over-used each end's pillar currently is. */}
            {trail.slice(0, -1).map((fromId, i) => {
              const toId = trail[i + 1];
              if (fromId === toId) return null;
              const fromLevel = ranks[i];
              const toLevel = ranks[i + 1];
              const from = projectPillar(DOTS[fromId], fromLevel);
              const to = projectPillar(DOTS[toId], toLevel);
              const startOpacity = meshOpacityAt(i) * pillarLevelFade(fromLevel);
              const endOpacity = meshOpacityAt(i + 1) * pillarLevelFade(toLevel);
              const gradId = `rr-pillar-rope-${i}-${fromId}-${toId}`;
              return (
                <g key={gradId} className="text-black dark:text-white">
                  <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
                    <stop offset="0%" stopColor="currentColor" stopOpacity={startOpacity} />
                    <stop offset="100%" stopColor="currentColor" stopOpacity={endOpacity} />
                  </linearGradient>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={`url(#${gradId})`}
                    strokeWidth={0.35}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
          </>
        ) : (
          /* Flat mode: every hop tapped so far THIS turn, oldest to newest. Each hop is drawn
             with its own gradient — faint at the dot it came from, brighter at the dot it landed
             on — and each segment's brightness is fixed at the moment it's first drawn (based on
             how far into the turn it happened), so earlier hops never retroactively dim. Because
             consecutive hops share the same value where they meet, the whole path reads as one
             continuous ramp from where the turn started to wherever the player currently is.
             Revisiting a connection later just paints a brighter segment on top of the earlier,
             fainter one already there — normal alpha stacking does the "overlap gets more
             intense" effect for free. Kept very faint overall; it's texture, not a readable hint.
             Driven entirely by `trail`, so it goes blank the instant a screen clears `trail` at
             the start of the next player's turn. */
          trail.slice(0, -1).map((fromId, i) => {
            const toId = trail[i + 1];
            if (fromId === toId) return null;
            const from = DOTS[fromId];
            const to = DOTS[toId];
            const startOpacity = meshOpacityAt(i);
            const endOpacity = meshOpacityAt(i + 1);
            const gradId = `rr-trail-${i}-${fromId}-${toId}`;
            return (
              <g key={gradId} className="text-black dark:text-white">
                <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
                  <stop offset="0%" stopColor="currentColor" stopOpacity={startOpacity} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={endOpacity} />
                </linearGradient>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={`url(#${gradId})`}
                  strokeWidth={0.35}
                  strokeLinecap="round"
                />
              </g>
            );
          })
        )}

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

      {DOTS.map((dot) => {
        const isLastTapped = trail.length > 0 && dot.id === trail[trail.length - 1];
        return (
          <button
            key={dot.id}
            type="button"
            disabled={!interactive || isLastTapped}
            onClick={() => onDotClick?.(dot.id)}
            aria-label={`Dot ${dot.id + 1}`}
            style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
            className="absolute grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 touch-manipulation place-items-center rounded-full sm:h-[72px] sm:w-[72px]"
          >
            <DotVisual
              state={getDotState(dot.id)}
              ripple={dot.id === pulse?.dotId ? pulse?.nonce : undefined}
              faint={isLastTapped}
            />
          </button>
        );
      })}

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
function DotVisual({ state, ripple, faint = false }: { state: DotState; ripple?: number; faint?: boolean }) {
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
      <span
        className={`relative rounded-full transition-opacity duration-200 ${dot} ${
          faint && !isWrong ? "opacity-40" : "opacity-100"
        }`}
      />
    </span>
  );
}
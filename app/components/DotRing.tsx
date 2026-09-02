"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DOTS } from "../lib/dots";
import { buildOctagons, pointOnSide, octagonPoints, type OctagonNode } from "../lib/octagon";

export type DotState = "idle" | "available" | "used" | "wrong";

// Every dot is an actual octagon. Each of its 7 usable sides is permanently
// dedicated to one specific other octagon (see lib/octagon.ts) — the 8th
// side always faces outward and is never used. When A and B connect, the
// line runs between the midpoint of A's B-side and B's A-side, not center to
// center. Retracing that exact connection again doesn't overlap the old
// line: instead every retracing gets its own line, offset sideways from the
// original by the SAME vector at both ends — which is what guarantees they
// stay strictly parallel and never cross, no matter how many pile up. That
// offset direction is chosen to point away from the ring's center, and
// later retracings get pushed further in that direction, so age reads
// spatially too: the newest line in a bundle sits furthest outward, the
// oldest sits closest to the ring's center. Color (see below) is the other,
// primary cue for age — the two aren't required to agree, they're two
// independent signals: position answers "how worn is this connection,"
// color answers "how far into the whole path are we."
const OCTAGON_RADIUS = 3.4; // viewBox units (viewBox is 0-100)
const OCTAGON_SIDE_LENGTH = 2 * OCTAGON_RADIUS * Math.sin(Math.PI / 8);
// The whole trail, first dot to latest, is one continuous red -> violet spectrum. It's not that
// each line gets its own mini-rainbow — it's that however many lines currently exist DIVIDE that
// one spectrum between them. So with 1 hop, that single line spans red all the way to violet; add
// a 2nd hop and the two lines together still span exactly red to violet, each now covering half;
// add a 3rd and each covers a third, and so on. This means every previous line's hue RANGE gets
// renormalized (compressed) each time a new hop is added, which is intentional — it's what keeps
// the endpoint always mathematically violet no matter how long the path gets, and what makes
// "which line is newest" instantly readable by color rather than position. Consecutive hops still
// share the exact same hue where they meet, so it reads as one seamless spectrum, never a jump.
const HUE_RED = 0;
const HUE_VIOLET = 275;

function hueAt(fraction: number) {
  return HUE_RED + (HUE_VIOLET - HUE_RED) * fraction;
}

function spectrumColor(hue: number) {
  return `hsl(${hue}, 75%, 55%)`;
}
const RING_CENTER = { x: 50, y: 50 };

interface Point {
  x: number;
  y: number;
}

interface EdgeGeometry {
  baseA: Point;
  baseB: Point;
  /** Unit vector, shared by both ends, pointing away from the ring's center. */
  perp: Point;
}

/** The single shared line (and offset axis) a connection's parallel bundle is built from. */
function computeEdgeGeometry(octA: OctagonNode, octB: OctagonNode): EdgeGeometry {
  const sideOnA = octA.neighborSide.get(octB.id)!;
  const sideOnB = octB.neighborSide.get(octA.id)!;
  const baseA = pointOnSide(octA, sideOnA, 0.5);
  const baseB = pointOnSide(octB, sideOnB, 0.5);

  const dx = baseB.x - baseA.x;
  const dy = baseB.y - baseA.y;
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len;
  let py = dx / len;

  const midX = (baseA.x + baseB.x) / 2;
  const midY = (baseA.y + baseB.y) / 2;
  const outX = midX - RING_CENTER.x;
  const outY = midY - RING_CENTER.y;
  if (px * outX + py * outY < 0) {
    px = -px;
    py = -py;
  }

  return { baseA, baseB, perp: { x: px, y: py } };
}

/** Occurrence 0 is oldest/innermost, occurrence (total-1) is newest/outermost. */
function slotPoints(geo: EdgeGeometry, occurrenceIndex: number, total: number) {
  const offset = OCTAGON_SIDE_LENGTH * ((occurrenceIndex + 0.5) / total - 0.5);
  return {
    a: { x: geo.baseA.x + geo.perp.x * offset, y: geo.baseA.y + geo.perp.y * offset },
    b: { x: geo.baseB.x + geo.perp.x * offset, y: geo.baseB.y + geo.perp.y * offset },
  };
}

interface EdgeOccurrence {
  key: string;
  a: number;
  b: number;
  /** Actual tap direction for this hop (may be b->a even though a<b for the key). */
  from: number;
  to: number;
  /** True position of this hop within the whole trail — drives the continuous brightness ramp. */
  hopIndex: number;
  /** Position among retracings of this SAME connection — drives spatial slot offset only. */
  occurrenceIndex: number;
  total: number;
}

function groupEdgeOccurrences(trail: number[]): EdgeOccurrence[] {
  const raw: { key: string; a: number; b: number; from: number; to: number; hopIndex: number }[] = [];
  for (let i = 0; i < trail.length - 1; i++) {
    const from = trail[i];
    const to = trail[i + 1];
    if (from === to) continue;
    const key = from < to ? `${from}-${to}` : `${to}-${from}`;
    raw.push({ key, a: Math.min(from, to), b: Math.max(from, to), from, to, hopIndex: i });
  }
  const totals = new Map<string, number>();
  raw.forEach((e) => totals.set(e.key, (totals.get(e.key) ?? 0) + 1));
  const seenSoFar = new Map<string, number>();
  return raw.map((e) => {
    const occurrenceIndex = seenSoFar.get(e.key) ?? 0;
    seenSoFar.set(e.key, occurrenceIndex + 1);
    return { ...e, occurrenceIndex, total: totals.get(e.key)! };
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

  const octagons = useMemo(() => buildOctagons(OCTAGON_RADIUS), []);
  const octagonById = useMemo(() => new Map(octagons.map((o) => [o.id, o])), [octagons]);
  const edgeOccurrences = groupEdgeOccurrences(trail);
  const totalHops = edgeOccurrences.length;
  const lastOccurrence = totalHops > 0 ? edgeOccurrences[totalHops - 1] : null;

  // The transient directional arrow starts/ends at the same slot points as the persistent line
  // it's drawn on top of, not the raw dot centers.
  let animatedFrom: Point | null = null;
  let animatedTo: Point | null = null;
  if (last && lastOccurrence) {
    const octA = octagonById.get(lastOccurrence.a)!;
    const octB = octagonById.get(lastOccurrence.b)!;
    const geo = computeEdgeGeometry(octA, octB);
    const { a: pA, b: pB } = slotPoints(geo, lastOccurrence.occurrenceIndex, lastOccurrence.total);
    animatedFrom = lastOccurrence.a === last.from ? pA : pB;
    animatedTo = lastOccurrence.a === last.from ? pB : pA;
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]">
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="rr-arrow-wrong" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-red-500" />
          </marker>
        </defs>

        {/* The octagon nodes themselves — real polygon geometry, drawn here rather than as HTML.
            Outline only by default; the one that was just tapped (and is temporarily un-tappable
            again until a different dot is chosen) fills in solid as the visual tie to that
            lock — no separate ripple popup needed. The invisible tap buttons below sit on top of
            these purely for hit-testing. */}
        {octagons.map((oct) => {
          const state = getDotState(oct.id);
          const isWrong = state === "wrong";
          const isLastTapped = trail.length > 0 && oct.id === trail[trail.length - 1];
          const solid = isWrong || isLastTapped;
          return (
            <polygon
              key={`oct-${oct.id}`}
              points={octagonPoints(oct)}
              strokeWidth={0.5}
              style={{ fillOpacity: solid ? 1 : 0 }}
              className={
                isWrong
                  ? "fill-red-600 stroke-red-600"
                  : "fill-neutral-900 stroke-neutral-400 transition-[fill-opacity] duration-150 ease-out dark:fill-white dark:stroke-neutral-500"
              }
            />
          );
        })}

        {/* Every retracing of a connection gets its own line, parallel to every other line on that
            same connection (guaranteed — see computeEdgeGeometry/slotPoints above), pushed further
            toward the ring's outer edge the more recent it is. Each line's own color is its slice
            of the single red -> violet spectrum the whole trail shares (see the comment up top) —
            oriented in the actual direction it was tapped, so within one line it's already shifting
            toward violet, and the very last line's arrival end is always exactly violet. A stable
            key per historical occurrence (not per slot) means existing lines smoothly slide to
            their new spatial offset as a connection's retrace count grows, via the inline CSS
            transition below, independent of their color, which is recomputed fresh each render as
            the spectrum keeps redividing. Driven entirely by `trail`, so it goes blank the instant
            a screen clears `trail` at the start of the next player's turn. */}
        {edgeOccurrences.map((occ) => {
          const octA = octagonById.get(occ.a)!;
          const octB = octagonById.get(occ.b)!;
          const geo = computeEdgeGeometry(octA, octB);
          const { a: pA, b: pB } = slotPoints(geo, occ.occurrenceIndex, occ.total);
          const pFrom = occ.from === occ.a ? pA : pB;
          const pTo = occ.from === occ.a ? pB : pA;
          const hueStart = hueAt(occ.hopIndex / totalHops);
          const hueEnd = hueAt((occ.hopIndex + 1) / totalHops);
          const gradId = `rr-edge-${occ.key}-occ${occ.occurrenceIndex}`;
          return (
            <g key={gradId}>
              <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={pFrom.x} y1={pFrom.y} x2={pTo.x} y2={pTo.y}>
                <stop offset="0%" stopColor={spectrumColor(hueStart)} />
                <stop offset="100%" stopColor={spectrumColor(hueEnd)} />
              </linearGradient>
              <line
                x1={pFrom.x}
                y1={pFrom.y}
                x2={pTo.x}
                y2={pTo.y}
                stroke={`url(#${gradId})`}
                strokeWidth={0.35}
                strokeLinecap="round"
                strokeOpacity={0.9}
                style={{ transition: "x1 300ms ease, y1 300ms ease, x2 300ms ease, y2 300ms ease" }}
              />
            </g>
          );
        })}

        {/* The hop that was just tapped: draws from the previous slot point to the new one, then erases the same way.
            Violet isn't a stand-in color here — the newest hop's arrival end is always exactly HUE_VIOLET by
            construction (see hueAt above), so this matches the persistent line beneath it exactly. */}
        {animatedFrom && animatedTo && (
          <AnimatedLine
            key={`${last!.from}-${last!.to}-${trail.length}`}
            from={animatedFrom}
            to={animatedTo}
            color={spectrumColor(HUE_VIOLET)}
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
            className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 touch-manipulation rounded-full sm:h-[72px] sm:w-[72px]"
          />
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
  color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  wrong?: boolean;
  persist?: boolean;
  /** Flat stroke color override (e.g. the current spectrum violet). Ignored when `wrong` is set. */
  color?: string;
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
  }, [from.x, from.y, to.x, to.y, persist, wrong]);

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
      markerEnd={wrong ? "url(#rr-arrow-wrong)" : undefined}
      style={color && !wrong ? { stroke: color } : undefined}
      className={wrong ? "stroke-red-500" : color ? undefined : "stroke-black dark:stroke-white"}
    />
  );
}
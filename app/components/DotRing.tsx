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

// A gradient with only a start and end stop interpolates in RGB space, not around the hue wheel —
// a straight red-to-violet 2-stop gradient cuts directly through RGB and skips right past the
// orange/yellow/green/blue/indigo bands instead of sweeping through them. Sampling several
// in-between hues as explicit stops forces the gradient to actually pass through every band.
const GRADIENT_SAMPLES = 20;

function hueStops(hueStart: number, hueEnd: number) {
  return Array.from({ length: GRADIENT_SAMPLES + 1 }, (_, i) => {
    const t = i / GRADIENT_SAMPLES;
    return { offset: `${t * 100}%`, color: spectrumColor(hueStart + (hueEnd - hueStart) * t) };
  });
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

// A connection is drawn as a bent path, not a straight line: it starts at the CENTER of the origin
// octagon, travels out through its assigned side (at that side's slot point), crosses straight to
// the neighbor's assigned side (at ITS slot point), then bends inward to that octagon's center.
// Multiple retracings of the same connection all share the same two center points and only fan out
// at the slot points in between (still guaranteed parallel there — see slotPoints above), so at
// each node it reads as several lines briefly converging to a single point before diverging again.
function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return len;
}

function pointAtFraction(points: Point[], t: number): Point {
  const total = pathLength(points);
  if (total === 0) return points[0];
  let target = Math.max(0, Math.min(t, 1)) * total;
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (target <= segLen || i === points.length - 2) {
      const localT = segLen > 0 ? target / segLen : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * localT,
        y: points[i].y + (points[i + 1].y - points[i].y) * localT,
      };
    }
    target -= segLen;
  }
  return points[points.length - 1];
}

/** The visible portion of a bent path between fractions `fromT` and `toT`, keeping any bend point(s) in between. */
function subPath(points: Point[], fromT: number, toT: number): Point[] {
  const total = pathLength(points);
  const fromD = Math.max(0, Math.min(fromT, 1)) * total;
  const toD = Math.max(0, Math.min(toT, 1)) * total;
  const result: Point[] = [pointAtFraction(points, fromT)];
  let cum = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) cum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (cum > fromD && cum < toD) result.push(points[i]);
  }
  result.push(pointAtFraction(points, toT));
  return result;
}

function pointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
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

  // The transient directional arrow travels the same bent path (center -> side -> side -> center)
  // as the persistent line it's drawn on top of, not a straight line between the raw slot points.
  let animatedPath: Point[] | null = null;
  if (last && lastOccurrence) {
    const octA = octagonById.get(lastOccurrence.a)!;
    const octB = octagonById.get(lastOccurrence.b)!;
    const geo = computeEdgeGeometry(octA, octB);
    const { a: pA, b: pB } = slotPoints(geo, lastOccurrence.occurrenceIndex, lastOccurrence.total);
    const pFrom = lastOccurrence.a === last.from ? pA : pB;
    const pTo = lastOccurrence.a === last.from ? pB : pA;
    const centerFrom = lastOccurrence.a === last.from ? octA.center : octB.center;
    const centerTo = lastOccurrence.a === last.from ? octB.center : octA.center;
    animatedPath = [centerFrom, pFrom, pTo, centerTo];
  }

  // The game-over failure indicator gets the same bent-path treatment, using the dead-center of
  // each side (no parallel offset — it's a one-off, not part of any retracing bundle).
  let wrongPath: Point[] | null = null;
  if (wrongEdge) {
    const octFrom = octagonById.get(wrongEdge.from)!;
    const octTo = octagonById.get(wrongEdge.to)!;
    const geo = computeEdgeGeometry(octFrom, octTo);
    const { a: pFrom, b: pTo } = slotPoints(geo, 0, 1);
    wrongPath = [octFrom.center, pFrom, pTo, octTo.center];
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]">
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="rr-arrow-wrong" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-red-500" />
          </marker>
        </defs>

        {/* Every retracing of a connection gets its own bent path, parallel to every other path on
            that same connection where it crosses between the two octagons (guaranteed — see
            computeEdgeGeometry/slotPoints above), pushed further toward the ring's outer edge the
            more recent it is. Each path's own color is its slice of the single red -> violet
            spectrum the whole trail shares (see the comment up top) — oriented in the actual
            direction it was tapped, so within one path it's already shifting toward violet, and
            the very last path's arrival end is always exactly violet. A stable key per historical
            occurrence (not per slot) means existing paths smoothly slide to their new spatial
            offset as a connection's retrace count grows — though note that's currently instant
            rather than animated, since CSS transitions don't reliably animate a polyline's `points`
            attribute the way they did the old straight `<line>`'s x1/y1/x2/y2. Driven entirely by
            `trail`, so it goes blank the instant a screen clears `trail` at the start of the next
            player's turn. */}
        {edgeOccurrences.map((occ) => {
          const octA = octagonById.get(occ.a)!;
          const octB = octagonById.get(occ.b)!;
          const geo = computeEdgeGeometry(octA, octB);
          const { a: pA, b: pB } = slotPoints(geo, occ.occurrenceIndex, occ.total);
          const pFrom = occ.from === occ.a ? pA : pB;
          const pTo = occ.from === occ.a ? pB : pA;
          const centerFrom = occ.from === occ.a ? octA.center : octB.center;
          const centerTo = occ.from === occ.a ? octB.center : octA.center;
          const path = [centerFrom, pFrom, pTo, centerTo];
          const hueStart = hueAt(occ.hopIndex / totalHops);
          const hueEnd = hueAt((occ.hopIndex + 1) / totalHops);
          const gradId = `rr-edge-${occ.key}-occ${occ.occurrenceIndex}`;
          return (
            <g key={gradId}>
              <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={centerFrom.x} y1={centerFrom.y} x2={centerTo.x} y2={centerTo.y}>
                {hueStops(hueStart, hueEnd).map((s, idx) => (
                  <stop key={idx} offset={s.offset} stopColor={s.color} />
                ))}
              </linearGradient>
              <polyline
                points={pointsAttr(path)}
                fill="none"
                stroke={`url(#${gradId})`}
                strokeWidth={0.16}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={0.9}
              />
            </g>
          );
        })}

        {/* The octagon nodes themselves — real polygon geometry, drawn AFTER the mesh lines above so
            they paint on top: the thicker rim visually covers where multiple thin mesh lines
            converge on this node's boundary, turning what would otherwise be several abrupt raw
            line-endpoints into one clean, continuous-looking joint. Outline only by default; the
            one that was just tapped (and is temporarily un-tappable again until a different dot is
            chosen) fills in solid as the visual tie to that lock — no separate ripple popup needed.
            The invisible tap buttons further below sit on top of these purely for hit-testing. */}
        {octagons.map((oct) => {
          const state = getDotState(oct.id);
          const isWrong = state === "wrong";
          const isLastTapped = trail.length > 0 && oct.id === trail[trail.length - 1];
          const solid = isWrong || isLastTapped;
          return (
            <polygon
              key={`oct-${oct.id}`}
              points={octagonPoints(oct)}
              strokeWidth={0.8}
              style={{ fillOpacity: solid ? 1 : 0 }}
              className={
                isWrong
                  ? "fill-red-600 stroke-red-600"
                  : "fill-neutral-900 stroke-neutral-400 transition-[fill-opacity] duration-150 ease-out dark:fill-white dark:stroke-neutral-500"
              }
            />
          );
        })}

        {/* The hop that was just tapped: draws from the origin octagon's center out through the
            bend and into the destination octagon's center, then erases the same way. Uses the SAME
            hue range as the persistent path it's drawn on top of, so the animation reveals the true
            rainbow rather than masking it — see AnimatedLine's hueStart/hueEnd comment for how
            that's guaranteed. */}
        {animatedPath && lastOccurrence && (
          <AnimatedLine
            key={`${last!.from}-${last!.to}-${trail.length}`}
            path={animatedPath}
            hueStart={hueAt(lastOccurrence.hopIndex / totalHops)}
            hueEnd={hueAt((lastOccurrence.hopIndex + 1) / totalHops)}
          />
        )}

        {/* A failed tap stays drawn permanently (game-over state), no erase. */}
        {wrongPath && <AnimatedLine key="wrong" path={wrongPath} wrong persist />}
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
 * Animates travel along a bent `path` (see the comment above slotPoints for what that path is):
 *  - draw phase: the tip travels from path[0] toward the far end (0 -> 1)
 *  - erase phase: the tail retracts from path[0] toward the far end (1 -> 2), same direction, so it
 *    visually "chases" itself off the board and disappears exactly at the far end.
 * Pass `persist` to stop after the draw phase and stay fully drawn (used for the game-over hop).
 */
function AnimatedLine({
  path,
  wrong = false,
  persist = false,
  hueStart,
  hueEnd,
}: {
  path: Point[];
  wrong?: boolean;
  persist?: boolean;
  /** When provided (and not `wrong`), stroked with the real rainbow gradient for this hop instead
   *  of a flat color — using path[0]/path[last] as FIXED gradient coordinates (not the currently
   *  animating visible sub-path) means whatever partial portion is drawn mid-animation still
   *  samples the correct slice of that fixed-in-space gradient, so it never disagrees with the
   *  persistent path it's drawn on top of. */
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

  const visible = progress <= 1 ? subPath(path, 0, progress) : subPath(path, progress - 1, 1);

  const first = path[0];
  const last = path[path.length - 1];
  const gradId = !wrong && hueStart !== undefined && hueEnd !== undefined ? "rr-anim-grad" : null;

  return (
    <>
      {gradId && (
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={first.x} y1={first.y} x2={last.x} y2={last.y}>
          {hueStops(hueStart!, hueEnd!).map((s, idx) => (
            <stop key={idx} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
      )}
      <polyline
        points={pointsAttr(visible)}
        fill="none"
        strokeWidth={0.45}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={wrong ? "url(#rr-arrow-wrong)" : undefined}
        stroke={gradId ? `url(#${gradId})` : undefined}
        className={wrong ? "stroke-red-500" : gradId ? undefined : "stroke-black dark:stroke-white"}
      />
    </>
  );
}
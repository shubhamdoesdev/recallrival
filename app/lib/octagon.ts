import { DOTS, type DotSpec } from "./dots";

export interface Point {
  x: number;
  y: number;
}

export interface OctagonNode {
  id: number;
  center: Point;
  /** All 8 vertices, in order. The side between vertices[k] and vertices[(k+1)%8] is "side k". */
  vertices: Point[];
  /** Which of my 8 sides (1..7 — side 0 is reserved, facing outward) is dedicated to a given neighbor. */
  neighborSide: Map<number, number>;
}

const RING_CENTER: Point = { x: 50, y: 50 };

function toDeg(rad: number) {
  return rad * (180 / Math.PI);
}

function toRad(deg: number) {
  return deg * (Math.PI / 180);
}

function normalizeAngle(deg: number) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

function angleBetween(from: Point, to: Point) {
  return toDeg(Math.atan2(to.y - from.y, to.x - from.x));
}

/**
 * Builds one octagon per dot. Each octagon is rotated so side 0 points straight outward, away
 * from the ring's center — that's the permanently unused side. Its other 7 sides get matched to
 * the 7 other octagons: both this node's 7 candidate side-angles and the 7 real directions to the
 * other nodes are sorted going around the circle and paired in that order, which guarantees a
 * clean one-to-one assignment where no two connections cross over each other unnecessarily.
 */
export function buildOctagons(radius: number): OctagonNode[] {
  return DOTS.map((dot) => {
    const outward = angleBetween(RING_CENTER, dot);
    const rotation = outward;

    const others = DOTS.filter((d) => d.id !== dot.id);
    const byAngle = others
      .map((d) => ({ id: d.id, rel: normalizeAngle(angleBetween(dot, d) - rotation) }))
      .sort((a, b) => a.rel - b.rel);

    const neighborSide = new Map<number, number>();
    byAngle.forEach((entry, idx) => neighborSide.set(entry.id, idx + 1)); // sides 1..7

    const vertices = Array.from({ length: 8 }, (_, k) => {
      const a = toRad(rotation + k * 45 - 22.5);
      return { x: dot.x + radius * Math.cos(a), y: dot.y + radius * Math.sin(a) };
    });

    return { id: dot.id, center: { x: dot.x, y: dot.y }, vertices, neighborSide };
  });
}

/** A point a fraction `t` (0-1) along side `sideIndex`, from its first vertex to its second. */
export function pointOnSide(node: OctagonNode, sideIndex: number, t: number): Point {
  const v1 = node.vertices[sideIndex];
  const v2 = node.vertices[(sideIndex + 1) % 8];
  return { x: v1.x + (v2.x - v1.x) * t, y: v1.y + (v2.y - v1.y) * t };
}

export function octagonPoints(node: OctagonNode): string {
  return node.vertices.map((v) => `${v.x},${v.y}`).join(" ");
}

export type { DotSpec };
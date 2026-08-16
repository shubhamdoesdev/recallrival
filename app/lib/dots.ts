
export interface DotSpec {
  id: number;
  x: number; // percentage, 0-100
  y: number; // percentage, 0-100
}
 
export const DOT_COUNT = 8;
const RADIUS = 38; // percentage of container
 
// 8 dots evenly spaced around a circle, starting at 12 o'clock.
export const DOTS: DotSpec[] = Array.from({ length: DOT_COUNT }, (_, i) => {
  const angle = (-90 + i * 45) * (Math.PI / 180);
  return {
    id: i,
    x: 50 + RADIUS * Math.cos(angle),
    y: 50 + RADIUS * Math.sin(angle),
  };
});
 
/** Returns the unused dot ids in random order. */
export function shuffledUnused(used: number[]): number[] {
  const all = DOTS.map((d) => d.id).filter((id) => !used.includes(id));
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}
 
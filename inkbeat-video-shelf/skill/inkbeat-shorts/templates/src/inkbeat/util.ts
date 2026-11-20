// Small math / color helpers.
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (t: number, a: number, b: number) => {
  const u = clamp((t - a) / (b - a));
  return u * u * (3 - 2 * u);
};
export const mix = (a: string, b: string, u: number) => {
  const A = hex(a);
  const B = hex(b);
  const v = A.map((x, i) => Math.round(lerp(x, B[i], clamp(u))));
  return `#${v.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};

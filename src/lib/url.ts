/**
 * Prefix a root-relative path with Astro's configured base.
 *
 * The production build serves from the root of kedservice.com, where this is a
 * no-op. The staging copy is served from a sub-path of brettboggs.dev, where
 * every internal link and public asset has to carry that prefix or it 404s.
 */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${prefix}${path}`;
}

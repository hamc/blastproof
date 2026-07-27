import { describe, expect, it } from 'vitest';
import { mapImpact } from '../src/impact.js';

describe('mapImpact', () => {
  it('maps changed files to the URLs of every matching glob', () => {
    const result = mapImpact(['src/cart/discount.ts'], { 'src/cart/**': ['/cart', '/checkout'] });
    expect(result.affectedRoutes).toEqual(['/cart', '/checkout']);
    expect(result.unmappedFiles).toEqual([]);
  });

  it('de-duplicates routes across overlapping globs', () => {
    const result = mapImpact(['src/cart/discount.ts', 'src/pay/flow.ts'], {
      'src/cart/**': ['/checkout', '/cart'],
      'src/pay/**': ['/checkout'],
    });
    expect(result.affectedRoutes).toEqual(['/cart', '/checkout']);
    expect(result.unmappedFiles).toEqual([]);
  });

  it('reports files matching no glob as unmapped, sorted', () => {
    const result = mapImpact(['docs/guide.md', 'README.md', 'src/cart/discount.ts'], {
      'src/cart/**': ['/cart'],
    });
    expect(result.affectedRoutes).toEqual(['/cart']);
    expect(result.unmappedFiles).toEqual(['README.md', 'docs/guide.md']);
  });

  it('reports every file as unmapped when routes config is empty', () => {
    const result = mapImpact(['src/app.ts', 'a/b.ts'], {});
    expect(result.affectedRoutes).toEqual([]);
    expect(result.unmappedFiles).toEqual(['a/b.ts', 'src/app.ts']);
  });

  it('matches dotfiles with dot: true', () => {
    const result = mapImpact(['.github/workflows/ci.yml'], { '**/*.yml': ['/ci'] });
    expect(result.affectedRoutes).toEqual(['/ci']);
    expect(result.unmappedFiles).toEqual([]);
  });

  it('normalizes Windows-style separators before matching', () => {
    const result = mapImpact(['src\\cart\\discount.ts'], { 'src/cart/**': ['/cart'] });
    expect(result.affectedRoutes).toEqual(['/cart']);
    expect(result.unmappedFiles).toEqual([]);
  });

  it('returns empty results for no changed files', () => {
    const result = mapImpact([], { 'src/**': ['/x'] });
    expect(result).toEqual({ affectedRoutes: [], unmappedFiles: [], ignoredFiles: [] });
  });
});

describe('ignore globs', () => {
  const ROUTES = { 'src/cart/**': ['/cart'] };

  it('keeps an ignored file out of the unmapped report', () => {
    const result = mapImpact(['README.md'], ROUTES, ['**/*.md']);
    expect(result.unmappedFiles).toEqual([]);
    expect(result.ignoredFiles).toEqual(['README.md']);
    expect(result.affectedRoutes).toEqual([]);
  });

  it('lets ignore win over a routes match, so irrelevant means irrelevant', () => {
    const result = mapImpact(['src/cart/README.md'], ROUTES, ['**/*.md']);
    expect(result.affectedRoutes).toEqual([]);
    expect(result.ignoredFiles).toEqual(['src/cart/README.md']);
  });

  it('still reports a file matching neither', () => {
    const result = mapImpact(['src/lib/money.ts'], ROUTES, ['**/*.md']);
    expect(result.unmappedFiles).toEqual(['src/lib/money.ts']);
    expect(result.ignoredFiles).toEqual([]);
  });

  it('behaves exactly as before with no ignore list', () => {
    const result = mapImpact(['docs/guide.md', 'src/cart/a.ts'], ROUTES);
    expect(result.unmappedFiles).toEqual(['docs/guide.md']);
    expect(result.ignoredFiles).toEqual([]);
    expect(result.affectedRoutes).toEqual(['/cart']);
  });
});

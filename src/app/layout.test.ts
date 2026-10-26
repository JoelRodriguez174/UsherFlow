import { describe, expect, it, vi } from 'vitest';

// next/font/google solo funciona dentro del compilador de Next: acá se reemplaza por un stub.
vi.mock('next/font/google', () => ({
  Fraunces: () => ({ variable: 'f' }),
  Figtree: () => ({ variable: 'g' }),
}));

import { metadata } from './layout';

describe('layout', () => {
  it('no envía Referer: /entrar?k=<clave> lleva el secreto en la URL', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });
});

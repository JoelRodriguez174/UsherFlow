import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeCtx() {
  const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  return {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createOscillator: () => ({
      type: '',
      frequency: param,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createGain: () => ({ gain: param, connect: vi.fn() }),
  };
}

let Ctor: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  Ctor = vi.fn(function () {
    return fakeCtx();
  });
  vi.stubGlobal('window', { AudioContext: Ctor });
});
afterEach(() => vi.unstubAllGlobals());

describe('audio (bug 1: el toggle llega a audio.ts)', () => {
  it('con sonido deshabilitado, ningún play* crea un AudioContext', async () => {
    const a = await import('./audio');
    a.setSonidoHabilitado(false);
    a.playClickSound();
    a.playSuccessSound();
    a.playWarningSound();
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('con sonido habilitado (por defecto) sí crea el AudioContext', async () => {
    const a = await import('./audio');
    a.playClickSound();
    expect(Ctor).toHaveBeenCalledTimes(1);
  });

  it('se puede volver a habilitar', async () => {
    const a = await import('./audio');
    a.setSonidoHabilitado(false);
    a.playClickSound();
    a.setSonidoHabilitado(true);
    a.playClickSound();
    expect(Ctor).toHaveBeenCalledTimes(1);
  });
});

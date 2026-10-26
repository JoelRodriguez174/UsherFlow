// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const llamarRpc = vi.fn();
const usePreparacion = vi.fn();
const renovar = vi.fn();

vi.mock('@/components/supervisor/usePreparacion', () => ({ usePreparacion: () => usePreparacion() }));
vi.mock('@/components/supervisor/SupervisorShell', () => ({
  useSupervisor: () => ({
    claves: { claveUjier: 'UJIER1', claveSupervisor: 'SUPER1' },
    origen: 'https://usherflow.test',
    renovar,
  }),
}));
vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { leerAcceso } from '@/lib/acceso';
import { PASOS } from '@/domain/preparacion';
import { ARMADO_MS } from '../useArmado';
import { QrPaso } from './QrPaso';

const ORIGEN = 'https://usherflow.test';
const recargar = vi.fn();

function pasosCon(cambios: (id: string) => Record<string, unknown> = () => ({})) {
  return PASOS.map((p) => ({
    ...p,
    completo: true,
    bloqueado: false,
    resumen: '',
    requisitos: [],
    avisos: [],
    ...cambios(p.id),
  }));
}

/** Deja pasar el tiempo de armado de los botones destructivos. */
function armar() {
  act(() => {
    vi.advanceTimersByTime(ARMADO_MS);
  });
}

function listaUjieres() {
  return screen.getByRole('list', { name: /ujieres/i });
}

beforeEach(() => {
  // shouldAdvanceTime: userEvent y waitFor siguen andando; el armado se adelanta a mano con armar().
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  usePreparacion.mockReturnValue({ estado: 'listo', pasos: pasosCon(), recargar });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  llamarRpc.mockReset();
  renovar.mockReset();
  usePreparacion.mockReset();
});

describe('QrPaso: enlaces', () => {
  it('muestra 4 enlaces de ujier (Puerta, Izquierda, Centro, Derecha) con la clave de ujier', () => {
    render(<QrPaso />);
    const items = within(listaUjieres()).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    const nombres = ['Puerta', 'Izquierda', 'Centro', 'Derecha'];
    const roles = ['puerta', 'izquierda', 'centro', 'derecha'];
    items.forEach((item, i) => {
      expect(within(item).getByRole('heading', { name: nombres[i] })).toBeTruthy();
      expect(within(item).getByText(`${ORIGEN}/entrar?k=UJIER1&rol=${roles[i]}`)).toBeTruthy();
    });
    expect(screen.queryAllByText(/SUPER1/)).toHaveLength(1); // solo el enlace del supervisor
  });

  it('el enlace del supervisor usa la clave de supervisor', () => {
    render(<QrPaso />);
    expect(screen.getByText(`${ORIGEN}/entrar?k=SUPER1&rol=supervisor`)).toBeTruthy();
  });

  it('genera un QR con texto alternativo por enlace', async () => {
    render(<QrPaso />);
    await waitFor(() => {
      const qrs = screen.getAllByRole('img', { name: /QR/i });
      expect(qrs).toHaveLength(5);
      qrs.forEach((qr) => expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/));
    });
  });

  it('copia el enlace al portapapeles', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<QrPaso />);
    const item = within(listaUjieres()).getAllByRole('listitem')[0];
    await user.click(within(item).getByRole('button', { name: /copiar enlace/i }));
    expect(writeText).toHaveBeenCalledWith(`${ORIGEN}/entrar?k=UJIER1&rol=puerta`);
    expect(await within(item).findByText(/copiado/i)).toBeTruthy();
  });

  it('sin portapapeles selecciona el texto para copiarlo a mano', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<QrPaso />);
    const item = within(listaUjieres()).getAllByRole('listitem')[0];
    await user.click(within(item).getByRole('button', { name: /copiar enlace/i }));
    expect(await within(item).findByText(/seleccion/i)).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe(`${ORIGEN}/entrar?k=UJIER1&rol=puerta`);
  });
});

describe('QrPaso: avisos y sin bloqueo', () => {
  it('muestra arriba los avisos del paso qr cuando hay', () => {
    const aviso = 'El salón todavía no está listo: falta Salón';
    usePreparacion.mockReturnValue({
      estado: 'listo',
      pasos: pasosCon((id) => (id === 'qr' ? { avisos: [aviso], completo: false } : {})),
      recargar,
    });
    render(<QrPaso />);
    const el = screen.getByText(aviso);
    const enlaces = screen.getByRole('heading', { name: /enlaces para ujieres/i });
    expect(el.compareDocumentPosition(enlaces) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sin avisos no muestra ninguno', () => {
    render(<QrPaso />);
    expect(screen.queryByText(/todavía no está listo/i)).toBeNull();
  });

  it('nunca muestra el bloqueo, aunque falten pasos anteriores', () => {
    usePreparacion.mockReturnValue({
      estado: 'listo',
      pasos: pasosCon((id) => (id === 'salon' || id === 'qr' ? { completo: false } : {})),
      recargar,
    });
    render(<QrPaso />);
    expect(screen.queryByText(/primero/i)).toBeNull();
    expect(screen.getByText(`${ORIGEN}/entrar?k=UJIER1&rol=puerta`)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'QR de ujieres', level: 1 })).toBeTruthy();
  });
});

describe('QrPaso: renovar claves', () => {
  it('tras confirmar guarda el acceso nuevo, avisa y llama a renovar con las claves nuevas', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: true, clave_ujier: 'UJIER2', clave_supervisor: 'SUPER2' });
    render(<QrPaso />);

    await user.click(screen.getByRole('button', { name: 'Renovar claves' }));
    expect(llamarRpc).not.toHaveBeenCalled();
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));

    await waitFor(() => expect(llamarRpc).toHaveBeenCalledWith('regenerar_claves', { p_clave: 'SUPER1' }));
    await waitFor(() => expect(renovar).toHaveBeenCalledWith({ claveUjier: 'UJIER2', claveSupervisor: 'SUPER2' }));
    expect(leerAcceso()).toEqual({ clave: 'SUPER2', rol: 'supervisor' });
    expect(screen.getByRole('status').textContent).toMatch(/claves renovadas/i);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('el aviso de éxito sobrevive al remontaje (una sola vez)', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: true, clave_ujier: 'UJIER2', clave_supervisor: 'SUPER2' });
    const primera = render(<QrPaso />);
    await user.click(screen.getByRole('button', { name: 'Renovar claves' }));
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));
    await waitFor(() => expect(renovar).toHaveBeenCalledTimes(1));
    primera.unmount(); // el shell remonta el paso

    const segunda = render(<QrPaso />);
    expect(screen.getByRole('status').textContent).toMatch(/claves renovadas/i);
    segunda.unmount();

    render(<QrPaso />);
    expect(screen.queryByText(/claves renovadas/i)).toBeNull();
  });

  it('sin storage disponible renueva igual y no muestra aviso al remontar', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: true, clave_ujier: 'UJIER2', clave_supervisor: 'SUPER2' });
    const boom = () => {
      throw new Error('storage bloqueado');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    try {
      const primera = render(<QrPaso />);
      await user.click(screen.getByRole('button', { name: 'Renovar claves' }));
      armar();
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));
      await waitFor(() => expect(renovar).toHaveBeenCalledWith({ claveUjier: 'UJIER2', claveSupervisor: 'SUPER2' }));
      primera.unmount();
      render(<QrPaso />);
      expect(screen.queryByText(/claves renovadas/i)).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('si la respuesta no trae claves válidas no cambia nada y avisa', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: true });
    render(<QrPaso />);
    await user.click(screen.getByRole('button', { name: 'Renovar claves' }));
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(`${ORIGEN}/entrar?k=UJIER1&rol=centro`)).toBeTruthy();
    expect(leerAcceso()).toBeNull();
    expect(renovar).not.toHaveBeenCalled();
  });

  it('un error del servidor se muestra como alerta y no renueva', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: false, error: 'CLAVE_INVALIDA' });
    render(<QrPaso />);
    await user.click(screen.getByRole('button', { name: 'Renovar claves' }));
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('msg:CLAVE_INVALIDA');
    expect(renovar).not.toHaveBeenCalled();
  });
});

describe('QrPaso: armado de la confirmación destructiva (anti doble toque)', () => {
  it('Renovar claves: el botón arranca deshabilitado, un clic no llama a la RPC y luego se habilita', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    llamarRpc.mockResolvedValue({ success: true });
    render(<QrPaso />);
    await user.click(screen.getByRole('button', { name: 'Renovar claves' }));

    const boton = within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(within(screen.getByRole('dialog')).getByText(/esperá un instante/i)).toBeTruthy();
    expect(boton.getAttribute('aria-describedby')).toBeTruthy();
    await user.click(boton);
    expect(llamarRpc).not.toHaveBeenCalled();

    armar();
    expect(boton.disabled).toBe(false);
    expect(boton.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(/esperá un instante/i)).toBeNull();
    await user.click(boton);
    await waitFor(() => expect(llamarRpc).toHaveBeenCalledTimes(1));
  });
});

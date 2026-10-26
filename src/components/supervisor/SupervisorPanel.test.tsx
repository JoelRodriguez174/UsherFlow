// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const llamarRpc = vi.fn();

vi.mock('@/lib/rpc', () => ({
  llamarRpc: (...a: unknown[]) => llamarRpc(...a),
  ClaveInvalidaError: class ClaveInvalidaError extends Error {},
  mensajeDeError: (c: string) => `msg:${c}`,
}));

import { leerAcceso } from '@/lib/acceso';
import { PLANTILLA_EJEMPLO } from '@/config/plantilla';
import { SupervisorPanel } from './SupervisorPanel';
import { ARMADO_MS } from './useArmado';

const ORIGEN = 'https://usherflow.test';
const props = {
  claveUjier: 'UJIER1',
  claveSupervisor: 'SUPER1',
  origen: ORIGEN,
  ocupacion: { ocupados: 30, capacidad: 120 },
};

/** Deja pasar el tiempo de armado de los botones destructivos. */
function armar() {
  act(() => {
    vi.advanceTimersByTime(ARMADO_MS);
  });
}

function listaUjieres() {
  return screen.getByRole('list', { name: /ujieres/i });
}

async function confirmarVaciado(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
  armar();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }));
}

beforeEach(() => {
  // shouldAdvanceTime: userEvent y waitFor siguen andando; el armado se adelanta a mano con armar().
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  llamarRpc.mockReset();
});

describe('SupervisorPanel: enlaces', () => {
  it('muestra 4 enlaces de ujier (Puerta, Izquierda, Centro, Derecha) con la clave de ujier', () => {
    render(<SupervisorPanel {...props} />);
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
    render(<SupervisorPanel {...props} />);
    expect(screen.getByText(`${ORIGEN}/entrar?k=SUPER1&rol=supervisor`)).toBeTruthy();
  });

  it('genera un QR con texto alternativo por enlace', async () => {
    render(<SupervisorPanel {...props} />);
    await waitFor(() => {
      const qrs = screen.getAllByRole('img', { name: /QR/i });
      expect(qrs).toHaveLength(5);
      qrs.forEach((qr) => expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/));
    });
  });

  it('muestra la ocupación', () => {
    render(<SupervisorPanel {...props} />);
    expect(screen.getByText(/30 de 120/)).toBeTruthy();
  });

  it('copia el enlace al portapapeles', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SupervisorPanel {...props} />);
    const item = within(listaUjieres()).getAllByRole('listitem')[0];
    await user.click(within(item).getByRole('button', { name: /copiar enlace/i }));
    expect(writeText).toHaveBeenCalledWith(`${ORIGEN}/entrar?k=UJIER1&rol=puerta`);
    expect(await within(item).findByText(/copiado/i)).toBeTruthy();
  });

  it('sin portapapeles selecciona el texto para copiarlo a mano', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<SupervisorPanel {...props} />);
    const item = within(listaUjieres()).getAllByRole('listitem')[0];
    await user.click(within(item).getByRole('button', { name: /copiar enlace/i }));
    expect(await within(item).findByText(/seleccion/i)).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe(`${ORIGEN}/entrar?k=UJIER1&rol=puerta`);
  });
});

describe('SupervisorPanel: vaciar auditorio', () => {
  it('no llama a la RPC hasta la segunda confirmación', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: true });
    render(<SupervisorPanel {...props} />);

    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
    expect(llamarRpc).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
    // segundo paso: todavía sin RPC
    expect(llamarRpc).not.toHaveBeenCalled();
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }));

    await waitFor(() => expect(llamarRpc).toHaveBeenCalledTimes(1));
    expect(llamarRpc).toHaveBeenCalledWith('reiniciar_salon', { p_clave: 'SUPER1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toMatch(/vaci/i);
  });

  it('cancelar en el segundo paso no llama a la RPC', async () => {
    const user = userEvent.setup();
    render(<SupervisorPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(llamarRpc).not.toHaveBeenCalled();
  });

  it('un error del servidor se muestra como alerta', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: false, error: 'CLAVE_INVALIDA' });
    render(<SupervisorPanel {...props} />);
    await confirmarVaciado(user);
    expect((await screen.findByRole('alert')).textContent).toContain('msg:CLAVE_INVALIDA');
  });

  it('un fallo de red se muestra como alerta', async () => {
    const user = userEvent.setup();
    llamarRpc.mockRejectedValue(new Error('boom'));
    render(<SupervisorPanel {...props} />);
    await confirmarVaciado(user);
    expect((await screen.findByRole('alert')).textContent).toContain('msg:ERROR_DE_RED');
  });
});

describe('SupervisorPanel: aplicar plantilla', () => {
  it('pide una confirmación y luego llama a aplicar_plantilla con PLANTILLA_EJEMPLO', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: true });
    render(<SupervisorPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Aplicar plantilla' }));
    expect(llamarRpc).not.toHaveBeenCalled();
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, aplicar/i }));
    await waitFor(() =>
      expect(llamarRpc).toHaveBeenCalledWith('aplicar_plantilla', {
        p_clave: 'SUPER1',
        p_plantilla: PLANTILLA_EJEMPLO,
      }),
    );
  });
});

describe('SupervisorPanel: renovar claves', () => {
  it('tras confirmar muestra los enlaces con las claves nuevas y guarda el acceso nuevo', async () => {
    const user = userEvent.setup();
    const alRenovar = vi.fn();
    llamarRpc.mockResolvedValue({ success: true, clave_ujier: 'UJIER2', clave_supervisor: 'SUPER2' });
    render(<SupervisorPanel {...props} onClavesRenovadas={alRenovar} />);

    await user.click(screen.getByRole('button', { name: 'Renovar claves' }));
    expect(llamarRpc).not.toHaveBeenCalled();
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));

    await waitFor(() => expect(llamarRpc).toHaveBeenCalledWith('regenerar_claves', { p_clave: 'SUPER1' }));
    expect(await screen.findByText(`${ORIGEN}/entrar?k=UJIER2&rol=centro`)).toBeTruthy();
    expect(screen.getByText(`${ORIGEN}/entrar?k=SUPER2&rol=supervisor`)).toBeTruthy();
    expect(screen.queryByText(/UJIER1/)).toBeNull();
    expect(screen.queryByText(/SUPER1/)).toBeNull();
    expect(leerAcceso()).toEqual({ clave: 'SUPER2', rol: 'supervisor' });
    expect(alRenovar).toHaveBeenCalledWith({ claveUjier: 'UJIER2', claveSupervisor: 'SUPER2' });
  });

  it('si la respuesta no trae claves válidas no cambia nada y avisa', async () => {
    const user = userEvent.setup();
    llamarRpc.mockResolvedValue({ success: true });
    render(<SupervisorPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Renovar claves' }));
    armar();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sí, renovar/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(`${ORIGEN}/entrar?k=UJIER1&rol=centro`)).toBeTruthy();
    expect(leerAcceso()).toBeNull();
  });
});

describe('SupervisorPanel: armado de las confirmaciones destructivas (anti doble toque)', () => {
  const confirmaciones = [
    { accion: 'Aplicar plantilla', confirmar: /sí, aplicar/i },
    { accion: 'Renovar claves', confirmar: /sí, renovar/i },
  ];

  it.each(confirmaciones)('$accion: el botón arranca deshabilitado, un clic no llama a la RPC y luego se habilita', async ({ accion, confirmar }) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    llamarRpc.mockResolvedValue({ success: true });
    render(<SupervisorPanel {...props} />);
    await user.click(screen.getByRole('button', { name: accion }));

    const boton = within(screen.getByRole('dialog')).getByRole('button', { name: confirmar }) as HTMLButtonElement;
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

  it('Vaciar auditorio: el paso 2 arranca deshabilitado y un doble toque en Continuar no lo ejecuta', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    llamarRpc.mockResolvedValue({ success: true });
    render(<SupervisorPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));

    // Paso 1: "Continuar" no es destructivo y responde enseguida.
    const continuar = within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }) as HTMLButtonElement;
    expect(continuar.disabled).toBe(false);
    await user.dblClick(continuar);

    // Paso 2 (re-armado): el segundo toque no alcanzó al botón destructivo.
    const vaciar = within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }) as HTMLButtonElement;
    expect(vaciar.disabled).toBe(true);
    expect(llamarRpc).not.toHaveBeenCalled();

    armar();
    expect(vaciar.disabled).toBe(false);
    await user.click(vaciar);
    await waitFor(() => expect(llamarRpc).toHaveBeenCalledWith('reiniciar_salon', { p_clave: 'SUPER1' }));
  });

  it('cada paso se vuelve a armar: lo esperado en el paso 1 no habilita el paso 2', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SupervisorPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Vaciar auditorio' }));
    armar(); // pasa el tiempo en el paso 1
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /continuar/i }));
    const vaciar = within(screen.getByRole('dialog')).getByRole('button', { name: /sí, vaciar/i }) as HTMLButtonElement;
    expect(vaciar.disabled).toBe(true);
  });
});

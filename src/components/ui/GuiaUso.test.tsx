// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotonGuiaUso, GuiaUso } from './GuiaUso';

afterEach(cleanup);

describe('GuiaUso', () => {
  it('despliega y repliega la guía paso a paso del supervisor', async () => {
    const user = userEvent.setup();
    render(<GuiaUso rol="supervisor" />);
    const boton = screen.getByRole('button', { name: /Cómo preparar y operar el evento/ });
    expect(boton.getAttribute('aria-expanded')).toBe('false');

    await user.click(boton);
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('1. Armá el Salón')).toBeTruthy();
  });

  it('el botón de guía para ujieres abre un modal con los pasos de su rol', async () => {
    const user = userEvent.setup();
    render(<BotonGuiaUso rol="puerta" />);
    await user.click(screen.getByRole('button', { name: 'Guía de uso' }));
    expect(screen.getByRole('dialog', { name: 'Guía rápida — Ujier de Puerta' })).toBeTruthy();
    expect(screen.getByText('2. Marcá cuántos son')).toBeTruthy();
  });
});

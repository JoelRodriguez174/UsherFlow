import { afterEach, describe, expect, it } from 'vitest';
import {
  esCodigoValido,
  esContrasenaValida,
  esEmailValido,
  limpiarLimites,
  normalizarEmail,
  verificarLimite,
} from './pastorAuth';

afterEach(() => limpiarLimites());

describe('pastorAuth', () => {
  it('normaliza y valida emails', () => {
    expect(normalizarEmail('  Pastor@Iglesia.ORG ')).toBe('pastor@iglesia.org');
    expect(normalizarEmail(null)).toBe('');
    expect(esEmailValido('pastor@iglesia.org')).toBe(true);
    expect(esEmailValido('invalido')).toBe(false);
    expect(esEmailValido('')).toBe(false);
  });

  it('valida códigos OTP de exactamente 6 dígitos', () => {
    expect(esCodigoValido('123456')).toBe(true);
    expect(esCodigoValido(' 004299 ')).toBe(true);
    expect(esCodigoValido('12345')).toBe(false);
    expect(esCodigoValido('12345a')).toBe(false);
    expect(esCodigoValido(123456)).toBe(false);
  });

  it('valida contraseñas de 8 a 128 caracteres', () => {
    expect(esContrasenaValida('1234567')).toBe(false);
    expect(esContrasenaValida('clave123')).toBe(true);
    expect(esContrasenaValida('a'.repeat(129))).toBe(false);
  });

  it('aplica rate limit y reinicia al vencer la ventana', () => {
    expect(verificarLimite('k', 2, 1000, 100)).toBe(true);
    expect(verificarLimite('k', 2, 1000, 200)).toBe(true);
    expect(verificarLimite('k', 2, 1000, 300)).toBe(false);
    expect(verificarLimite('k', 2, 1000, 1200)).toBe(true);
  });
});

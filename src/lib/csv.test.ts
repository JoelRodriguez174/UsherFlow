import { describe, expect, it } from 'vitest';
import { parsearReservasCsv, planillaATexto } from './csv';

describe('parsearReservasCsv', () => {
  it('lee ; con BOM, CRLF, comillas y líneas vacías', () => {
    const r = parsearReservasCsv(
      '\uFEFFsede;sección;sesión;cantidad\r\nCatán;Centro;Sábado tarde;120\r\n"Lomas, Sur";izquierda;Sábado tarde;40\r\n\r\n',
    );
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([
      { sede: 'Catán', seccion: 'centro', sesion: 'Sábado tarde', cantidad: 120 },
      { sede: 'Lomas, Sur', seccion: 'izquierda', sesion: 'Sábado tarde', cantidad: 40 },
    ]);
  });

  it('lee , con "" escapado y columnas en otro orden', () => {
    const r = parsearReservasCsv('Cantidad,SEDE,Seccion,Sesion\n5,"a ""b""", DERECHA ,S1');
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([{ sede: 'a "b"', seccion: 'derecha', sesion: 'S1', cantidad: 5 }]);
  });

  it('informa sección y cantidad inválidas con su línea física', () => {
    const r = parsearReservasCsv(
      'sede,seccion,sesion,cantidad\nCatán,arriba,Sábado tarde,10\n\nCatán,centro,Sábado tarde,0\nCatán,centro,Sábado tarde,1.5',
    );
    expect(r.filas).toEqual([]);
    expect(r.errores).toEqual([
      { linea: 2, motivo: 'Sección inválida: arriba' },
      { linea: 4, motivo: 'Cantidad inválida: 0' },
      { linea: 5, motivo: 'Cantidad inválida: 1.5' },
    ]);
  });

  it('informa sede y sesión faltantes', () => {
    const r = parsearReservasCsv('sede,seccion,sesion,cantidad\n,centro,S1,3\nX,centro,,3');
    expect(r.errores).toEqual([
      { linea: 2, motivo: 'Falta la sede' },
      { linea: 3, motivo: 'Falta la sesión' },
    ]);
  });

  it('sin columna cantidad: un error en la línea 1 y ninguna fila', () => {
    const r = parsearReservasCsv('sede;seccion;sesion\nX;centro;S1');
    expect(r.filas).toEqual([]);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].linea).toBe(1);
  });

  it('devuelve la línea de archivo de cada fila válida, saltando las en blanco', () => {
    const r = parsearReservasCsv('sede,seccion,sesion,cantidad\nA,centro,S1,3\n\nB,derecha,S1,2');
    expect(r.lineas).toEqual([2, 4]);
  });
});

describe('parsearReservasCsv: columna sector', () => {
  it('con columna sector (; y ,) la manda solo si trae texto; sin columna no cambia nada', () => {
    const a = parsearReservasCsv('sede;seccion;sesion;cantidad;sector\nCatán;centro;S1;5;Platea A\nLomas;centro;S1;3;');
    expect(a.errores).toEqual([]);
    expect(a.filas).toEqual([
      { sede: 'Catán', seccion: 'centro', sesion: 'S1', cantidad: 5, sector: 'Platea A' },
      { sede: 'Lomas', seccion: 'centro', sesion: 'S1', cantidad: 3 },
    ]);
    const b = parsearReservasCsv('Sector,sede,seccion,sesion,cantidad\n"A, norte",Catán,centro,S1,5');
    expect(b.filas).toEqual([{ sede: 'Catán', seccion: 'centro', sesion: 'S1', cantidad: 5, sector: 'A, norte' }]);
    expect(parsearReservasCsv('sede;seccion;sesion;cantidad\nCatán;centro;S1;5').filas[0]).not.toHaveProperty('sector');
  });
});

describe('planillaATexto', () => {
  it('convierte filas de Excel a texto que parsearReservasCsv acepta, aun con ; y comillas', () => {
    const texto = planillaATexto([
      ['sede', 'seccion', 'sesion', 'cantidad'],
      ['San Luis; Norte', 'centro', 'Domingo "10"', 42],
      [null, 'centro', 'Domingo 10', 3],
    ]);
    const { filas, errores } = parsearReservasCsv(texto);
    expect(filas).toEqual([{ sede: 'San Luis; Norte', seccion: 'centro', sesion: 'Domingo "10"', cantidad: 42 }]);
    expect(errores).toEqual([{ linea: 3, motivo: 'Falta la sede' }]);
  });
});

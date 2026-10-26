import { capacidadPublicaFila } from '@/domain/disponibilidad';
import { SECCIONES, type Fila, type Seccion } from '@/domain/types';

type SectorResumen = { seccion: Seccion; nombre: string; desde: number; hasta: number };

const TITULOS: Record<Seccion, string> = { izquierda: 'Izquierda', centro: 'Centro', derecha: 'Derecha' };

/** Lugares públicos por sector y filas de cada sección que ningún sector cubre. */
export function ResumenSectores({ sectores, filas }: { sectores: ReadonlyArray<SectorResumen>; filas: ReadonlyArray<Fila> }) {
  return (
    <div className="flex flex-col gap-3">
      {SECCIONES.map((seccion) => {
        const delaSeccion = sectores.filter((s) => s.seccion === seccion);
        const filasSeccion = filas.filter((f) => f.seccion === seccion);
        const sinSector = filasSeccion.filter((f) => capacidadPublicaFila(f) > 0 && !delaSeccion.some((s) => f.numero >= s.desde && f.numero <= s.hasta)).map((f) => f.numero).sort((a, b) => a - b);
        if (delaSeccion.length === 0 && sinSector.length === 0) return null;
        return (
          <section key={seccion} aria-label={TITULOS[seccion]} className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-texto">{TITULOS[seccion]}</h3>
            <ul className="flex flex-col gap-1 text-base text-texto-suave">
              {delaSeccion.map((s, i) => {
                const lugares = filasSeccion.filter((f) => f.numero >= s.desde && f.numero <= s.hasta).reduce((n, f) => n + capacidadPublicaFila(f), 0);
                return <li key={i}>{`${s.nombre}: filas ${s.desde} a ${s.hasta} · ${lugares} lugares`}</li>;
              })}
              {sinSector.length > 0 && <li className="text-advertencia">{`Filas sin sector: ${sinSector.join(', ')}`}</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

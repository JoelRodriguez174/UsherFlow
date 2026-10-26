# Supervisor en rutas, por pasos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dividir `/supervisor` en 6 rutas por paso (Salón, Sesiones, Sedes, Reservas, QR, Revisión) ordenadas por dependencia, con una pantalla de inicio de desplegables que muestra qué falta, y nombres de sede sin distinguir acentos ni mayúsculas.

**Architecture:** Un `layout.tsx` en `src/app/supervisor/` monta una sola vez las claves y el `SalonProvider` (hoy lo hace `SupervisorPagina`). Una función pura (`calcularPasos`) calcula estado, requisitos y avisos de cada paso a partir de datos que ya devuelven `obtener_mapa_supervisor`, `obtener_reservas` y el estado del salón. Los tres paneles existentes se parten en un componente por paso, conservando su lógica y sus tests. Una sola migración nueva (sedes sin acentos).

**Tech Stack:** Next 16 (App Router), React 19, Tailwind v4, Supabase (pgTAP), vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-26-usherflow-supervisor-rutas-design.md`

## Global Constraints

- Antes de tocar rutas o layouts, leer `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` y `04-linking-and-navigating.md` (lo exige `AGENTS.md`); navegar con `next/link`.
- Estilo: solo tokens de `src/app/globals.css` (`bg-superficie`, `text-texto`, `text-texto-suave`, `border-borde`, `bg-acento`, `text-advertencia`, `text-peligro`, `font-titulo`), `Boton`, `Aviso`, `Modal`, `lucide-react`. Nunca colores literales en componentes.
- Mobile-first (verificar a 360 px), objetivos táctiles ≥ 44 px, inputs ≥ 16 px con `label`, `aria-label` en botones de solo ícono, foco visible, HTML semántico (`<details>/<summary>` o botón con `aria-expanded` para los desplegables).
- UI en español rioplatense; commits en español con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No hay modo evento ni bloqueo de edición: Supervisor siempre editable. Solo se bloquean por URL Sesiones, Sedes, Reservas y Revisión; **el paso QR nunca se bloquea** (ver y renovar claves siempre disponible).
- Un aviso (🟡) no impide avanzar; solo un requisito faltante deja un paso "incompleto" y bloquea los siguientes.
- La URL de entrada de los supervisores (`/entrar?k=…` → `/supervisor`) no cambia.
- Tests actuales (vitest 446, pgTAP 1004) deben seguir en verde; los tests de `SupervisorPanel`, `ReservasPanel`, `SectoresPanel`, `MapaSupervisor` se mueven con el código que cubren sin borrar aserciones.
- Verificación final: `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npx next build`, `npx supabase test db` (Docker encendido).

## Review Focus

1. Evento recién creado, sin nada cargado (arreglos vacíos, `fechaLimite` null): ningún paso revienta y los requisitos se listan todos en ❌ (Task 2).
2. Falla la carga del estado (red o clave): nunca se muestra "listo" ni "Todo listo"; se muestra "No pudimos revisar" con reintento (Task 3, 10).
3. Entrar por URL a un paso bloqueado sin haber pasado por el inicio: muestra "Completá <paso> primero" con enlace; sin acceso guardado cae en la pantalla de clave inválida existente (Task 4).
4. "Renovar claves" desde `/supervisor/qr`: el layout se remonta con las claves nuevas y el usuario **sigue en `/supervisor/qr`** (Task 9).
5. Aplicar plantilla deja sectores que ya no cubren las filas: el Salón pasa a 🟡 con el aviso de filas fuera de sector (Task 2, 5).
6. Sede "Catán" y archivo con "CATAN" o "catan": no se crea una sede nueva ni aparece en "sedes nuevas" (Task 1).

---

### Task 1: Nombres de sede sin acentos ni mayúsculas (migración)

**Files:**
- Create: `supabase/migrations/20261026000900_sede_sin_acentos.sql`
- Create: `supabase/tests/database/016_sede_sin_acentos.test.sql`

**Interfaces:**
- Consumes: `public.importar_reservas` (última versión en `20261026000400_reservas_sector.sql`), `public.guardar_sede` (`20261026000700`), tabla `public.sede` con `nombre text not null unique` global.
- Produces: mismas firmas y respuestas; cambia solo cómo se comparan nombres de sede.

- [ ] **Step 1:** Escribir `016_sede_sin_acentos.test.sql` (pgTAP, mismo estilo de `015_guardar_sede.test.sql`) con estos casos: `guardar_sede('Catán')` y luego `guardar_sede('catan')` devuelven el **mismo** `sede_id`; `importar_reservas(simular=true)` con filas de sede `'CATAN'` y sede existente `'Catán'` devuelve `sedes_nuevas = []`; un archivo con `'Catán'` y `'catan'` en la misma sesión/sección/sector se rechaza como "Fila repetida"; el insert directo de `'CATAN'` en `public.sede` viola la unicidad.
- [ ] **Step 2:** `npx supabase test db` → debe fallar en esos casos.
- [ ] **Step 3:** Migración nueva: función `private.sin_acentos(text) returns text` (`immutable`, envuelve `lower(extensions.unaccent($1))`; `unaccent` no es immutable, hace falta el envoltorio para el índice), `create unique index sede_nombre_norm_key on public.sede (private.sin_acentos(nombre))`, y `create or replace` de `importar_reservas` y `guardar_sede` reemplazando **todo** `lower(...)` sobre nombres de sede por `private.sin_acentos(...)` (existencia, `distinct on` de sedes nuevas, `partition by` de filas repetidas, `group by` de totales, join de la reserva). Conservar firmas, `security definer`, `set search_path = ''` y los `revoke/grant` (`create or replace` los conserva). Cabecera de la migración: si la nube ya tiene sedes duplicadas por acento el índice falla a propósito; revisar a mano antes (`select private.sin_acentos(nombre), count(*) from public.sede group by 1 having count(*) > 1`).
- [ ] **Step 4:** `npx supabase db reset` y `npx supabase test db` → los 1004 + nuevos tests pasan.
- [ ] **Step 5:** Commit `feat(db): sedes sin distinguir acentos ni mayúsculas`.

### Task 2: Lógica pura de pasos (`calcularPasos`)

**Files:**
- Create: `src/domain/preparacion.ts`, `src/domain/preparacion.test.ts`

**Interfaces:**
- Consumes: `capacidadPublicaFila` de `src/domain/disponibilidad.ts`; tipos `Seccion`, `SECCIONES`, `Fila` de `src/domain/types.ts`; `SectorServidor`, `SedeServidor` de `components/supervisor/MapaSupervisor.tsx`.
- Produces (todo lo exporta `src/domain/preparacion.ts`):
  ```ts
  export type PasoId = 'salon' | 'sesiones' | 'sedes' | 'reservas' | 'qr' | 'revision';
  export type Requisito = { texto: string; ok: boolean; ejemplo?: string };
  export type Paso = {
    id: PasoId; titulo: string; ruta: string;      // ruta: '/supervisor/salon', ...
    completo: boolean;                             // todos los requisitos ok
    bloqueado: boolean; motivoBloqueo?: string;    // "Se abre al completar <paso anterior>"; nunca true para 'qr'
    resumen: string;                               // "3 sectores · 752 lugares"
    requisitos: Requisito[]; avisos: string[];
  };
  export type DatosPreparacion = {
    filas: ReadonlyArray<Fila>;
    sectores: ReadonlyArray<SectorServidor>;
    sedes: ReadonlyArray<SedeServidor>;
    fechaLimite: string | null;
    sesiones: ReadonlyArray<{ id: string; nombre: string; inicio_at: string; reservas: ReadonlyArray<{ sede: string; seccion: Seccion; cantidad: number; sector?: string | null }> }>;
    ahoraMs: number;
  };
  export const PASOS: ReadonlyArray<{ id: PasoId; titulo: string; ruta: string }>;
  export function calcularPasos(d: DatosPreparacion): Paso[];   // siempre 6, en el orden de PASOS
  ```

- [ ] **Step 1:** Tests (vitest, datos mínimos armados con helpers locales) con estas aserciones: evento vacío → 6 pasos, `salon.completo === false`, los otros bloqueados con `motivoBloqueo` que nombra el paso anterior, `qr.bloqueado === false`, sin excepciones; salón completo = cada sección con filas de `capacidadPublicaFila > 0` tiene sectores que cubren todas sus filas sin huecos ni solapes (filas solo reservadas no cuentan); sectores que dejan una fila afuera → `salon.completo === false` y requisito "Todas las filas dentro de un sector" en ❌; ≥1 sesión → `sesiones.completo`; ≥1 sede → `sedes.completo`; ≥1 reserva en alguna sesión → `reservas.completo`; `qr` agrega el aviso `"El salón todavía no está listo: falta <paso>"` si algún paso 1–4 está incompleto; `revision.completo` solo si 1–5 completos y sin requisitos en ❌.
- [ ] **Step 2:** Tests de avisos (no cambian `completo`): reservas de un sector que suman más que `sector.capacidad`; sesión con `inicio_at` anterior a `ahoraMs`; `fechaLimite` posterior a `inicio_at` de alguna sesión; sesión sin reservas; sede sin ninguna reserva; sede sin `clave_acceso`; dos sedes cuyo nombre normalizado (minúsculas, sin acentos) difiere en ≤ 1 letra.
- [ ] **Step 3:** `npx vitest run src/domain/preparacion.test.ts` → falla.
- [ ] **Step 4:** Implementar `calcularPasos` y `PASOS`; normalización de nombres sin dependencias nuevas (`normalize('NFD')` + quitar marcas + `toLowerCase`). Sin acceso a red ni al DOM.
- [ ] **Step 5:** Tests pasan; commit `feat: lógica pura del estado de cada paso del supervisor`.

### Task 3: Shell compartido, contexto de preparación y layout

**Files:**
- Create: `src/components/supervisor/SupervisorShell.tsx`, `src/components/supervisor/usePreparacion.ts` (contexto + hook), `src/app/supervisor/layout.tsx`
- Modify: `src/components/paginas/SupervisorPagina.tsx` (su lógica de claves y `SalonProvider` sale hacia el shell; el archivo se elimina en Task 11)
- Test: `src/components/supervisor/SupervisorShell.test.tsx`

**Interfaces:**
- Consumes: `useClavesDelSalon` y el montaje con `key={generacion}` que hoy están en `SupervisorPagina.tsx`; `SalonProvider`, `useSalon`, `MarcoSalon`, `PantallaClaveInvalida`; `calcularPasos`.
- Produces:
  ```ts
  // SupervisorShell.tsx
  export function SupervisorShell(props: { children: ReactNode }): JSX.Element;
  export function useSupervisor(): { claves: ClavesSalon; origen: string; renovar(nuevas: ClavesSalon): void };
  // usePreparacion.ts
  export function usePreparacion(): { estado: 'cargando' | 'error' | 'listo'; pasos: Paso[]; recargar(): void };
  ```
  `src/app/supervisor/layout.tsx` es un layout que renderiza `<SupervisorShell>{children}</SupervisorShell>`; los hijos solo se renderizan con claves ya cargadas (mientras tanto se muestran los estados "Preparando…" / error con "Probar de nuevo" / clave inválida que hoy muestra `SupervisorContenido`).

- [ ] **Step 1:** Test: con `llamarRpc` mockeado (como en `SupervisorPanel.test.tsx`), el shell pide `obtener_claves`, luego `obtener_mapa_supervisor` y `obtener_reservas`, y `usePreparacion` entrega 6 pasos; si cualquiera de las dos falla, `estado === 'error'` y **ningún** paso está `completo`; `recargar()` vuelve a pedir ambos; `renovar(nuevas)` cambia `claves` y remonta el provider sin cambiar la ruta.
- [ ] **Step 2:** Falla → implementar: mover `useClavesDelSalon` al shell; el estado se pide con las claves de supervisor y se combina con `useSalon().filas` en `calcularPasos` (`ahoraMs = Date.now()` al calcular).
- [ ] **Step 3:** `src/app/supervisor/page.tsx` pasa a renderizar `PasosInicio` (Task 4); mientras tanto un `<main>` con el título. Pasa el test; commit `refactor: layout de supervisor con claves y estado de pasos compartidos`.

### Task 4: Inicio con desplegables, barra de pasos y bloqueo por URL

**Files:**
- Create: `src/components/supervisor/PasosInicio.tsx`, `BarraPasos.tsx`, `MarcoPaso.tsx` (+ un `.test.tsx` por componente)
- Modify: `src/app/supervisor/page.tsx`

**Interfaces:**
- Consumes: `usePreparacion`, `Paso`, `PASOS`, `Boton`, `next/link`.
- Produces:
  ```ts
  export function PasosInicio(): JSX.Element;                              // "N de 6 pasos listos" + un desplegable por paso
  export function BarraPasos(props: { actual: PasoId }): JSX.Element;      // chips ✅/🟡/🔒, el actual marcado con aria-current="step"
  export function MarcoPaso(props: { paso: PasoId; children: ReactNode }): JSX.Element;
  ```
  `MarcoPaso`: muestra `BarraPasos` y `children`; si el paso está `bloqueado` muestra en su lugar "Completá <paso anterior> primero" con `Link` a su ruta (sin formularios); al final un botón/enlace "Siguiente: <paso>" deshabilitado mientras `!paso.completo`, con el motivo visible ("Falta: …"). Mientras `estado === 'cargando'` muestra "Cargando…"; en `'error'`, "No pudimos revisar el estado" con "Probar de nuevo" (`recargar`).

- [ ] **Step 1:** Tests: cada paso es un desplegable cerrado con título, ícono de estado y `resumen`; al abrirlo lista los `requisitos` con ✅/❌ y el ejemplo; el botón "Completar este paso →" es un `Link` a `paso.ruta`; un paso bloqueado se puede abrir pero su acción está deshabilitada y dice `motivoBloqueo`; con `estado: 'error'` ningún paso muestra ✅; `MarcoPaso` de un paso bloqueado no renderiza `children`; `BarraPasos` marca el actual.
- [ ] **Step 2:** Falla → implementar con los tokens del proyecto; los ✅/🟡/🔒 llevan texto accesible (`sr-only`) además del ícono (lucide).
- [ ] **Step 3:** Pasa; commit `feat: inicio de preparación con desplegables y marco de pasos`.

### Task 5: Paso Salón (`/supervisor/salon`)

**Files:**
- Create: `src/components/supervisor/pasos/SalonPaso.tsx`, `ResumenSectores.tsx`, `src/app/supervisor/salon/page.tsx`
- Modify: `SupervisorPanel.tsx` (se le sacan las acciones), `SectoresPanel.tsx` (se le saca la parte de sectores) y sus tests (se mueven)

**Interfaces:**
- Consumes: formulario de sectores, `dividir`, `partirEnTres` y manejo de `SECTORES_CON_ASIGNACIONES` de `SectoresPanel`; "Aplicar plantilla" y "Vaciar auditorio" de `SupervisorPanel` (con su `Modal` y `BotonConfirmar`/`useArmado`); `MarcoPaso`, `usePreparacion().recargar`.
- Produces:
  ```ts
  export function SalonPaso(): JSX.Element;   // dentro de <MarcoPaso paso="salon">
  export function ResumenSectores(props: { sectores: ReadonlyArray<{ seccion: Seccion; nombre: string; desde: number; hasta: number }>; filas: ReadonlyArray<Fila> }): JSX.Element;
  ```
  `ResumenSectores` muestra por sector "Sector A: filas 1 a 8 · 64 lugares" (lugares = suma de `capacidadPublicaFila` de las filas del rango) y marca en `text-advertencia` las filas de la sección que quedan fuera de todo sector.

- [ ] **Step 1:** Tests: `ResumenSectores` calcula los lugares y marca filas sin sector; `SalonPaso` guarda sectores con `guardar_sectores` y llama a `recargar`; ante `SECTORES_CON_ASIGNACIONES` muestra el motivo y un `Link` a `/supervisor/reservas`; "Aplicar plantilla" y "Vaciar auditorio" siguen pidiendo la doble confirmación con armado; el texto de confirmar plantilla agrega "revisá los sectores después".
- [ ] **Step 2:** Falla → mover código sin cambiar su lógica; verificar en `supabase/migrations` si `aplicar_plantilla` toca la tabla `sector` y, si no, dejar la advertencia del texto (no cambiar el servidor).
- [ ] **Step 3:** Pasa (incluidos los tests movidos); commit `feat: paso Salón del supervisor`.

### Task 6: Paso Sesiones (`/supervisor/sesiones`)

**Files:**
- Create: `src/components/supervisor/pasos/SesionesPaso.tsx`, `src/components/supervisor/useRpcSupervisor.ts`, `src/app/supervisor/sesiones/page.tsx`
- Modify: `ReservasPanel.tsx` (se le sacan sesiones y liberación) y su test (se mueve)

**Interfaces:**
- Produces: `useRpcSupervisor(clave: string): { llamar(rpc, params?): Promise<ResultadoRpc | null>; llamarOk(rpc, params?): Promise<ResultadoRpc | null>; mensaje: Mensaje; setMensaje(m: Mensaje): void }` (extrae el `llamar`/`llamarOk`/`avisarFallo` que hoy están copiados en los tres paneles; usarlo en las Tasks 5–9 y reemplazar las copias) y `export function SesionesPaso(): JSX.Element`.
- Consumes: formularios de sesión y liberación, `guardar_sesion`, `guardar_liberacion`, `borrar_sesion` y su modal; helpers `deLocalAr`, `mostrarHora`.

- [ ] **Step 1:** Tests movidos de `ReservasPanel.test.tsx` (guardar sesión con hora `-03:00`, guardar liberación, borrar con confirmación) + test nuevo: tras guardar o borrar se llama `recargar()` y el botón "Siguiente: Sedes" se habilita cuando hay ≥ 1 sesión.
- [ ] **Step 2:** Falla → implementar; mover `deLocalAr`/`mostrarHora` a un módulo compartido si lo usan dos pasos.
- [ ] **Step 3:** Pasa; commit `feat: paso Sesiones del supervisor`.

### Task 7: Paso Sedes (`/supervisor/sedes`)

**Files:**
- Create: `src/components/supervisor/pasos/SedesPaso.tsx`, `src/app/supervisor/sedes/page.tsx`
- Modify: `SectoresPanel.tsx` (se le saca fecha límite y sedes; el archivo se elimina en Task 11) y su test (se mueve)

**Interfaces:**
- Produces: `export function SedesPaso(): JSX.Element`. Consumes: `guardar_fecha_limite`, `guardar_sede`, `generar_acceso_sede` (con rotar y su modal), `TarjetaEnlace`, `armarEnlace`.

- [ ] **Step 1:** Tests movidos (agregar sede, generar y rotar enlace, fecha límite guardar y quitar) + nuevos: texto de ayuda "Los nombres no distinguen mayúsculas ni acentos"; tras cada cambio se llama `recargar()`; los avisos de `sede sin enlace` del paso aparecen en el desplegable.
- [ ] **Step 2:** Falla → implementar. Pasa; commit `feat: paso Sedes del supervisor`.

### Task 8: Paso Reservas (`/supervisor/reservas`)

**Files:**
- Create: `src/components/supervisor/pasos/ReservasPaso.tsx`, `src/app/supervisor/reservas/page.tsx`
- Modify: `ReservasPanel.tsx` (queda solo con reservas por sesión + importación, y se mueve a `pasos/`), `MapaSupervisor.tsx` (se reutiliza tal cual dentro del paso)

**Interfaces:**
- Produces: `export function ReservasPaso(): JSX.Element` con tablas por sesión (`TablaSesion`), importación CSV/.xlsx y `MapaSupervisor`.
- Consumes: `importar_reservas` (simular y confirmar), `obtener_reservas`.

- [ ] **Step 1:** Tests movidos (tablas, importación con simulación, errores por fila) + nuevos: si `sedes_nuevas` no está vacío la vista previa lo muestra como aviso con borde de advertencia: `"Se van a crear sedes nuevas: Catan. Si es un error de tipeo, corregí el archivo."` y "Confirmar importación" sigue disponible; si está vacío no hay aviso; tras confirmar o guardar se llama `recargar()`.
- [ ] **Step 2:** Falla → implementar (el servidor ya resuelve la normalización por la Task 1). Pasa; commit `feat: paso Reservas del supervisor`.

### Task 9: Paso QR de ujieres (`/supervisor/qr`)

**Files:**
- Create: `src/components/supervisor/pasos/QrPaso.tsx`, `src/app/supervisor/qr/page.tsx`
- Modify: `SupervisorPanel.tsx` (queda solo con los QR y "Renovar claves"; se mueve a `pasos/`)

**Interfaces:**
- Produces: `export function QrPaso(): JSX.Element`. Consumes: `useSupervisor().renovar`, `TarjetaEnlace`, `DESTINOS_UJIER`, `regenerar_claves`.

- [ ] **Step 1:** Tests movidos (QR de Puerta/Izquierda/Centro/Derecha y Supervisor, renovar con doble confirmación) + nuevos: este paso **nunca** muestra el bloqueo del `MarcoPaso`; si hay pasos incompletos muestra arriba el aviso `"El salón todavía no está listo: falta <paso>"`; tras renovar claves, `renovar` se llama con las nuevas y la ruta sigue siendo `/supervisor/qr`.
- [ ] **Step 2:** Falla → implementar (si el remontaje por `key` del shell cambia la ruta, corregirlo en el shell). Pasa; commit `feat: paso QR de ujieres del supervisor`.

### Task 10: Paso Revisión (`/supervisor/revision`)

**Files:**
- Create: `src/components/supervisor/pasos/RevisionPaso.tsx`, `src/app/supervisor/revision/page.tsx`

**Interfaces:**
- Produces: `export function RevisionPaso(): JSX.Element`. Consumes: `usePreparacion`, `Paso`.

- [ ] **Step 1:** Tests: lista los 5 pasos anteriores con ✅/🟡/❌ y sus `avisos` con un `Link` al paso; "Todo listo" solo si todos `completo` y sin ❌, y aun así muestra los 🟡 que queden; con `estado: 'error'` muestra "No pudimos revisar" y nunca "Todo listo".
- [ ] **Step 2:** Falla → implementar. Pasa; commit `feat: paso Revisión del supervisor`.

### Task 11: Limpieza y verificación final

**Files:**
- Delete: `src/components/paginas/SupervisorPagina.tsx`, `SectoresPanel.tsx` y cualquier panel que haya quedado vacío; sus tests ya movidos
- Modify: `README.md` / `docs` solo si mencionan la pantalla única

- [ ] **Step 1:** `grep` de importaciones rotas (`SupervisorPagina`, `SectoresPanel`, `ReservasPanel`, `SupervisorPanel`); `npx tsc --noEmit` y `npx eslint .` limpios.
- [ ] **Step 2:** `npx vitest run` (≥ 446 tests, ninguna aserción borrada), `npx next build`, `npx supabase db reset && npx supabase test db`.
- [ ] **Step 3:** Revisión manual con `next dev`: `/supervisor` y cada ruta a 360 px, entrar por URL a un paso bloqueado, renovar claves desde `/supervisor/qr`.
- [ ] **Step 4:** Commit `refactor: eliminar la pantalla única de supervisor`. Avisar al usuario que `supabase db push` (migración `…0900`) y el redeploy los corre él, después de revisar duplicados por acento en la nube.

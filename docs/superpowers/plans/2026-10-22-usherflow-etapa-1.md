# UsherFlow Etapa 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar el núcleo de UsherFlow: flujo Puerta → Sección con confirmación del ujier, plantilla del salón con tramos reservados, acceso por QR con clave secreta, refactor probado y rediseño cálido.

**Architecture:** La base de datos (Postgres + RPC `SECURITY DEFINER`, escritura solo vía RPC con clave del evento) es la fuente de verdad; el conteo vive solo por **tramo** de cada fila. El cliente tiene una capa de dominio pura (disponibilidad, sugerencia, fragmentación) con tests, un store con mutaciones optimistas que se revierten **por entidad**, y vistas separadas para Puerta, Sección y Supervisor.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, Supabase (Postgres, Realtime, RPC plpgsql), Vitest + Testing Library, pgTAP (Supabase CLI), `qrcode`.

**Spec:** `docs/superpowers/specs/2026-10-22-usherflow-rediseno-y-reservas-design.md` (leer entero, incluida la sección 10b). Los mockups de referencia están en `.superpowers/brainstorm/854-1792636446/content/`.

## Global Constraints

- Next.js 16 (App Router), React 19, Tailwind v4, Supabase. **Antes de escribir código de Next, leer `node_modules/next/dist/docs/`** (indicación de `AGENTS.md`: esta versión tiene cambios incompatibles; p. ej. `next lint` ya no existe y `params`/`searchParams` pueden ser asíncronos).
- Interfaz en español rioplatense. Sin datos personales de ninguna clase.
- Móvil vertical 6.1"–6.7", una mano. Ujieres **sin login**; entran por QR/enlace con **clave secreta del evento** validada por el servidor en **cada** RPC; la clave es renovable. Existe además una clave de **supervisor**.
- Escritura solo por RPC: sin policies de INSERT/UPDATE/DELETE para `anon`. Lectura abierta.
- Un grupo mandado queda **apartado hasta que el ujier confirme**; nunca se libera ni se da por sentado solo. Pasa a **ámbar** a los `180_000` ms (placeholder). "No llegaron" es la única forma de liberarlo.
- Fragmentación: "Se levantó alguien" en una fila con **≥ 4** ocupados (contados antes de descontar) marca la fila `fragmentada`. "Corregir conteo" **no** fragmenta. Una fila fragmentada solo admite grupos de 1 hasta "Juntos".
- Tamaños de grupo en la Puerta: `1, 2, 3, 4, 5+`. Secciones: `izquierda`, `centro`, `derecha`.
- Sincronización < 200 ms; resincronizar al volver a foco/online. Hora siempre del servidor (`clock_timestamp()`); el cliente usa un offset RTT/2.
- Accesibilidad: zoom permitido (sin `userScalable:false`), texto ≥ 12 px, `aria-label` en botones solo-ícono, foco atrapado en modales y devuelto al cerrar, `:focus-visible` siempre, inputs ≥ 16 px, nunca bloquear el pegado.
- **Cero colores hex en `src/components` y `src/app/**/*.tsx`**: solo tokens semánticos en un único `@theme`. Usar `dvh`, nada de offsets sticky fijos en px.
- Etapa 1 solo crea las tablas `evento`, `sesion` (con `inicio_at timestamptz`) y `sede`, sin lógica.

## Decisiones de este plan (mías; no estaban en el spec)

- **Dos claves** por evento: `clave_ujier` (Puerta y Sección) y `clave_supervisor` (reiniciar, plantilla, capacidad, renovar claves). Se guardan en texto plano (es un secreto compartido del QR, sin acceso directo para `anon`).
- El evento se **deduce de la clave**; el cliente ya no maneja `eventoId`.
- El rol (Puerta, Sección X) viaja en el enlace solo como conveniencia de la interfaz; el servidor valida únicamente la clave.
- Tabla `registro` (tipo + `detalle jsonb`) para las correcciones, los "No llegaron" y los tiempos de confirmación (spec §4.1 punto 6).
- El tamaño de grupo por defecto en la Puerta es `2`.
- **Sin git por ahora (decidido por el usuario el 2026-10-22):** no hacer `git init` ni commits. **Omitir todos los pasos "Commit"** de este plan; cada tarea termina cuando sus tests pasan. La raíz git que existe es `C:\Users\Enekon` (carpeta de usuario) y no debe usarse.
- Las RPC de pgTAP requieren Docker + Supabase CLI. Si no están, correr los `.sql` de `supabase/tests/database/` contra un proyecto de desarrollo.

## Review Focus

1. Una sección tiene libres de sobra pero ninguna fila aloja el grupo (p. ej. 3 libres sueltos y llega un grupo de 3 con la fila fragmentada): la Puerta debe mostrar "No entran 3" y el servidor rechazar si ya no hay cupo. → Task 4, 7, 14.
2. Dos Puertas mandan a la vez al último cupo de una sección: solo una gana, la otra recibe `SECCION_SIN_CUPO`. → Task 7.
3. Un ujier toca "Sentar" sin red: se revierte **solo** esa fila/pendiente, nunca otras filas actualizadas por otros ujieres, y se avisa. → Task 10, 11.
4. Celular con la hora mal puesta: el ámbar y las edades de verificación usan el offset del servidor. → Task 4, 12.
5. La clave se renueva mientras un ujier tiene la app abierta: la próxima acción devuelve `CLAVE_INVALIDA`, la app muestra "Pedí un QR nuevo" y no reintenta en bucle. → Task 11, 16.

---

## File Structure

```
src/domain/types.ts            tipos del salón (Seccion, Tramo, Fila, Pendiente, EstadoSalon, Rol)
src/domain/plantilla.ts        tipos de plantilla + validarPlantilla
src/domain/disponibilidad.ts   libres por tramo/fila, grupo máximo junto
src/domain/sugerencia.ts       sugerirUbicacion, colocarVirtual
src/domain/resumen.ts          resumenSeccion (libres y grupo máximo con pendientes)
src/domain/fragmentacion.ts    umbral y regla de fragmentación
src/domain/pendientes.ts       ámbar, offset de reloj
src/domain/revision.ts         orden de "filas para mirar"
src/config/plantilla.ts        PLANTILLA_EJEMPLO (editable por el equipo)
src/lib/supabase.ts            cliente tipado
src/lib/rpc.ts                 llamarRpc + ClaveInvalidaError
src/lib/acceso.ts              leer/guardar clave y rol; armar enlaces
src/state/salonReducer.ts      store puro: mutaciones optimistas con reversión por entidad
src/state/sync.ts              carga, realtime, resync, ejecutar mutaciones
src/state/derivar.ts           vistas derivadas con referencias estables
src/state/SalonProvider.tsx    Context + hooks (useSalon, useTick)
src/components/ui/             Boton, Modal, Aviso, IndicadorConexion
src/components/puerta/         PuertaView
src/components/seccion/        SeccionView, PendienteCard, FilaItem, ElegirUbicacion
src/components/supervisor/     SupervisorPanel
src/app/                       layout, globals.css, page, entrar, puerta, seccion/[seccion], supervisor
src/utils/audio.ts             + setSonidoHabilitado
supabase/migrations/           001 base, 002 salón, 003 flujo, 004 correcciones, 005 supervisor
supabase/tests/database/       pgTAP por migración
public/manifest.json           PWA
```

---

### Task 1: Herramientas y bugs de configuración

**Files:**
- Modify: `package.json`, `.env.example`
- Create: `vitest.config.ts`, `eslint.config.mjs`, `.gitignore`, `src/__tests__/humo.test.ts`

**Interfaces:** Produces: scripts `npm test` (Vitest), `npm run lint` (`eslint .`), `npm run test:db` (`supabase test db`).

- [ ] **Step 1: Sin git.** El usuario decidió no usar git por ahora: no hacer `git init`; saltear todos los pasos de commit del plan.
- [ ] **Step 2: Leer** `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` y `03-api-reference/05-config/03-eslint.md`; anotar cómo se configura ESLint y cómo se leen `params`/`searchParams` en esta versión.
- [ ] **Step 3: Test de humo.** `src/__tests__/humo.test.ts` con `expect(1 + 1).toBe(2)`. Correr `npx vitest run`: debe fallar por Vitest no instalado.
- [ ] **Step 4: Instalar** `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@vitejs/plugin-react`, `eslint`, `eslint-config-next`, `qrcode`, `@types/qrcode`. Crear `vitest.config.ts` (entorno `node` por defecto; los tests de componentes usan `// @vitest-environment jsdom`; alias `@` → `src`).
- [ ] **Step 5: Crear `eslint.config.mjs`** (flat config con `eslint-config-next` según la doc) y cambiar en `package.json` `"lint": "eslint ."`, agregar `"test": "vitest run"` y `"test:db": "supabase test db"`. Resuelve el bug 5 del spec.
- [ ] **Step 6: Crear `.gitignore`** con `node_modules`, `.next`, `.env.local`, `.superpowers/`. En `.env.example` dejar solo `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [ ] **Step 7: Verificar:** `npm test` pasa (1 test), `npm run lint` corre sin error de configuración.
- [ ] **Step 8: Commit** `chore: herramientas de test y lint para Next 16`.

---

### Task 2: Tipos de dominio y plantilla

**Files:**
- Create: `src/domain/types.ts`, `src/domain/plantilla.ts`, `src/config/plantilla.ts`
- Test: `src/domain/plantilla.test.ts`

**Interfaces:** Produces:
```ts
export type Seccion = 'izquierda' | 'centro' | 'derecha';
export const SECCIONES: readonly Seccion[];
export type TramoTipo = 'publico' | 'reservado';
export interface Tramo { id: number; orden: number; tipo: TramoTipo; capacidad: number; ocupados: number; etiqueta: string | null }
export interface Fila { id: number; seccion: Seccion; numero: number; fragmentada: boolean; verificadaEn: string | null; tramos: Tramo[] }
export interface Pendiente { id: string; seccion: Seccion; cantidad: number; creadoEn: string }
export interface EstadoSalon { serverNow: string; filas: Fila[]; pendientes: Pendiente[] }
export type Rol = 'puerta' | Seccion | 'supervisor';
// plantilla.ts
export interface PlantillaTramo { tipo: TramoTipo; capacidad: number; etiqueta?: string }
export interface PlantillaFila { numero: number; tramos: PlantillaTramo[] }
export type Plantilla = Record<Seccion, PlantillaFila[]>;
export function validarPlantilla(p: Plantilla): string[]; // lista de errores; vacía = válida
```

- [ ] **Step 1: Tests** (`plantilla.test.ts`):
  - `PLANTILLA_EJEMPLO` es válida: `expect(validarPlantilla(PLANTILLA_EJEMPLO)).toEqual([])`.
  - Rechaza capacidad ≤ 0: error que contiene `"capacidad"`.
  - Rechaza números de fila repetidos en una sección: error con `"repetido"`.
  - Rechaza un tramo `reservado` sin `etiqueta`: error con `"etiqueta"`.
  - Rechaza una fila sin ningún tramo.
- [ ] **Step 2: Correr** `npx vitest run src/domain/plantilla.test.ts`: falla.
- [ ] **Step 3: Implementar** los tipos y `validarPlantilla`.
- [ ] **Step 4: Crear `src/config/plantilla.ts`** con `PLANTILLA_EJEMPLO` (placeholder): 15 filas por sección; cada fila un tramo público de 8; `centro` filas 1–2 un único tramo `reservado` de 8 con etiqueta `"Pastores"`; `izquierda` filas 3–6 con `[publico 3][reservado 2 "Mamás"][publico 3]`; `derecha` filas 1–2 `[reservado 4 "Alabanza"][publico 4]`. Comentario al inicio: valores de ejemplo, reemplazar por los reales.
- [ ] **Step 5: Correr los tests:** pasan. **Step 6: Commit** `feat: tipos de dominio y plantilla del salón`.

---

### Task 3: Disponibilidad

**Files:** Create `src/domain/disponibilidad.ts`; Test `src/domain/disponibilidad.test.ts`
**Interfaces:** Consumes `Tramo`, `Fila`. Produces:
```ts
export function libresTramo(t: Tramo): number;      // reservado → 0; publico → capacidad - ocupados
export function capacidadPublicaFila(f: Fila): number;
export function ocupadosFila(f: Fila): number;      // solo tramos públicos
export function libresFila(f: Fila): number;
export function grupoMaxJuntoFila(f: Fila): number;
```

- [ ] **Step 1: Tests** con los valores del spec:
  - tramo reservado de 2 → `libresTramo` = 0.
  - fila `[pub 3 (1 ocupado)][res 2][pub 3 (0)]`: `libresFila` = 5, `capacidadPublicaFila` = 6, `ocupadosFila` = 1, `grupoMaxJuntoFila` = 3.
  - la misma fila con `fragmentada: true`: `grupoMaxJuntoFila` = 1; con 0 libres: 0.
  - fila de un solo tramo público de 8 con 3 ocupados: `grupoMaxJuntoFila` = 5.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar** las cinco funciones (grupo máximo = mayor `libresTramo` si no fragmentada; si fragmentada, `min(1, libresFila)`). **Step 4: Correr:** pasa. **Step 5: Commit** `feat: cálculo de disponibilidad por tramo`.

---

### Task 4: Sugerencia, resumen, fragmentación, pendientes, revisión

**Files:** Create `src/domain/sugerencia.ts`, `resumen.ts`, `fragmentacion.ts`, `pendientes.ts`, `revision.ts`; Test: un `.test.ts` por archivo.
**Interfaces:** Consumes Task 2–3. Produces:
```ts
export interface Ubicacion { filaId: number; tramoId: number }
export function sugerirUbicacion(filas: Fila[], cantidad: number): Ubicacion | null;
export function colocarVirtual(filas: Fila[], u: Ubicacion, cantidad: number): Fila[];
export interface ResumenSeccion { libres: number; grupoMaxJunto: number }
export function resumenSeccion(filas: Fila[], pendientes: Pendiente[]): ResumenSeccion;
export const UMBRAL_FRAGMENTACION = 4;
export function fragmentaTrasLevantarse(f: Fila): boolean;
export const UMBRAL_AMBAR_MS = 180_000;
export function calcularOffset(serverNowIso: string, clienteInicioMs: number, clienteFinMs: number): number;
export function ahoraServidor(relojLocalMs: number, offsetMs: number): number;
export function pendienteEsAmbar(p: Pendiente, ahoraServidorMs: number): boolean;
export function ordenarParaRevision(filas: Fila[], ahoraServidorMs: number): Fila[];
```
Reglas: `sugerirUbicacion` recorre las filas por `numero` ascendente, salta las `fragmentada` si `cantidad > 1`, toma la primera con un tramo público de `libres ≥ cantidad` y dentro de ella el tramo de **menor** `libres` que alcance (empate: menor `orden`); `null` si no hay. `resumenSeccion`: `libres` = suma de `libresFila` − suma de `cantidad` de pendientes (mínimo 0); `grupoMaxJunto` = máximo `grupoMaxJuntoFila` tras **colocar virtualmente** cada pendiente (en orden de `creadoEn`) con `sugerirUbicacion`. `calcularOffset` = `serverEpoch + round(rtt/2) − clienteFin`. `ordenarParaRevision`: solo filas con ≥ 1 ocupado; primero las "casi llenas" (`ocupadosFila / capacidadPublicaFila ≥ 0.75`), luego por `verificadaEn` ascendente (`null` primero), luego por `numero`.

- [ ] **Step 1: Tests** (nombres y asserts clave):
  - `sugerirUbicacion` prefiere la fila 1 sobre la 2; salta una fila fragmentada para 2 pero no para 1; elige el tramo de menor sobrante (tramos de 3 libres y 5 libres, grupo de 3 → el de 3); devuelve `null` si nada alcanza.
  - `resumenSeccion`: 2 filas vacías de 8 y un pendiente de 3 → `libres` 13 y `grupoMaxJunto` 8; un pendiente de 8 → `libres` 8.
  - `fragmentaTrasLevantarse`: 4 ocupados → `true`; 3 → `false`.
  - `pendienteEsAmbar`: creado hace 179 999 ms → `false`; 180 000 ms → `true`.
  - **Reloj mal puesto:** con `relojLocalMs` adelantado 10 min y `offset = −600_000`, `ahoraServidor` devuelve la hora real y el pendiente de hace 1 min **no** es ámbar.
  - `calcularOffset` con RTT de 200 ms resta 100 ms.
  - `ordenarParaRevision`: una casi llena verificada hace 10 min va antes que una casi llena verificada hace 1 min, y las dos antes que una al 25 %.
  - **Review Focus 1:** sección con 3 libres sueltos (fila fragmentada de 8 con 5 ocupados) → `grupoMaxJunto` = 1.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar** los cinco archivos. **Step 4: Correr:** pasa. **Step 5: Commit** `feat: reglas puras de sugerencia, fragmentación y pendientes`.

---

### Task 5: Base de datos — evento, claves y limpieza

**Files:** Create `supabase/migrations/20261022000100_base.sql`, `supabase/tests/database/001_base.test.sql`
**Interfaces:** Produces (SQL): tablas `evento`, `sesion`, `sede`, `acceso`; `public.crear_evento(p_nombre text) returns jsonb` (`{evento_id, clave_ujier, clave_supervisor}`, `REVOKE EXECUTE` de `anon`/`authenticated`); `private.evento_de_clave(p_clave text, p_supervisor boolean default false) returns uuid` que lanza la excepción `CLAVE_INVALIDA`.

- [ ] **Step 1: Test pgTAP** `001_base.test.sql`:
  - `crear_evento('Prueba')` devuelve dos claves distintas y no vacías.
  - `private.evento_de_clave(clave_ujier)` devuelve el `evento_id`; con `p_supervisor := true` y la clave de ujier → `throws_ok(..., 'CLAVE_INVALIDA')`.
  - clave inexistente → `throws_ok 'CLAVE_INVALIDA'`.
  - como rol `anon`: `select * from acceso` falla o devuelve 0 filas; `crear_evento` → permiso denegado.
- [ ] **Step 2: Correr** `npm run test:db`: falla. **Step 3: Escribir la migración:** eliminar `envios_transito`, `filas` y las 12 funciones del `schema.sql` viejo (la app nunca se usó, no hay datos); crear las tablas (`sesion.evento_id` FK, `sesion.inicio_at timestamptz not null`; `sede.nombre text unique`); `acceso(evento_id pk, clave_ujier, clave_supervisor, rotada_en)` con RLS activada y **sin policies**; claves generadas con `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`.
- [ ] **Step 4: Correr:** pasa. **Step 5: Commit** `feat(db): evento, claves de acceso y limpieza del esquema viejo`.

---

### Task 6: Base de datos — salón, RLS y estado

**Files:** Create `supabase/migrations/20261022000200_salon.sql`, `supabase/tests/database/002_salon.test.sql`
**Interfaces:** Produces: tablas `fila(id, evento_id, seccion, numero, fragmentada, verificada_en)` con `unique(evento_id, seccion, numero)`; `tramo(id, fila_id on delete cascade, orden, tipo, capacidad > 0, ocupados check (ocupados >= 0 and ocupados <= capacidad), etiqueta)` con `unique(fila_id, orden)`; `pendiente(id uuid, evento_id, seccion, cantidad > 0, estado in ('pendiente','sentado','cancelado'), creado_en, resuelto_en)`; `registro(id, evento_id, tipo, detalle jsonb, creado_en)`; `private.aplicar_plantilla(p_evento uuid, p_plantilla jsonb) returns void`; `public.obtener_estado_salon(p_clave text) returns jsonb` → `{server_now, evento_id, filas: [{id, seccion, numero, fragmentada, verificada_en, tramos:[{id, orden, tipo, capacidad, ocupados, etiqueta}]}], pendientes: [{id, seccion, cantidad, creado_en}]}` (solo `estado = 'pendiente'`, orden por sección y número). Realtime: `fila`, `tramo` y `pendiente` en la publicación `supabase_realtime`, `REPLICA IDENTITY FULL`. RLS: `SELECT` abierto a `anon`; **sin** policies de escritura.

- [ ] **Step 1: Tests pgTAP:**
  - como `anon`, `insert`/`update`/`delete` directos sobre `fila`, `tramo` y `pendiente` fallan (`throws_ok ... '42501'` o 0 filas afectadas).
  - tras `private.aplicar_plantilla` con una plantilla de 1 fila `[pub 3][res 2 "Mamás"][pub 3]`: `obtener_estado_salon` devuelve esa fila con 3 tramos en orden y `server_now` no nulo.
  - `obtener_estado_salon('mala')` → `throws_ok 'CLAVE_INVALIDA'`.
  - `ocupados > capacidad` en un tramo viola el `check`.
- [ ] **Step 2: Correr:** falla. **Step 3: Escribir la migración** con las tablas, índices por `(fila_id)` y `(evento_id, estado)`, RLS, realtime, `aplicar_plantilla` y `obtener_estado_salon`. **Step 4: Correr:** pasa. **Step 5: Commit** `feat(db): tablas del salón, RLS de solo lectura y estado`.

---

### Task 7: RPC del flujo Puerta → Sección

**Files:** Create `supabase/migrations/20261022000300_flujo.sql`, `supabase/tests/database/003_flujo.test.sql`
**Interfaces:** Produces (todas `SECURITY DEFINER`, devuelven `jsonb`):
- `mandar_grupo(p_clave text, p_seccion text, p_cantidad int)` → `{success:true, pendiente_id}` o `{success:false, error:'SECCION_SIN_CUPO', libres}` / `'CANTIDAD_INVALIDA'`. Toma `pg_advisory_xact_lock(hashtextextended(evento_id::text || p_seccion, 0))`. `libres` = Σ libres de tramos públicos de la sección − Σ `cantidad` de pendientes en estado `pendiente`.
- `sentar_pendiente(p_clave text, p_pendiente_id uuid, p_tramo_id bigint)` → `{success:true}` o error `'PENDIENTE_YA_RESUELTO' | 'SECCION_INCORRECTA' | 'TRAMO_SIN_CUPO' | 'TRAMO_RESERVADO'`. Suma `cantidad` al tramo, estado `sentado`, `fila.verificada_en = clock_timestamp()`, `fragmentada = false` si la fila queda sin libres, y registra en `registro` tipo `'confirmacion'` con `segundos`.
- `cancelar_pendiente(p_clave text, p_pendiente_id uuid)` → estado `cancelado`, registra `'no_llegaron'`.

- [ ] **Step 1: Tests pgTAP** (sección con 8 libres):
  - `mandar_grupo` 5 → éxito; otro 5 → `SECCION_SIN_CUPO`; luego 3 → éxito. **(Review Focus 2.)**
  - `cancelar_pendiente` del de 5 libera: un nuevo 5 vuelve a entrar.
  - **Nunca se libera solo:** poner `creado_en` de un pendiente 10 minutos atrás (como superusuario); sigue contando en `libres`.
  - `sentar_pendiente` en un tramo con cupo suma `ocupados`, deja el pendiente en `sentado` y escribe el registro; repetirlo → `PENDIENTE_YA_RESUELTO`.
  - sentar un grupo de 3 en un tramo con 2 libres → `TRAMO_SIN_CUPO` y nada cambia; en un tramo `reservado` → `TRAMO_RESERVADO`.
  - sentar un pendiente de `centro` en una fila de `izquierda` → `SECCION_INCORRECTA`.
  - cada función con clave inválida → `CLAVE_INVALIDA`.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar** las tres RPC (bloqueo del tramo con `FOR UPDATE` en `sentar_pendiente`). **Step 4: Correr:** pasa. **Step 5: Commit** `feat(db): RPC de mandar, sentar y cancelar grupos`.

---

### Task 8: RPC de correcciones

**Files:** Create `supabase/migrations/20261022000400_correcciones.sql`, `supabase/tests/database/004_correcciones.test.sql`
**Interfaces:** Produces (`jsonb`):
- `se_levanto(p_clave text, p_tramo_id bigint)` → resta 1; si `ocupadosFila` **antes** de restar ≥ 4 → `fragmentada = true`. Errores `'TRAMO_VACIO' | 'TRAMO_RESERVADO'`. Registra `'se_levanto'`.
- `corregir_conteo(p_clave text, p_tramo_id bigint, p_libres_vistos int)` → `ocupados = capacidad − libres`; **no** toca `fragmentada`; actualiza `verificada_en`; error `'RANGO_INVALIDO'` fuera de `0..capacidad`; registra `'correccion'` con valores antes/después.
- `juntar_fila(p_clave text, p_fila_id bigint)` → `fragmentada = false`.
- `verificar_fila(p_clave text, p_fila_id bigint)` → solo `verificada_en = clock_timestamp()`.
- `agregar_fila_al_fondo(p_clave text, p_seccion text, p_capacidad int default 8)` → nueva fila con `numero = max + 1` y un único tramo público; devuelve `{success, fila_id}`.

- [ ] **Step 1: Tests pgTAP:** fila con 4 ocupados + `se_levanto` → `fragmentada = true`; con 3 → `false`; `corregir_conteo` en fila de 4 ocupados no cambia `fragmentada`; `RANGO_INVALIDO` con `p_libres_vistos = capacidad + 1`; `se_levanto` en tramo con 0 → `TRAMO_VACIO`; en `reservado` → `TRAMO_RESERVADO`; `juntar_fila` apaga la marca; `agregar_fila_al_fondo` en una sección con filas 1..15 crea la 16; todas rechazan clave inválida.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar.** **Step 4: Correr:** pasa. **Step 5: Commit** `feat(db): RPC de correcciones y verificación de filas`.

---

### Task 9: RPC de supervisor

**Files:** Create `supabase/migrations/20261022000500_supervisor.sql`, `supabase/tests/database/005_supervisor.test.sql`
**Interfaces:** Produces (exigen clave de supervisor; una clave de ujier → `CLAVE_INVALIDA`):
- `reiniciar_salon(p_clave text, p_seccion text default null)` → `ocupados = 0`, `fragmentada = false`, pendientes en `cancelado`; **conserva** tramos y reservas fijas.
- `aplicar_plantilla(p_clave text, p_plantilla jsonb)` → reemplaza todas las filas y tramos del evento y cancela los pendientes.
- `regenerar_claves(p_clave text)` → `{clave_ujier, clave_supervisor}` nuevas; las anteriores dejan de servir.
- `modificar_capacidad_tramo(p_clave text, p_tramo_id bigint, p_capacidad int)` → ajusta `ocupados = least(ocupados, capacidad)`.

- [ ] **Step 1: Tests pgTAP:** `reiniciar_salon` deja los tramos reservados y las capacidades intactos y los ocupados en 0; una clave de ujier es rechazada en las cuatro; tras `regenerar_claves` la clave vieja da `CLAVE_INVALIDA` en `obtener_estado_salon` y la nueva funciona **(Review Focus 5, lado servidor)**; `modificar_capacidad_tramo` de 8 a 7 con 8 ocupados deja `ocupados = 7`; `aplicar_plantilla` deja exactamente las filas de la plantilla dada.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar.** **Step 4: Correr** `npm run test:db`: pasan todos los archivos. **Step 5: Commit** `feat(db): RPC de supervisor`.

---

### Task 10: Store con reversión por entidad

**Files:** Create `src/state/salonReducer.ts`; Test `src/state/salonReducer.test.ts`
**Interfaces:** Consumes tipos de Task 2 y reglas de Task 3–4. Produces:
```ts
export interface SalonState { filas: Record<number, Fila>; pendientes: Record<string, Pendiente>; offsetMs: number; cargado: boolean }
export type Mutacion =
  | { tipo: 'mandar'; pendienteTmpId: string; seccion: Seccion; cantidad: number; creadoEn: string }
  | { tipo: 'sentar'; pendienteId: string; tramoId: number }
  | { tipo: 'noLlegaron'; pendienteId: string }
  | { tipo: 'seLevanto'; tramoId: number }
  | { tipo: 'corregir'; tramoId: number; libresVistos: number }
  | { tipo: 'juntar'; filaId: number };
export interface Reversion { filas: Fila[]; pendientes: Array<{ id: string; previo: Pendiente | null }> }
export function aplicarMutacion(s: SalonState, m: Mutacion): { ok: true; state: SalonState; reversion: Reversion } | { ok: false; error: string };
export function revertir(s: SalonState, r: Reversion): SalonState;
export type SalonAction =
  | { type: 'cargar'; estado: EstadoSalon; offsetMs: number }
  | { type: 'reemplazar'; state: SalonState }
  | { type: 'filaRemota'; fila: Fila }
  | { type: 'filaEliminada'; filaId: number }
  | { type: 'pendienteRemoto'; pendiente: Pendiente }
  | { type: 'pendienteQuitado'; pendienteId: string };
export function salonReducer(s: SalonState, a: SalonAction): SalonState;
export const estadoInicial: SalonState;
```
`aplicarMutacion` es **pura y valida sobre el estado actual** (no dentro de un updater de React), así que la validez se conoce antes de despachar (resuelve el bug 2 del spec).

- [ ] **Step 1: Tests:**
  - `mandar` con cupo agrega un pendiente temporal; sin cupo → `{ok:false}`.
  - `sentar` suma `ocupados` al tramo y quita el pendiente; en un tramo sin cupo → `{ok:false}` y el estado no cambia.
  - `seLevanto` en fila con 4 ocupados → `fragmentada: true`; con 3 → `false`.
  - **Review Focus 3:** con dos filas A y B, aplicar `seLevanto` en A, luego `filaRemota` con B actualizada por otro ujier, luego `revertir` la reversión de A → B conserva el cambio remoto y A vuelve a su valor previo.
  - `corregir` no cambia `fragmentada`; `juntar` la apaga.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar.** **Step 4: Correr:** pasa. **Step 5: Commit** `feat: store con mutaciones optimistas y reversión por entidad`.

---

### Task 11: Capa de sincronización y RPC cliente

**Files:** Create `src/lib/supabase.ts`, `src/lib/rpc.ts`, `src/lib/acceso.ts`, `src/state/sync.ts`; Modify `src/utils/audio.ts`; Test `src/lib/rpc.test.ts`, `src/lib/acceso.test.ts`, `src/state/sync.test.ts`, `src/utils/audio.test.ts`
**Interfaces:** Consumes Task 10. Produces:
```ts
// rpc.ts
export class ClaveInvalidaError extends Error {}
export type ResultadoRpc = { success: true; [k: string]: unknown } | { success: false; error: string };
export function llamarRpc(nombre: string, params: Record<string, unknown>): Promise<ResultadoRpc>; // mapea el error CLAVE_INVALIDA a ClaveInvalidaError
// acceso.ts
export function guardarAcceso(clave: string, rol: Rol): void;
export function leerAcceso(): { clave: string; rol: Rol } | null;
export function armarEnlace(origen: string, clave: string, rol: Rol): string; // `${origen}/entrar?k=...&rol=...`
// sync.ts
export function decidirRemoto(filaId: number, enVuelo: ReadonlySet<number>): 'aplicar' | 'diferir';
export interface SalonSync { iniciar(): Promise<void>; detener(): void; resync(): Promise<void>; ejecutar(m: Mutacion): Promise<{ ok: boolean; error?: string }> }
export function crearSalonSync(deps: { clave: string; getState(): SalonState; dispatch(a: SalonAction): void; onError(msg: string): void; onClaveInvalida(): void; onConexion(s: 'connected' | 'reconnecting' | 'offline'): void }): SalonSync;
// audio.ts
export function setSonidoHabilitado(v: boolean): void;
```
`ejecutar`: valida con `aplicarMutacion`; si `ok`, despacha `reemplazar`, marca la fila en vuelo, llama a la RPC correspondiente; si falla, despacha `reemplazar(revertir(...))`, llama a `onError` y pide `resync`. Los updates remotos de una fila en vuelo se **difieren** y, al terminar la mutación, se hace `resync` (bug 4). `resync` en `visibilitychange`, `online` y al reconectar el canal.

- [ ] **Step 1: Tests:**
  - `llamarRpc` convierte un error de PostgREST con mensaje `CLAVE_INVALIDA` en `ClaveInvalidaError`; una respuesta `{success:false,error:'SECCION_SIN_CUPO'}` se devuelve tal cual.
  - `leerAcceso` devuelve `null` sin datos; `guardarAcceso` + `leerAcceso` ida y vuelta; `armarEnlace` produce `/entrar?k=<clave>&rol=centro`.
  - `decidirRemoto(5, new Set([5]))` = `'diferir'`; `(6, new Set([5]))` = `'aplicar'`.
  - `sync` con RPC mockeada: una mutación fallida revierte solo esa entidad y llama a `onError`; **Review Focus 5:** una `ClaveInvalidaError` llama a `onClaveInvalida` **una sola vez** y no reintenta.
  - una actualización remota de una fila en vuelo no se aplica, y tras terminar la mutación se llama a `resync` una vez.
  - **Bug 1:** con `setSonidoHabilitado(false)`, `playClickSound()` no crea ningún `AudioContext`.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar.** `supabase.ts` crea el cliente con `persistSession: false`; el store de acceso usa `sessionStorage` dentro de `try/catch`. **Step 4: Correr:** pasa. **Step 5: Commit** `feat: capa de sincronización, RPC cliente y control de sonido`.

---

### Task 12: Provider y vistas derivadas

**Files:** Create `src/state/derivar.ts`, `src/state/SalonProvider.tsx`; Test `src/state/derivar.test.ts`, `src/state/SalonProvider.test.tsx`
**Interfaces:** Consumes Task 4, 10, 11. Produces:
```ts
export interface FilaVista { fila: Fila; libres: number; grupoMaxJunto: number; estaLlena: boolean }
export interface PendienteVista { pendiente: Pendiente; ambar: boolean }
export interface SalonDerivado {
  filasPorSeccion: Record<Seccion, FilaVista[]>;
  resumenPorSeccion: Record<Seccion, ResumenSeccion>;
  pendientesPorSeccion: Record<Seccion, PendienteVista[]>;
  ocupacion: { ocupados: number; capacidad: number; porcentaje: number };
}
export function derivarSalon(s: SalonState, ahoraLocalMs: number): SalonDerivado;
// SalonProvider.tsx
export function SalonProvider(props: { children: React.ReactNode }): JSX.Element;
export function useSalon(): { derivado: SalonDerivado; filas: Record<number, Fila>; conexion: 'connected' | 'reconnecting' | 'offline'; error: string | null; claveInvalida: boolean; cargando: boolean; acciones: SalonAcciones; limpiarError(): void };
export interface SalonAcciones { mandar(seccion: Seccion, cantidad: number): Promise<{ ok: boolean; error?: string }>; sentar(pendienteId: string, tramoId: number): Promise<boolean>; noLlegaron(pendienteId: string): Promise<boolean>; seLevanto(tramoId: number): Promise<boolean>; corregir(tramoId: number, libresVistos: number): Promise<boolean>; juntar(filaId: number): Promise<boolean>; verificar(filaId: number): Promise<boolean>; agregarFila(seccion: Seccion): Promise<boolean> }
export function useTick(activo: boolean, intervaloMs?: number): number; // ahora local en ms; solo corre si activo
```
`FilaVista` depende **solo** de la `Fila` (no del tiempo), con caché por referencia de `Fila`: el tick de 1 s solo recalcula `pendientesPorSeccion`. El tick solo se activa si hay pendientes.

- [ ] **Step 1: Tests:** `derivarSalon` dos veces con el mismo estado y `ahoraLocalMs` distinto devuelve el **mismo objeto** `FilaVista` por fila (`toBe`); cambiar una sola fila solo renueva la `FilaVista` de esa fila; `ambar` pasa a `true` al superar 180 000 ms y respeta el offset del estado **(Review Focus 4)**; `useTick(false)` no programa timers (con timers falsos de Vitest).
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar.** El provider lee la clave con `leerAcceso`, crea el `SalonSync`, y expone `claveInvalida` cuando `onClaveInvalida` se dispara. **Step 4: Correr:** pasa. **Step 5: Commit** `feat: provider del salón y vistas derivadas estables`.

---

### Task 13: Sistema de diseño cálido y primitivas

**Files:** Modify `src/app/globals.css`, `src/app/layout.tsx`; Create `public/manifest.json`, `public/icon-192.png`, `public/icon-512.png`, `src/components/ui/{Boton,Modal,Aviso,IndicadorConexion}.tsx`; Test `src/__tests__/sin-hex.test.ts`, `src/components/ui/Modal.test.tsx`, `src/components/ui/Boton.test.tsx`
**Interfaces:** Produces:
```ts
Boton(props: ButtonHTMLAttributes & { variante?: 'primario' | 'secundario' | 'peligro' | 'fantasma'; tamano?: 'normal' | 'grande'; etiqueta?: string })  // `etiqueta` → aria-label; obligatorio si no hay texto hijo
Modal(props: { abierto: boolean; onCerrar(): void; titulo: string; children: ReactNode })
Aviso(props: { mensaje: string | null; tipo?: 'error' | 'info'; onCerrar(): void })
IndicadorConexion(props: { estado: 'connected' | 'reconnecting' | 'offline'; sincronizando?: boolean; onReintentar(): void })
```
Tokens en un único `@theme` (nombres): `--color-fondo`, `--color-superficie`, `--color-superficie-alta`, `--color-borde`, `--color-texto`, `--color-texto-suave`, `--color-acento`, `--color-libre`, `--color-ocupado`, `--color-en-camino`, `--color-reservado-fijo`, `--color-reservado-alt`, `--color-advertencia`, `--color-peligro`. Valores base del mockup cálido: fondo `#14100d`, superficie `#1d1612`, superficie-alta `#2a1f17`, borde `#4a3b30`, texto `#f5ebe0`, texto-suave `#c9b29a`, acento `#d4a373`, libre `#a7c957`, en-camino `#c9824d`, reservado-fijo `#9b7bc4`, reservado-alt `#d98fb0`.

- [ ] **Step 1: Tests:**
  - `sin-hex.test.ts`: recorre `src/components/**/*.tsx` y `src/app/**/*.tsx` y afirma que **ninguno** contiene `/#[0-9a-fA-F]{3,8}\b/`.
  - `Modal`: al abrir, el foco entra al modal; `Tab` desde el último elemento vuelve al primero; `Escape` llama a `onCerrar`; al cerrar el foco vuelve al elemento que lo abrió.
  - `Boton`: con `etiqueta="Cerrar"` y sin texto, `getByRole('button', {name:'Cerrar'})` existe.
- [ ] **Step 2: Correr:** falla (el de hex falla por los componentes viejos: es esperado hasta Task 17). **Step 3: Implementar** tokens y fuentes (`next/font/google`: una serifa para títulos y una sans para el resto, a elección del constructor), `:focus-visible` global, `viewport` sin `userScalable:false`/`maximumScale`, `manifest.json` (nombre, `start_url:"/"`, `display:"standalone"`, íconos 192/512 generados desde `public/church-logo.png`), y las cuatro primitivas con `aria-hidden` en íconos decorativos. **Step 4: Correr** los tests de `ui/` (pasan) y la regla de hex con `--exclude` temporal de los componentes viejos hasta Task 17. **Step 5: Commit** `feat: sistema de diseño cálido, manifest y primitivas accesibles`.

---

### Task 14: Vista de la Puerta

**Files:** Create `src/components/puerta/PuertaView.tsx`; Test `src/components/puerta/PuertaView.test.tsx`
**Interfaces:** Consumes `ResumenSeccion`, `Seccion`. Produces:
```ts
PuertaView(props: {
  secciones: Record<Seccion, ResumenSeccion & { pendientes: number }>;
  modoPico: boolean;
  onMandar(seccion: Seccion, cantidad: number): Promise<{ ok: boolean; error?: string }>;
})
```

- [ ] **Step 1: Tests** (`// @vitest-environment jsdom`):
  - tamaño por defecto `2`; elegir `3` y tocar "Mandar 3 al Centro" llama `onMandar('centro', 3)` una vez.
  - **Review Focus 1:** con `grupoMaxJunto: 2` en `derecha` y tamaño 3, el botón de Derecha está deshabilitado y dice "No entran 3".
  - el botón `5+` manda `5`.
  - cada sección muestra "hasta N juntos · M libres" con números absolutos (sin `%`).
  - si `onMandar` devuelve `{ok:false,error}`, se muestra el error con `role="alert"`.
  - con `modoPico` en `true` no se muestra el contador de pendientes; en `false` sí.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar** con los tokens, botones ≥ 44 px de alto, vibración con `navigator.vibrate` protegida y `playSuccessSound` al mandar. **Step 4: Correr:** pasa. **Step 5: Commit** `feat: vista de la Puerta`.

---

### Task 15: Vista de la Sección

**Files:** Create `src/components/seccion/{SeccionView,PendienteCard,FilaItem,ElegirUbicacion}.tsx`; Test `src/components/seccion/SeccionView.test.tsx`
**Interfaces:** Consumes `FilaVista`, `PendienteVista`, `sugerirUbicacion`, `ordenarParaRevision`. Produces:
```ts
SeccionView(props: {
  seccion: Seccion; filas: FilaVista[]; pendientes: PendienteVista[]; ahoraServidorMs: number;
  onSentar(pendienteId: string, tramoId: number): Promise<boolean>;
  onNoLlegaron(pendienteId: string): Promise<boolean>;
  onSeLevanto(tramoId: number): Promise<boolean>;
  onCorregir(tramoId: number, libresVistos: number): Promise<boolean>;
  onJuntar(filaId: number): Promise<boolean>;
  onVerificar(filaId: number): Promise<boolean>;
  onAgregarFila(): Promise<boolean>;
})
```
Comportamiento: arriba, el primer pendiente con la fila sugerida; "Sentar en Fila X" es **un toque**; si la fila sugerida tiene varios tramos públicos, el botón nombra el tramo sugerido y "Otra fila…" abre `ElegirUbicacion`. Pendiente ámbar con texto "Falta confirmar". Abajo, "Mis filas" en el orden de `ordenarParaRevision` primero y el resto por número, con edad de verificación ("hace 12 min"), y los botones "Se levantó alguien" y "Corregir conteo" por fila.

- [ ] **Step 1: Tests:**
  - con un pendiente de 3 y filas vacías, el botón "Sentar en Fila 1" llama `onSentar(id, tramoDeLaFila1)` con **un** click.
  - fila 1 llena: sugiere la 2.
  - fila sugerida con dos tramos públicos: el botón incluye el nombre del tramo; "Otra fila…" abre el selector y elegir llama `onSentar` con el tramo elegido.
  - pendiente `ambar: true` muestra "Falta confirmar" (`role="status"`).
  - "No llegaron" llama `onNoLlegaron`.
  - "Se levantó alguien" llama `onSeLevanto(tramoId)`; en filas de un solo tramo no pide elegir tramo.
  - filas `fragmentada` muestran el aviso y "Juntos" llama `onJuntar`.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar** (botones de acción principal ≥ 48 px; las excepciones como botones grandes, no menús). **Step 4: Correr:** pasa. **Step 5: Commit** `feat: vista de la Sección`.

---

### Task 16: Rutas, acceso por QR y panel de supervisor

**Files:** Create `src/app/entrar/page.tsx`, `src/app/puerta/page.tsx`, `src/app/seccion/[seccion]/page.tsx`, `src/app/supervisor/page.tsx`, `src/components/supervisor/SupervisorPanel.tsx`; Modify `src/app/page.tsx`; Test `src/components/supervisor/SupervisorPanel.test.tsx`, `src/app/entrar/entrar.test.tsx`
**Interfaces:** Consumes `SalonProvider`, `armarEnlace`, `guardarAcceso`, `llamarRpc`. Produces:
```ts
SupervisorPanel(props: { claveUjier: string; claveSupervisor: string; origen: string; ocupacion: { ocupados: number; capacidad: number } })
```
Los enlaces de Puerta y Secciones usan `claveUjier`; el del supervisor usa `claveSupervisor`.
- `/entrar?k=…&rol=…`: guarda el acceso y redirige (`puerta`, `seccion/<x>` o `supervisor`); sin `k` o con `rol` inválido muestra un mensaje claro. Leer en la doc de Next 16 cómo usar `useSearchParams` (puede requerir `Suspense`).
- `/` explica "Escaneá el QR que te dio el supervisor"; no expone nada.
- Cada ruta de rol envuelve su vista en `SalonProvider`; si `claveInvalida`, muestra **"Pedí un QR nuevo"** y no intenta más **(Review Focus 5, lado UI)**.
- `SupervisorPanel`: QR (SVG con `qrcode`) y enlace copiable para Puerta, Izquierda, Centro y Derecha; "Vaciar auditorio" en dos pasos de confirmación (`reiniciar_salon`); "Aplicar plantilla" (`PLANTILLA_EJEMPLO` vía `aplicar_plantilla`, con confirmación); "Renovar claves" con confirmación que muestra los QR nuevos. El selector de modo pico vive en el header de la Puerta (persistido en `localStorage` dentro de `try/catch`).

- [ ] **Step 1: Tests:** `entrar`: con `k=abc&rol=centro` guarda el acceso y navega a `/seccion/centro`; con `rol=xyz` muestra el error y no navega. `SupervisorPanel`: renderiza 4 enlaces de ujier (Puerta, Izquierda, Centro, Derecha) que contienen `claveUjier`; "Vaciar auditorio" no llama a la RPC hasta la segunda confirmación; "Renovar claves" tras confirmar muestra enlaces con las claves nuevas.
- [ ] **Step 2: Correr:** falla. **Step 3: Implementar.** **Step 4: Correr:** pasa; `npm run build` pasa. **Step 5: Commit** `feat: rutas por rol, acceso por QR y panel de supervisor`.

---

### Task 17: Limpieza y verificación final

**Files:** Delete `src/hooks/useSupabaseUshers.ts`, `src/components/{AdminModal,FilaCard,HeaderGlobal,OrquestadorRadarView,PasilloView}.tsx`, `supabase/schema.sql`; Modify `PLAN.md` (nota de que el diseño vigente es el del spec), `README` si existe.

- [ ] **Step 1:** Borrar los archivos viejos; `grep -r "useSupabaseUshers\|FilaCard\|PasilloView" src` no devuelve nada.
- [ ] **Step 2:** Quitar la exclusión temporal de `sin-hex.test.ts`; debe pasar sin excepciones.
- [ ] **Step 3: Verificar todo:** `npm run lint`, `npm test`, `npm run test:db`, `npm run build`: los cuatro pasan. Copiar la salida en el mensaje final.
- [ ] **Step 4: Prueba manual en celular** (dos teléfonos o dos pestañas): mandar un grupo desde la Puerta, ver el aviso en la Sección, esperar el ámbar a los 3 minutos, confirmar, renovar claves y comprobar "Pedí un QR nuevo".
- [ ] **Step 5: Commit** `chore: eliminar código viejo y verificar la Etapa 1`.

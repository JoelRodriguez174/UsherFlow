# UsherFlow Etapa 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reparto del salón por sede: la persona central carga sesiones y reservas (`sede + sección + sesión + cantidad`) en Supervisor, la Puerta etiqueta cada grupo con su sede y la app aparta esos lugares hasta 20 minutos antes de cada sesión.

**Architecture:** El servidor sigue siendo la fuente de verdad. Una migración nueva agrega `reserva`, `sesion.nombre`, `evento.liberacion_min` y `sede_id`/`sesion_id` en `pendiente`, y cambia `mandar_grupo` para que descuente los lugares apartados con el mismo advisory lock por sección. `obtener_estado_salon` expone la sesión en curso y sus reservas. El cliente replica las cuentas en una función pura de dominio (`src/domain/sedes.ts`), y la Puerta, la Sección y Supervisor las consumen a través del estado derivado de siempre.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, Supabase (Postgres, Realtime, RPC plpgsql), Vitest + Testing Library, pgTAP (`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-22-usherflow-etapa-2-design.md` (leer entero; las cuentas de §4 son obligatorias). Contexto: `docs/superpowers/specs/2026-10-22-usherflow-rediseno-y-reservas-design.md` y el plan de la Etapa 1 `docs/superpowers/plans/2026-10-22-usherflow-etapa-1.md`. Mockup de la Puerta: `.superpowers/brainstorm/544-1792703757/content/puerta-con-sedes.html` (opción A).

## Global Constraints

- **Sin git:** no hacer `git init` ni commits. Cada tarea termina cuando sus tests pasan.
- Next 16: leer `node_modules/next/dist/docs/` antes de escribir código de Next (`AGENTS.md`).
- Migraciones nuevas en `supabase/migrations/` (no editar las de la Etapa 1). RPC `SECURITY DEFINER`, `set search_path = ''`, clave validada con `private.evento_de_clave` en cada llamada (`p_supervisor := true` para las de Supervisor). RLS sin policies de escritura. `revoke` de `public, anon, authenticated` y `grant execute` a `anon, authenticated`, como en las migraciones existentes.
- Errores esperados como `{success:false, error:CODE}`; la clave inválida se lanza (`CLAVE_INVALIDA`).
- Hora siempre del servidor (`clock_timestamp()` en SQL; `ahoraServidor(...)` en el cliente). Zona `America/Argentina/Buenos_Aires` para mostrar y cargar horas.
- Valores fijos: liberación por defecto **20** minutos (`evento.liberacion_min`, rango 0–180). Sesión en curso: la primera sesión del evento, ordenada por `inicio_at`, con `inicio_at > ahora − interval '3 hours'`.
- Las cuentas de spec §4, sin cambios: `apartado(sede) = max(reserva − consumido, 0)` antes de `libera_at` y 0 después; `consumido` = pendientes de esa sede, sesión y sección con estado `pendiente` o `sentado`.
- UI en español rioplatense, sin hex en `src/components` ni en `src/app/**/*.tsx` (solo tokens del `@theme`), chips como `button` con `aria-pressed`, inputs ≥ 16 px, foco visible, sin dependencias nuevas.
- Textos fijos: botón `Mandar {n} de {Sede} {destino}` (destino como hoy: "al Centro", "a la Izquierda"); chip completo `{Sede} (completo)`; etiqueta `{Sede}: quedan {n}`; pendiente `{n} de {Sede}`; resumen de sección `{Sede} {consumido}/{reserva}` separados por ` · `.

## Decisiones de este plan (mías; no estaban en el spec)

- **Carga manual = mismo RPC que el CSV.** La tabla manual de una sesión se guarda mandando todas sus filas a `importar_reservas`, que reemplaza las reservas de las sesiones incluidas. Hay un solo camino de validación.
- **Vista previa** = `importar_reservas(..., p_simular := true)`: valida igual y devuelve el mismo resultado sin escribir.
- **Consumido en el cliente:** el servidor manda `sentados` por reserva; el cliente le suma sus pendientes vivos. Cuando un pendiente con sede pasa a `sentado` (localmente o por realtime), el cliente **pide un resync** en lugar de llevar su propio contador. Mientras llega, el número aparta de más, nunca de menos, así que no hay sobreventa. Igual el servidor siempre decide.
- `reserva` y `sesion` entran en la publicación realtime. Cualquier cambio dispara un resync (cambian muy poco y solo los toca Supervisor).
- `sesion.nombre` es único por evento, y el CSV identifica la sesión por nombre, sin distinguir mayúsculas ni acentos.
- La sección se normaliza en el CSV: `Centro`, `CENTRO` y ` centro ` valen `centro`.

## Review Focus

1. **La hora de liberación llega con la Puerta abierta**: sin recargar, los chips dejan de apartar y "libres" sube. → Task 4 (test con `ahoraMs` antes y después de `liberaAt`).
2. **Supervisor importa un CSV mientras las Puertas están abiertas**: las otras pantallas ven las reservas nuevas. → Task 4 (cambio realtime en `reserva` → resync).
3. **CSV exportado por Excel en español**: separador `;`, BOM, acentos (`Catán`), nombre entre comillas con coma (`"Lomas, Sur"`), líneas vacías al final, `Centro` con mayúscula. → Task 3.
4. **A una sede le quedan 2 y llegan 3**, y **"Sin sede" cuando todo está apartado**: el cliente y el servidor dan el mismo resultado. → Task 1 (pgTAP) y Task 2 (Vitest) con los mismos números.
5. **Evento sin sesiones, o después de la última**: no aparecen chips, todo funciona como en la Etapa 1 y `mandar_grupo` sin sede no cambia. → Task 1 y Task 5.

---

## File Structure

```
supabase/migrations/20261023000100_sedes.sql        esquema + sesión en curso + apartado + mandar_grupo + estado
supabase/migrations/20261023000200_reservas_supervisor.sql   RPC de Supervisor
supabase/tests/database/006_sedes.test.sql
supabase/tests/database/007_reservas_supervisor.test.sql
src/domain/sedes.ts (+ .test.ts)        tipos Reserva/SesionEnCurso, apartado, quedan, apartarDelFondo
src/domain/resumen.ts                   resumenSeccion recibe `apartado`
src/lib/csv.ts (+ .test.ts)             parsearReservasCsv
src/lib/rpc.ts                          tipos crudos y mapeo de sesión/reservas/sede del pendiente
src/state/salonReducer.ts, derivar.ts, sync.ts, SalonProvider.tsx
src/components/puerta/PuertaView.tsx (+ test)
src/components/seccion/PendienteCard.tsx, SeccionView.tsx (+ test)
src/components/supervisor/ReservasPanel.tsx (+ test)
src/components/paginas/SupervisorPagina.tsx
```

---

### Task 1: Base de datos — esquema, sesión en curso y `mandar_grupo` con sede

**Files:** Create `supabase/migrations/20261023000100_sedes.sql`, `supabase/tests/database/006_sedes.test.sql`. Read `20261022000300_flujo.sql` (patrón de lock y cálculo en una sentencia) y `20261022000200_salon.sql` (`obtener_estado_salon`).

**Interfaces:**
- Produces (SQL):
  - `sesion.nombre text not null` + `unique(evento_id, nombre)`. Las tablas están vacías, no hace falta default.
  - `evento.liberacion_min integer not null default 20 check (liberacion_min between 0 and 180)`.
  - `reserva(id bigint identity pk, sesion_id uuid fk sesion on delete cascade, sede_id uuid fk sede, seccion text check in (...), cantidad integer check > 0, unique(sesion_id, sede_id, seccion))`. RLS activada, sin policies, en la publicación `supabase_realtime` con `REPLICA IDENTITY FULL`. `sesion` también entra en la publicación.
  - `pendiente.sede_id uuid null references sede`, `pendiente.sesion_id uuid null references sesion on delete set null`.
  - `private.sesion_en_curso(p_evento uuid) returns uuid` (la regla de Global Constraints; null si no hay).
  - `private.apartado(p_evento uuid, p_seccion text, p_excluir_sede uuid) returns integer`: Σ apartado de las sedes de esa sección en la sesión en curso, excluyendo `p_excluir_sede` (null = ninguna). Vale 0 si no hay sesión o si `clock_timestamp() >= inicio_at − liberacion_min minutos`.
  - `drop function public.mandar_grupo(text, text, integer)` y `create public.mandar_grupo(p_clave text, p_seccion text, p_cantidad integer, p_sede uuid default null)`. Mismo orden de validación; agrega `SEDE_INVALIDA` si `p_sede` no existe en `sede`. Cupo = libres actuales − `private.apartado(evento, seccion, p_sede)`, calculado dentro del lock. Inserta `sede_id = p_sede` y `sesion_id = private.sesion_en_curso(evento)`.
  - `obtener_estado_salon` agrega `sesion: {id, nombre, inicio_at, libera_at} | null` y `reservas: [{sede_id, sede, seccion, cantidad, sentados}]` de la sesión en curso, donde `sentados` es Σ pendientes `sentado` de esa sede, sección y sesión. Cada pendiente suma `sede_id`.

- [ ] **Step 1: Tests pgTAP** en `006_sedes.test.sql`. Base: un evento, el centro con 10 libres públicos, una sesión "Sábado tarde" con `inicio_at = now() + 2 h` y reservas Catán centro 6 y Lomas centro 2.
  - `mandar_grupo(clave,'centro',3)` sin sede → `SECCION_SIN_CUPO` con `libres = 2` (10 − 6 − 2). Con 2 → éxito.
  - Con Catán y 6 → éxito: no descuenta el apartado de Catán, solo el de Lomas.
  - **Review Focus 4:** después de mandar 4 de Catán, a Catán le quedan 2 apartados. Llegan 3 de Catán → éxito si los libres alcanzan (10 − 4 − 2 de Lomas = 4 ≥ 3). Luego, sin sede, `libres` = 10 − 7 − 2 = 1.
  - `cancelar_pendiente` de un grupo de Catán vuelve a apartarle esos lugares. Uno `sentado` sigue contando.
  - Con `inicio_at = now() + 10 min` (dentro de los 20 de liberación), `mandar_grupo` sin sede ve los 10 libres.
  - Los pendientes de Catán de **otra** sesión no cuentan como consumido.
  - **Review Focus 5:** sin sesiones (o con la única sesión 4 h en el pasado), `sesion_en_curso` es null, `obtener_estado_salon` trae `sesion: null` y `reservas: []`, y `mandar_grupo` funciona como en la Etapa 1.
  - Dos sesiones (mañana `now() − 1 h`, tarde `now() + 5 h`) → en curso, la de la mañana. Con mañana a `now() − 4 h` → la de la tarde.
  - `p_sede` inexistente → `SEDE_INVALIDA`. Clave inválida → `CLAVE_INVALIDA`.
  - `obtener_estado_salon` devuelve `libera_at = inicio_at − 20 min`, la reserva de Catán con `sentados` correcto y `sede_id` en los pendientes.
- [ ] **Step 2: Correr** `npm run test:db`. Esperado: falla en 006 y los 001–005 siguen pasando. Si 003 llama a `mandar_grupo` con 3 argumentos, sigue funcionando por el default.
- [ ] **Step 3: Escribir la migración.**
- [ ] **Step 4: Correr** `npm run test:db`. Esperado: pasan 001–006.

---

### Task 2: Dominio — cuentas de sede

**Files:** Create `src/domain/sedes.ts`, `src/domain/sedes.test.ts`. Modify `src/domain/resumen.ts` y su test, `src/domain/types.ts`.

**Interfaces:**
- Produces in `types.ts`: `Pendiente` suma `sedeId: string | null`. `EstadoSalon` suma `sesion: SesionEnCurso | null` y `reservas: Reserva[]`.
- Produces in `sedes.ts`:
  - `interface SesionEnCurso { id: string; nombre: string; inicioAt: string; liberaAt: string }`
  - `interface Reserva { sedeId: string; sede: string; seccion: Seccion; cantidad: number; sentados: number }`
  - `consumido(r: Reserva, pendientes: Pendiente[]): number`: `r.sentados` + Σ pendientes con la misma `sedeId` y `seccion`.
  - `liberada(sesion: SesionEnCurso | null, ahoraMs: number): boolean`: true si no hay sesión o si `ahoraMs >= Date.parse(liberaAt)`.
  - `apartado(reservas, pendientes, seccion, sesion, ahoraMs, excluirSedeId: string | null): number`
  - `quedan(r: Reserva, pendientes): number` = `max(r.cantidad − consumido, 0)`.
  - `apartarDelFondo(filas: Fila[], n: number): Fila[]`: copia en la que se suman `n` ocupados virtuales a los tramos públicos empezando por la fila de número más alto (la del fondo). No muta la entrada.
- Modifies: `resumenSeccion(filas, pendientes, apartadoLugares = 0)`: `libres = max(0, brutos − enCamino − apartadoLugares)`. El grupo máximo junto se calcula sobre `apartarDelFondo` **después** de colocar los pendientes. El valor por defecto mantiene los tests actuales.

- [ ] **Step 1: Tests** en `sedes.test.ts`, con los mismos números que la Task 1 (Review Focus 4): sección de 10 libres, Catán 6 y Lomas 2.
  - `apartado(..., null)` = 8; excluyendo Catán = 2.
  - Con pendientes de Catán por 4: `quedan(Catán)` = 2. Con 3 más: `quedan` = 0 (nunca negativo) y `apartado(..., null)` = 2.
  - `liberada` con `ahoraMs` 1 ms antes de `liberaAt` → false; justo en `liberaAt` → true. Con `sesion = null` → true y `apartado` = 0.
  - `apartarDelFondo` con filas 1–3 de 8 libres y n = 10 llena la fila 3 y deja 6 libres en la 2; la entrada queda igual (referencias).
  - `resumenSeccion(filas, [], 10)` con esas filas: `libres` = 14 y `grupoMaxJunto` = 8 (la fila 1 sigue entera).
- [ ] **Step 2: Correr** `npx vitest run src/domain`. Esperado: falla.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** `npx vitest run src/domain`. Esperado: pasa, incluidos los tests viejos de `resumen`.

---

### Task 3: Parser de CSV

**Files:** Create `src/lib/csv.ts`, `src/lib/csv.test.ts`.

**Interfaces:**
- Produces: `interface FilaReserva { sede: string; seccion: Seccion; sesion: string; cantidad: number }` y `parsearReservasCsv(texto: string): { filas: FilaReserva[]; errores: Array<{ linea: number; motivo: string }> }`.
  - El separador sale de la línea de encabezado: `;` si aparece fuera de comillas; si no, `,`.
  - Admite comillas dobles con `""` escapado, quita el BOM, ignora líneas vacías y hace `trim` de cada campo.
  - El encabezado debe tener `sede`, `seccion` (o `sección`), `sesion` (o `sesión`) y `cantidad`, en cualquier orden y sin distinguir mayúsculas. Si falta alguno → un error en la línea 1 y `filas: []`.
  - Motivos de error, textuales: `Sección inválida: {valor}`, `Cantidad inválida: {valor}` (debe ser un entero > 0), `Falta la sede`, `Falta la sesión`.

- [ ] **Step 1: Tests** (Review Focus 3):
  - `'\uFEFFsede;sección;sesión;cantidad\r\nCatán;Centro;Sábado tarde;120\r\n"Lomas, Sur";izquierda;Sábado tarde;40\r\n\r\n'` → 2 filas: `{sede:'Catán', seccion:'centro', sesion:'Sábado tarde', cantidad:120}` y `sede:'Lomas, Sur'`. Sin errores.
  - Versión con `,` y `"a ""b"""` → sede `a "b"`.
  - `Catán,arriba,Sábado tarde,10` → error en la línea 2 con `Sección inválida: arriba`. `…,0` y `…,1.5` → `Cantidad inválida`.
  - Sin la columna `cantidad` → un error en la línea 1 y ninguna fila.
- [ ] **Step 2: Correr** `npx vitest run src/lib/csv.test.ts`. Esperado: falla.
- [ ] **Step 3: Implementar** sin dependencias nuevas.
- [ ] **Step 4: Correr.** Esperado: pasa.

---

### Task 4: Estado del cliente — sesión, reservas y `mandar` con sede

**Files:** Modify `src/lib/rpc.ts`, `src/state/salonReducer.ts`, `src/state/derivar.ts`, `src/state/sync.ts`, `src/state/SalonProvider.tsx` y sus tests.

**Interfaces:**
- Consumes: Task 1 (forma de `obtener_estado_salon` y `mandar_grupo`) y Task 2 (`Reserva`, `SesionEnCurso`, `apartado`, `quedan`, `consumido`, `liberada`, `resumenSeccion(…, apartado)`).
- Produces:
  - `SalonState` suma `sesion: SesionEnCurso | null` y `reservas: Reserva[]` (en `estadoInicial`, `null` y `[]`). Se cargan con el estado completo.
  - `Mutacion 'mandar'` suma `sedeId: string | null`. La validación usa `resumenSeccion(filas, pendientes, apartado(reservas, pendientes, seccion, sesion, Date.parse(m.creadoEn), m.sedeId)).libres`, y el pendiente temporal lleva `sedeId`.
  - El mapeo de `mandar` en `sync.ts` manda `p_sede: m.sedeId`.
  - `SalonDerivado` suma:
    - `sedes: SedeVista[]`, con `interface SedeVista { sedeId: string; nombre: string; porSeccion: Partial<Record<Seccion, { cantidad: number; consumido: number; quedan: number }>>; completo: boolean }`. `completo` vale true si `quedan` es 0 en todas sus secciones. Va ordenado por nombre y vacío si `sesion === null`.
    - `liberado: boolean`.
    - `resumenParaSede(sedeId: string | null): Record<Seccion, ResumenSeccion>`.
    - `resumenPorSeccion` es `resumenParaSede(null)`.
    - Todo depende de `ahoraLocalMs` corregido por `offsetMs` (Review Focus 1). `derivar` ya recibe el tiempo; la caché de resumen tiene que invalidarse cuando cambia `liberado`.
  - `SalonAcciones.mandar(seccion, cantidad, sedeId: string | null = null)`.
  - `sync.ts`: se suscribe a `reserva` y `sesion` y pide un resync ante cualquier cambio (Review Focus 2). También pide un resync cuando llega un `pendiente` con `estado = 'sentado'` y `sede_id` no nulo, y cuando un `sentar` local de un pendiente con sede termina bien.

- [ ] **Step 1: Tests:**
  - Reducer: con las reservas de la Task 2, `mandar` sin sede de 3 → `SECCION_SIN_CUPO`; con `sedeId` de Catán de 6 → ok, y el pendiente queda con ese `sedeId`.
  - `derivarSalon` con `ahoraLocalMs` 1 min antes de `liberaAt` → `resumenPorSeccion.centro.libres` = 2 y `liberado` false. 1 min después → 10 y `liberado` true, con el **mismo** estado (Review Focus 1). `sedes` trae Catán con `porSeccion.centro.quedan` = 6.
  - `sesion: null` → `sedes` vacío y resumen igual al de la Etapa 1 (Review Focus 5).
  - `sync`: un evento realtime de la tabla `reserva` → una llamada nueva a `obtenerEstadoSalon`. Un `pendiente` UPDATE con `estado:'sentado'` y `sede_id` → resync; sin `sede_id` → no hay resync, se quita como hoy.
  - `estadoDesdeServidor` mapea `sesion`, `reservas` y `sede_id`.
- [ ] **Step 2: Correr** `npx vitest run src/state src/lib`. Esperado: fallan los nuevos.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** `npm test`. Esperado: pasa todo.

---

### Task 5: Puerta — chips de sede (opción A)

**Files:** Modify `src/components/puerta/PuertaView.tsx`, `PuertaView.test.tsx`, `src/components/paginas/PuertaPagina.tsx`.

**Interfaces:**
- Consumes: `SalonDerivado.sedes`, `resumenParaSede` y `mandar(seccion, cantidad, sedeId)` de la Task 4.
- Produces: `PuertaViewProps` suma `sedes: SedeVista[]` y `resumenParaSede`. `onMandar(seccion, cantidad, sedeId)`.

Comportamiento (spec §3.2):
- Fila de chips encima de "¿Cuántos son?": "Sin sede" (seleccionado por defecto) y una por cada `SedeVista`. Si `sedes` está vacío, no se muestra la fila.
- Con una sede elegida que no está `completo`, las secciones con reserva de esa sede se resaltan con la etiqueta `{Sede}: quedan {n}` y el botón `Mandar {n} de {Sede} {destino}`. Las demás secciones se atenúan pero siguen habilitadas según su resumen, y su botón también manda con la sede.
- Una sede `completo` muestra el chip `{Sede} (completo)`; elegirla manda con `sedeId = null`.
- Después de mandar, la sede elegida **se mantiene**, porque las tandas de una misma sede suelen llegar seguidas (decisión de este plan).

- [ ] **Step 1: Tests:**
  - sin sedes, no hay chips y el texto es el de siempre (Review Focus 5);
  - al tocar "Catán", `aria-pressed` pasa a true, aparece "Catán: quedan 42" y el botón "Mandar 3 de Catán al Centro" llama `onMandar('centro', 3, idCatan)`;
  - con una sede completa, el chip dice "Catán (completo)" y mandar usa `null`.
- [ ] **Step 2: Correr** `npx vitest run src/components/puerta`. Esperado: falla.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr.** Esperado: pasa.

---

### Task 6: Sección — sede en el pendiente y resumen de sedes

**Files:** Modify `src/components/seccion/PendienteCard.tsx`, `SeccionView.tsx`, `SeccionView.test.tsx`, `src/components/paginas/SeccionPagina.tsx`.

**Interfaces:**
- Consumes: `Pendiente.sedeId` y `SalonDerivado.sedes`.
- Produces: `SeccionViewProps` suma `sedes: SedeVista[]`.

- [ ] **Step 1: Tests:**
  - un pendiente de 3 con `sedeId` de Catán muestra "3 de Catán";
  - uno sin sede se ve como hoy;
  - en el centro, el resumen dice "Catán 78/120 · Tristán S. 30/50", solo con las sedes que tienen reserva en esa sección;
  - sin sedes, no hay resumen.
- [ ] **Step 2: Correr** `npx vitest run src/components/seccion`. Esperado: falla.
- [ ] **Step 3: Implementar.** El nombre de la sede sale de `sedes`; si no está, se muestra sin sede.
- [ ] **Step 4: Correr.** Esperado: pasa.

---

### Task 7: Base de datos — RPC de Supervisor para sesiones y reservas

**Files:** Create `supabase/migrations/20261023000200_reservas_supervisor.sql`, `supabase/tests/database/007_reservas_supervisor.test.sql`.

**Interfaces** (todas con clave de supervisor; con clave de ujier → `CLAVE_INVALIDA`):
- `guardar_sesion(p_clave text, p_nombre text, p_inicio_at timestamptz)` → `{success, sesion_id}`. Hace upsert por `(evento, nombre)`. Errores: `NOMBRE_INVALIDO` si el nombre queda vacío tras `btrim`.
- `borrar_sesion(p_clave text, p_sesion_id uuid)` → `{success}`. Borra sus reservas en cascada. Error: `SESION_INEXISTENTE`, también si la sesión es de otro evento.
- `guardar_liberacion(p_clave text, p_minutos integer)` → `{success}`. Error: `RANGO_INVALIDO` fuera de 0–180.
- `obtener_reservas(p_clave text)` → `{success, liberacion_min, sesiones: [{id, nombre, inicio_at, reservas: [{sede, seccion, cantidad}]}]}`, ordenadas por `inicio_at`.
- `importar_reservas(p_clave text, p_filas jsonb, p_simular boolean default false, p_sesiones text[] default null)`. `p_sesiones` lista sesiones a reemplazar aunque no tengan filas, así guardar la tabla manual vacía borra sus reservas:
  - `p_filas` es un arreglo de `{sede, seccion, sesion, cantidad}`.
  - Valida todo antes de escribir. Errores por fila (índice desde 1): sesión inexistente (match por nombre sin distinguir mayúsculas ni acentos, con `unaccent` si está disponible y, si no, `lower`), sección inválida, cantidad no entera > 0, `(sede, seccion, sesion)` repetida. También `Excede la capacidad de {seccion} en {sesion}: {suma} > {capacidad}` cuando la suma supera la capacidad pública total de esa sección.
  - Si hay errores → `{success:false, error:'RESERVAS_INVALIDAS', errores:[{fila, motivo}]}` y no escribe nada.
  - Si no hay errores → `{success:true, sedes_nuevas:[nombres], reservas: n}`. Con `p_simular = false`, en una sola transacción: crea las sedes que falten (match sin distinguir mayúsculas), borra las reservas de **las sesiones que aparecen** en `p_filas` o en `p_sesiones` e inserta las nuevas. Si una sesión de `p_sesiones` no existe, es un error con `fila: 0`. Con `p_simular = true` no escribe.
  - Un arreglo vacío es válido y no hace nada.

- [ ] **Step 1: Tests pgTAP:**
  - `guardar_sesion` dos veces con el mismo nombre → la misma `sesion_id` y el `inicio_at` actualizado;
  - `importar_reservas` con Catán (sede nueva) centro 6 → `sedes_nuevas = {Catán}`, y `obtener_reservas` lo muestra;
  - reimportar solo "Sábado tarde" deja intactas las reservas de "Sábado mañana";
  - una fila con `sesion` "sabado TARDE" matchea "Sábado tarde";
  - 2 filas válidas y 1 con sección inválida → `RESERVAS_INVALIDAS`, y no cambió nada;
  - superar la capacidad pública del centro → error con el motivo de capacidad;
  - `p_simular := true` devuelve éxito pero `obtener_reservas` sigue igual;
  - `importar_reservas('[]', p_sesiones := '{Sábado tarde}')` deja esa sesión sin reservas y no toca las otras;
  - `guardar_liberacion(181)` → `RANGO_INVALIDO`; con 30, `obtener_estado_salon.sesion.libera_at = inicio_at − 30 min`;
  - clave de ujier → `CLAVE_INVALIDA` en las cinco.
- [ ] **Step 2: Correr** `npm run test:db`. Esperado: falla 007.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** `npm run test:db`. Esperado: pasan 001–007.

---

### Task 8: Supervisor — pantalla de sesiones y reservas

**Files:** Create `src/components/supervisor/ReservasPanel.tsx`, `ReservasPanel.test.tsx`. Modify `src/components/paginas/SupervisorPagina.tsx` (montar el panel debajo de `SupervisorPanel`, con la misma clave guardada).

**Interfaces:**
- Consumes: las RPC de la Task 7 vía `llamarRpc`/`mensajeDeError` y `parsearReservasCsv` de la Task 3.
- Produces: `ReservasPanel({ clave }: { clave: string })`.

Comportamiento:
- **Sesiones:** lista (nombre e inicio en hora de Argentina), un formulario con nombre y `datetime-local` para agregar o actualizar, y un botón para borrar con confirmación (`Modal` existente).
- **Liberación:** campo numérico con los minutos y un botón Guardar.
- **Reservas por sesión:** tabla editable (sede, sección como `select`, cantidad). Permite agregar y quitar filas. "Guardar" manda todas las filas de esa sesión a `importar_reservas` con `p_simular = false` y `p_sesiones = [nombre de la sesión]`, así una tabla vacía borra sus reservas.
- **CSV:** `input type="file" accept=".csv,text/csv"`, que pasa por `parsearReservasCsv`. Si hay errores de parseo, se muestran por línea y no se llama al servidor. Si no, se llama a `importar_reservas(..., p_simular := true)` y se muestra la vista previa: cantidad de reservas, sedes nuevas, errores del servidor por fila y el botón "Confirmar importación" (`p_simular = false`). Al confirmar, se recarga `obtener_reservas`.
- Los mensajes de error usan `Aviso`, igual que el panel actual.

- [ ] **Step 1: Tests** con `llamarRpc` mockeado:
  - un archivo con una línea inválida muestra "Línea 3: Sección inválida: arriba" y no llama al RPC;
  - un archivo válido llama a `importar_reservas` con `p_simular: true`, muestra "Sedes nuevas: Catán", y al confirmar llama con `p_simular: false`;
  - guardar la tabla manual manda las filas de esa sesión.
- [ ] **Step 2: Correr** `npx vitest run src/components/supervisor`. Esperado: falla.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr.** Esperado: pasa.

---

### Task 9: Verificación final

- [ ] **Step 1:** `npm test`, `npm run test:db`, `npm run lint` y `npm run build`. Esperado: todo en verde, sin warnings nuevos de tipos.
- [ ] **Step 2:** `grep -rn "#[0-9a-fA-F]\{3,6\}" src/components src/app --include=*.tsx`. Esperado: sin resultados nuevos.
- [ ] **Step 3:** prueba manual local (ver la memoria del proyecto sobre `.env.development.local` y `npx next dev -H <IP LAN>`):
  1. En Supervisor, crear "Sábado tarde" para dentro de 1 h e importar un CSV con `;` que tenga 2 sedes.
  2. En la Puerta, elegir una sede y mandar un grupo. En la Sección, verlo como "N de Sede" y sentarlo. El resumen de la Sección sube.
  3. Cambiar la liberación para que la hora ya haya pasado y ver que los libres de la Puerta suben sin recargar.
- [ ] **Step 4:** actualizar `C:\Users\Enekon\.claude\projects\c--Users-Enekon\memory\usherflow-proyecto.md` con el estado de la Etapa 2.

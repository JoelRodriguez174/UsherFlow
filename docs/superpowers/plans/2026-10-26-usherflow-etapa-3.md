# UsherFlow Etapa 3 (mapa de preferencias por sector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los pastores de sede marcan en un mapa del salón (3 secciones × sectores por rango de filas) dónde prefieren sentarse; el supervisor reparte el cupo por sede y sector; Puerta y Sección usan esa asignación el día del evento.

**Architecture:** Un sector es un rango de filas dentro de una sección (tabla `sector`). La reserva de la Etapa 2 gana un `sector_id` opcional (vacío = toda la sección). El control de aforo de `mandar_grupo` sigue siendo por sección y sede; el sector solo se usa para informar y para marcar "fuera de sector" al sentar. Los pastores entran con una clave por sede (`acceso_sede`) y una pantalla `/sede` que consulta por polling.

**Tech Stack:** Next 16 / React 19 / Tailwind v4, Supabase (Postgres + RPC `SECURITY DEFINER` + pgTAP), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-25-usherflow-mapa-preferencias-design.md` (y la de la Etapa 2, `2026-10-22-usherflow-etapa-2-design.md`, §4 cuentas).

## Global Constraints

- Next 16: antes de escribir código de páginas/rutas leer `node_modules/next/dist/docs/` (`AGENTS.md`).
- Sin git: omitir todo paso de commit (la raíz git es `C:\Users\Enekon`, no usarla).
- Migraciones nuevas en `supabase/migrations/` con prefijo `20261026NNNN00_*.sql`, una por tarea de base. Nunca editar migraciones viejas. El clasificador frena `db push` a la nube: lo corre el usuario a mano; acá solo `npm run test:db` (necesita Docker).
- RPC `SECURITY DEFINER`, `set search_path = ''`, `revoke ... from public, anon, authenticated` y `grant execute ... to anon, authenticated` como en las migraciones existentes. Tablas con RLS, sin escritura para anon/authenticated.
- Errores esperados: `{success:false, error:CODE}`; clave inválida LANZA `CLAVE_INVALIDA` (`private.evento_de_clave`).
- Tiempo del servidor (`clock_timestamp()`), zona `America/Argentina/Buenos_Aires`.
- Los sectores cubren TODAS las filas de una sección, sin huecos ni solapes. Si no hay sectores definidos, todo funciona como en la Etapa 2.
- Accesibilidad: cada sector del mapa es un `button` con texto de estado además del color; foco visible; `aria-pressed` en la preferencia; botones de solo icono con `aria-label`. Mobile-first; inputs `font-size >= 16px`. Diseño "cálido": reutilizar los tokens de `src/app/globals.css` y los componentes de `src/components/ui/`.
- Textos de la interfaz en español rioplatense; nombres de código en español como el resto del repo.
- Reglas de la Etapa 2 que no cambian: "Corregir conteo" y "Se levantó alguien" no devuelven lugar a la sede; sede completa se comporta como "Sin sede".

## Review Focus

1. **Una sede con varios sectores en la misma sección** no debe restar su consumo dos veces al apartado (el `private.apartado` actual resta el consumo completo a cada fila de reserva). Test en Tarea 1.
2. **Fecha límite vencida o en el borde**: `guardar_preferencias` con `now() >= fecha_limite` se rechaza; sin fecha límite el mapa está abierto. Test en Tarea 3.
3. **Cortes de sectores con huecos, solapes o fuera del rango de filas** se rechazan, y se rechaza editarlos si hay reservas con sector. Test en Tarea 2.
4. **Aislamiento de claves:** la clave de la sede A no abre la B; una clave de ujier no sirve en RPC de pastor ni al revés; el pastor nunca ve preferencias ni cupos de otra sede. Test en Tarea 3.
5. **Evento sin sectores o sede sin ninguna asignación:** el mapa del pastor y Puerta muestran un estado vacío claro, sin romperse. Tests en Tareas 6 y 8.
6. **Sentar fuera del sector no descuenta de la asignación** ni rompe el conteo de la sección. Test en Tarea 5.

---

### Task 1: Esquema de sectores, preferencias y apartado por sede-sección

**Files:**
- Create: `supabase/migrations/20261026000100_sectores.sql`
- Test: `supabase/tests/database/009_sectores.test.sql`

**Interfaces:**
- Produces (tablas): `public.sector(id bigint identity, evento_id uuid, seccion text, nombre text, fila_desde int, fila_hasta int, orden int)` con `unique (evento_id, seccion, nombre)` y `check (fila_hasta >= fila_desde)`; `public.preferencia(sede_id uuid, sector_id bigint on delete cascade, primary key (sede_id, sector_id))`; `public.acceso_sede(evento_id uuid, sede_id uuid, clave text unique, primary key (evento_id, sede_id))`; `evento.fecha_limite timestamptz null`; `reserva.sector_id bigint null references sector(id) on delete restrict`; `pendiente.sector_id bigint null references sector(id) on delete set null`.
- Produces (funciones): `private.capacidad_sector(p_sector bigint) returns integer` = Σ `tramo.capacidad` de tramos `publico` de las filas del evento y la sección con `numero between fila_desde and fila_hasta`; `private.apartado(uuid, text, uuid)` reescrita (misma firma).
- Consumes: `private.apartado`, `private.sesion_en_curso`, tabla `reserva` de `20261023000100_sedes.sql`.

- [ ] **Step 1: Escribir `009_sectores.test.sql` (falla)** con: existencia de las tres tablas y columnas; `sector` legible por `anon` y en la publicación `supabase_realtime` con `replica identity full`; `preferencia` y `acceso_sede` SIN `SELECT` para `anon`/`authenticated`; unicidad `reserva` por `(sesion_id, sede_id, seccion, sector_id)` con `nulls not distinct` (insertar dos reservas sin sector de la misma sede/sección/sesión falla; dos con sectores distintos, no); `private.capacidad_sector` con un salón de 4 filas de 10 lugares y un sector 2–3 devuelve 20 y descuenta un tramo `reservado`.
- [ ] **Step 2: Test de regresión de Review Focus 1.** Centro con 10 libres, sede Catán con dos reservas en centro (sector A cantidad 3, sector B cantidad 3), sin consumo: `mandar_grupo` sin sede con 5 personas falla con `libres = 4` (10 − 6); con Catán sentando 2, el apartado pasa a 4 (6 − 2) y no a 2. Además, copiar los casos de `006_sedes.test.sql` con reservas sin sector y verificar que siguen dando lo mismo.
- [ ] **Step 3: Correr `npm run test:db` y ver que falla.**
- [ ] **Step 4: Escribir la migración.** Crear tablas/columnas; reemplazar el `unique (sesion_id, sede_id, seccion)` de `reserva` por `unique nulls not distinct (sesion_id, sede_id, seccion, sector_id)`; RLS + `revoke all` en las tres tablas nuevas, `grant select` y policies `select` para `anon` y `authenticated` solo en `sector`; `replica identity full` y publicación realtime para `sector`; `create or replace private.apartado`: agrupar por `(r.sede_id, r.seccion, r.sesion_id)` y usar `greatest(sum(r.cantidad) - consumido(sede, sección), 0)` donde el consumo (pendientes `pendiente`/`sentado` de esa sede, sesión y sección) se calcula una vez por grupo, no por fila de reserva. Mantener el filtro de sesión en curso y de liberación.
- [ ] **Step 5: Correr `npm run test:db`.** Esperado: `009` y todos los anteriores pasan.

### Task 2: Definir sectores y fecha límite (Supervisor)

**Files:**
- Create: `supabase/migrations/20261026000200_sectores_supervisor.sql`
- Test: `supabase/tests/database/010_sectores_supervisor.test.sql`

**Interfaces:**
- Produces: `public.guardar_sectores(p_clave text, p_sectores jsonb) returns jsonb` — `p_sectores` es un arreglo de `{seccion, nombre, fila_desde, fila_hasta}`; reemplaza todos los sectores del evento. Éxito `{success:true, sectores:n}`. Errores: `SECTORES_INVALIDOS` (con `errores:[{motivo}]`), `SECTORES_CON_ASIGNACIONES`.
- Produces: `public.guardar_fecha_limite(p_clave text, p_fecha timestamptz) returns jsonb` (`null` la borra; cualquier fecha es válida, incluso pasada).
- Produces: `public.generar_acceso_sede(p_clave text, p_sede_id uuid, p_rotar boolean default false) returns jsonb` → `{success:true, clave}`. Si ya existe devuelve la misma salvo `p_rotar`. Error `SEDE_INVALIDA`. Clave: `replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','')`, igual que `acceso`.
- Produces: `public.obtener_mapa_supervisor(p_clave text) returns jsonb` → `{success, fecha_limite, sectores:[{id, seccion, nombre, fila_desde, fila_hasta, capacidad}], sedes:[{sede_id, nombre, clave_acceso|null, preferencias:[sector_id]}], sesiones:[{id, nombre, inicio_at, asignado:[{sector_id, sede_id, cantidad}]}]}`; `sedes` es todo el catálogo `public.sede`; `capacidad` sale de `private.capacidad_sector`.
- Todas exigen clave de supervisor (`private.evento_de_clave(p_clave, true)`) y solo `guardar_sectores` toma los tres locks de sección en orden fijo (izquierda, centro, derecha) como `importar_reservas`; las demás no toman locks (lecturas y escrituras que no tocan `reserva`).

- [ ] **Step 1: Escribir `010_sectores_supervisor.test.sql` (falla)**: sectores válidos (3 por sección sobre 9 filas: 1–3, 4–6, 7–9) se guardan y se leen con `capacidad` correcta; falla con `SECTORES_INVALIDOS` un hueco (1–3 y 5–9), un solape (1–4 y 4–9), un rango que no empieza en la primera fila de la sección o no termina en la última, `fila_hasta < fila_desde`, nombre vacío, sección inválida y nombres repetidos dentro de la sección; con una reserva que tiene `sector_id`, `guardar_sectores` devuelve `SECTORES_CON_ASIGNACIONES` y no cambia nada; sin ellas, reemplazar sectores borra las preferencias en cascada; una sección sin filas no admite sectores; `guardar_fecha_limite` guarda y borra; `generar_acceso_sede` crea, repite la misma clave, rota con `p_rotar` (la vieja deja de servir); la clave de ujier lanza `CLAVE_INVALIDA` en las cuatro RPC.
- [ ] **Step 2: Correr `npm run test:db`; falla.**
- [ ] **Step 3: Implementar la migración.** (`evento.fecha_limite` ya existe desde la Tarea 1.) Validar en SQL con CTE o bucle por sección. Registrar en `public.registro` (`tipo` `'guardar_sectores'`, `'fecha_limite'`, `'acceso_sede'`) como las otras RPC de supervisor.
- [ ] **Step 4: Correr `npm run test:db`; pasa.**

### Task 3: RPC del pastor de sede

**Files:**
- Create: `supabase/migrations/20261026000300_pastor_sede.sql`
- Test: `supabase/tests/database/011_pastor_sede.test.sql`

**Interfaces:**
- Produces: `private.sede_de_clave(p_clave text) returns table(evento_id uuid, sede_id uuid)` — lanza `CLAVE_INVALIDA` si la clave no existe en `acceso_sede` (una clave de ujier o supervisor también lanza).
- Produces: `public.obtener_mapa_sede(p_clave text) returns jsonb` → `{success:true, sede:{id,nombre}, fecha_limite, abierto:boolean, sectores:[{id,seccion,nombre,fila_desde,fila_hasta}], preferencias:[sector_id], sesiones:[{id,nombre,inicio_at, sectores:[{sector_id, agotado:boolean, asignado:integer}]}]}`. `agotado` = Σ `reserva.cantidad` de todas las sedes en ese sector y sesión `>= private.capacidad_sector` (solo reservas con `sector_id`); `asignado` es solo lo de SU sede. Nunca devuelve datos de otras sedes más allá de `agotado`. `abierto = fecha_limite is null or clock_timestamp() < fecha_limite`.
- Produces: `public.guardar_preferencias(p_clave text, p_sectores bigint[]) returns jsonb`; reemplaza las preferencias de la sede. Errores: `FECHA_LIMITE_VENCIDA`, `SECTOR_INVALIDO` (id inexistente o de otro evento).

- [ ] **Step 1: Escribir `011_pastor_sede.test.sql` (falla)**: `obtener_mapa_sede` devuelve solo datos de su sede; con asignaciones de otra sede llenando un sector, ese sector sale `agotado:true` y `asignado:0` para esta sede sin nada más de la otra; clave de la sede A no devuelve preferencias de B; clave de ujier y de supervisor lanzan `CLAVE_INVALIDA` en las dos RPC; `guardar_preferencias` reemplaza (no acumula), acepta lista vacía, rechaza un sector de otro evento con `SECTOR_INVALIDO`; con `fecha_limite = now() - 1 second` devuelve `FECHA_LIMITE_VENCIDA` y `abierto:false`; con `fecha_limite` null o futura guarda; evento sin sectores devuelve `sectores:[]`.
- [ ] **Step 2: Correr `npm run test:db`; falla.**
- [ ] **Step 3: Implementar.** `guardar_preferencias` toma un lock por sede (`pg_advisory_xact_lock(hashtextextended(sede_id::text,0))`) para que dos pestañas no se pisen.
- [ ] **Step 4: Correr `npm run test:db`; pasa.**

### Task 4: Reservas con sector (importar y leer)

**Files:**
- Create: `supabase/migrations/20261026000400_reservas_sector.sql`
- Test: `supabase/tests/database/012_reservas_sector.test.sql`

**Interfaces:**
- Produces: `importar_reservas(p_clave, p_filas, p_simular, p_sesiones)` (misma firma) acepta `sector` opcional en cada fila (`{sede, seccion, sesion, cantidad, sector?}`); `sector` se compara sin mayúsculas ni acentos dentro de la sección. Errores por fila nuevos (`motivo`): `Sector inexistente: <nombre>`, `Mezcla de sector y sección entera: <sede>, <seccion>, <sesion>`, `Excede la capacidad del sector <nombre> en <sesion>: <suma> > <capacidad>`. La clave de duplicados pasa a `(sede, seccion, sesion, sector)`. La validación de capacidad de la sección sigue igual (Σ de todas las filas de la sección).
- Produces: `obtener_reservas` devuelve cada reserva como `{sede, seccion, cantidad, sector}` (`sector` = nombre o `null`) y agrega `sectores:[{id, seccion, nombre, fila_desde, fila_hasta}]` al nivel raíz.
- Consumes: Tarea 1 (`reserva.sector_id`, `capacidad_sector`).

- [ ] **Step 1: Escribir `012_reservas_sector.test.sql` (falla)**: import con sector se guarda con `sector_id`; sin columna `sector` sigue funcionando (compatibilidad Etapa 2, reutilizar un caso de `007`); sector inexistente, mezcla sector/sección entera, exceso del sector y fila repetida con el mismo sector se rechazan con el motivo exacto y con `p_simular` no escriben; la misma sede en dos sectores de la misma sección es válida; `obtener_reservas` devuelve `sector` y `sectores`.
- [ ] **Step 2: Correr `npm run test:db`; falla.**
- [ ] **Step 3: Implementar** reescribiendo `importar_reservas` y `obtener_reservas` con `create or replace`/drop+create según la firma; copiar la estructura de `20261023000200_reservas_supervisor.sql` y agregar los pasos. Mantener los tres locks de sección.
- [ ] **Step 4: Correr `npm run test:db`; pasa (incluye `007`).**

### Task 5: Sentar con sector y estado del salón ampliado

**Files:**
- Create: `supabase/migrations/20261026000500_sentar_sector.sql`
- Test: `supabase/tests/database/013_sentar_sector.test.sql`

**Interfaces:**
- Produces: `sentar_pendiente(p_clave, p_pendiente_id, p_tramo_id)` (misma firma) calcula el sector de la fila del tramo (`fila.numero between fila_desde and fila_hasta`, misma sección), lo guarda en `pendiente.sector_id` y devuelve `{success:true}` o `{success:true, fuera_de_sector:true, sectores:["Centro medio", ...]}`. `fuera_de_sector` solo si el pendiente tiene `sede_id`, la sede tiene reservas CON sector en esa sección y sesión, y ninguna es el sector donde se sentó. `sectores` = nombres de los sectores asignados a esa sede en esa sección. Sin sede, sin reservas con sector, o sin sectores definidos: `{success:true}` a secas.
- Produces: `obtener_estado_salon` agrega `'sectores': [{id, seccion, nombre, fila_desde, fila_hasta, orden}]` y en cada elemento de `'reservas'` los campos `sector_id`, `sector` (nombre|null), `fila_desde`, `fila_hasta`, y `sentados_seccion` (pendientes `sentado` de esa sede y sección en la sesión; el campo `sentados` pasa a ser por sector cuando `sector_id` no es null, y por sección cuando es null, como hoy).

- [ ] **Step 1: Escribir `013_sentar_sector.test.sql` (falla)**: sentar dentro del sector asignado → `{success:true}` sin marca y `pendiente.sector_id` correcto; fuera → `fuera_de_sector:true` con los nombres; sin sede → sin marca; sede sin reservas con sector → sin marca; la reserva con `sector_id` null (sección entera) → sin marca; sentar fuera NO cambia `sentados` de la reserva del sector pero sí `sentados_seccion`; `obtener_estado_salon` incluye `sectores` y los campos nuevos; los tests de `003` y `006` siguen pasando.
- [ ] **Step 2: Correr `npm run test:db`; falla.**
- [ ] **Step 3: Implementar** con `create or replace` de ambas funciones: copiar el cuerpo vigente de `20261022000300_flujo.sql` (sentar) y `20261023000300_liberacion_realtime.sql`/`20261023000100_sedes.sql` (estado; usar la versión más reciente que exista) y agregar lo descrito. Mantener lock de sección y registro `confirmacion`; sumar `sector_id` y `fuera_de_sector` al `detalle` del registro.
- [ ] **Step 4: Correr `npm run test:db`; pasa todo.**

### Task 6: Dominio y estado del cliente (sectores, reservas con sector, derivados)

**Files:**
- Modify: `src/domain/sedes.ts`, `src/domain/types.ts`, `src/lib/rpc.ts`, `src/lib/csv.ts`, `src/state/derivar.ts`, `src/state/salonReducer.ts`, `src/state/sync.ts` (y lo que tsc marque)
- Test: `src/domain/sedes.test.ts`, `src/lib/csv.test.ts`, `src/lib/rpc.test.ts`, `src/state/derivar.test.ts`, `src/state/sync.test.ts`, `src/state/salonReducer.test.ts`

**Interfaces:**
- Produces (`src/domain/sedes.ts`): `export interface Sector { id: number; seccion: Seccion; nombre: string; filaDesde: number; filaHasta: number; orden: number }`; `Reserva` gana `sectorId: number | null; sector: string | null; filaDesde: number | null; filaHasta: number | null; sentadosSeccion: number`; `export function sectorDeFila(sectores: Sector[], seccion: Seccion, numeroFila: number): Sector | null`; `quedan(r, pendientes)`: con `sectorId` no nulo es `max(cantidad - r.sentados, 0)` (los pendientes no se cuentan porque su sector se conoce al sentar), con `sectorId` nulo igual que hoy; `apartado(reservas, pendientes, seccion, sesion, ahoraMs, excluirSedeId)` (misma firma) agrupa por sede: `max(Σ cantidad - (r.sentadosSeccion + pendientes vivos de la sede en la sección), 0)`, igual que `private.apartado`.
- Produces (`src/domain/types.ts`): `EstadoSalon.sectores: Sector[]`.
- Produces (`src/state/derivar.ts`): `export interface SectorVista { sectorId: number | null; nombre: string | null; filaDesde: number | null; filaHasta: number | null; cantidad: number; quedan: number }`; `SedeVista.porSeccion[seccion]` pasa a `{ cantidad; consumido; quedan; sectores: SectorVista[] }` con totales de la sección y un `SectorVista` por reserva (uno solo con `sectorId: null` si es sección entera). `completo` sigue siendo "quedan 0 en todas sus secciones".
- Produces (`src/lib/rpc.ts`): `EstadoCrudo.sectores?`, `reservas[]` con `sector_id, sector, fila_desde, fila_hasta, sentados_seccion`, mapeados en `estadoDesdeServidor`; `MENSAJES` agrega `SECTORES_INVALIDOS`, `SECTORES_CON_ASIGNACIONES`, `FECHA_LIMITE_VENCIDA`, `SECTOR_INVALIDO`, `SEDE_INVALIDA` con textos en español.
- Produces (`src/lib/csv.ts`): `FilaReserva.sector?: string`; columna `sector` OPCIONAL en el encabezado (no entra en `faltan`); se manda al servidor solo si viene con texto.
- Consumes: forma de la respuesta de `obtener_estado_salon` de la Tarea 5.

- [ ] **Step 1: Tests (fallan)**: `sectorDeFila` con rangos 1–3/4–6/7–9 (bordes 3→primer sector, 4→segundo, 9→tercero, fila fuera → `null`, otra sección → `null`); `quedan` por sector con y sin pendientes; `apartado` con una sede con dos reservas de sector en la misma sección (caso del Review Focus 1, mismos números que la Tarea 1); `derivarSalon` arma `porSeccion.sectores`; sin sectores ni reservas, `sedes` vacío; `parsearReservasCsv` acepta con y sin columna `sector`, y con `;`; `estadoDesdeServidor` mapea los campos nuevos y tolera servidor sin `sectores`; `sync` pide un resync ante un cambio en la tabla `sector` (igual que `reserva`/`sesion`).
- [ ] **Step 2: Correr `npm test`; fallan.**
- [ ] **Step 3: Implementar** las firmas de arriba. En `sync.ts` suscribir `sector` junto a `reserva`/`sesion` (handler `onReservaOSesion`). El reducer y la inicialización del estado (`SalonState`) guardan `sectores` igual que `reservas`.
- [ ] **Step 4: Correr `npx tsc --noEmit` y `npm test`; sin errores.**

### Task 7: Componente `MapaSalon`

**Files:**
- Create: `src/components/mapa/MapaSalon.tsx`
- Test: `src/components/mapa/MapaSalon.test.tsx`

**Interfaces:**
- Produces: `export type EstadoSector = 'disponible' | 'agotado' | 'preferido' | 'asignado'`; `export interface SectorMapa { id: number; seccion: Seccion; nombre: string; filaDesde: number; filaHasta: number; estado: EstadoSector; detalle?: string }`; `export function MapaSalon(props: { sectores: SectorMapa[]; onAlternar?(id: number): void; deshabilitado?: boolean; etiquetaEscenario?: string })`.
- Layout (mockup `mapa-estetico-v2.html`): barra "ESCENARIO" arriba; tres columnas (izquierda, centro, derecha; el centro más ancho) separadas por una línea vertical de pasillo; cada columna con el nombre de la sección y sus sectores apilados por `orden`; cada sector es un `button` con el nombre, "filas X–Y", el `detalle` y el estado en texto. Leyenda debajo (Disponible, Agotado, Tu preferencia, Asignado). Si `sectores` está vacío muestra "El supervisor todavía no definió los sectores."
- Reglas: `agotado` → `aria-disabled="true"` y no dispara `onAlternar`; `preferido` → `aria-pressed="true"`; `asignado` es sólido y no se alterna; sin `onAlternar` los botones no son interactivos. Colores solo con tokens del tema; el estado nunca se comunica solo por color.

- [ ] **Step 1: Escribir tests (fallan)**: renderiza los tres nombres de sección y un botón por sector con su texto de estado; clic en `disponible` llama `onAlternar(id)`; clic en `agotado` y en `asignado` no lo llama; `preferido` tiene `aria-pressed="true"`; `deshabilitado` bloquea todo; lista vacía muestra el mensaje; el orden dentro de la sección sigue el arreglo.
- [ ] **Step 2: Correr `npx vitest run src/components/mapa`; falla.**
- [ ] **Step 3: Implementar** con Tailwind y los tokens de `globals.css` (leer el archivo antes; no inventar colores).
- [ ] **Step 4: Correr los tests; pasan. Revisar el componente con la skill `web-design-guidelines` y a 360 px de ancho sin scroll horizontal.**

### Task 8: Pantalla del pastor de sede (`/sede`)

**Files:**
- Create: `src/app/sede/page.tsx`, `src/components/paginas/SedePagina.tsx`, `src/components/sede/SedePanel.tsx`
- Modify: `src/domain/types.ts` (`Rol` agrega `'sede'`), `src/lib/acceso.ts` (`armarEnlace` ya sirve; `ROLES` incluye `'sede'`), `src/app/entrar/EntrarContenido.tsx` (`destinoDe('sede') = '/sede'`; `ROLES` incluye `'sede'`), y lo que `tsc` marque por el `Rol` ampliado
- Test: `src/components/sede/SedePanel.test.tsx`, `src/app/entrar/entrar.test.tsx`, `src/lib/acceso.test.ts`

**Interfaces:**
- Produces: `SedePanel({ clave }: { clave: string })`: pide `obtener_mapa_sede` al montar y cada 30 s (`setInterval`, se limpia al desmontar; shortcut: polling, subir a realtime si hace falta); muestra el nombre de la sede, la fecha límite ("Podés cambiar tu preferencia hasta el <fecha y hora>") o "Cerrado" cuando `abierto` es falso, chips de sesión (default: la primera) que solo cambian `agotado`/`asignado`, y el `MapaSalon`. El estado de cada sector: `agotado` si lo dice la sesión elegida, si no `preferido` si está en las preferencias, si no `disponible`; `asignado` si `asignado > 0` en la sesión elegida (con `detalle` "Tenés N lugares"). Alternar un sector llama `guardar_preferencias` con la lista nueva, de forma optimista y revirtiendo con aviso si falla; `FECHA_LIMITE_VENCIDA` refresca y muestra el cierre.
- Consumes: `llamarRpc`/`rpcDatos` de `src/lib/rpc.ts`, `MapaSalon` (Tarea 7), `leerAcceso`, `PantallaClaveInvalida` (clave inválida → misma pantalla que los ujieres), `MarcoSalon` si aplica.

- [ ] **Step 1: Tests (fallan)**: con respuesta mockeada se renderiza el mapa con el nombre de la sede; clic en un sector llama `guardar_preferencias` con la lista esperada y lo marca; si la RPC devuelve `FECHA_LIMITE_VENCIDA` revierte y muestra "Cerrado"; `abierto:false` deshabilita el mapa; `sectores:[]` muestra el mensaje vacío (Review Focus 5); cambiar de sesión actualiza `agotado`; `CLAVE_INVALIDA` muestra `PantallaClaveInvalida`; polling: con timers falsos, tras 30 s vuelve a pedir; `EntrarContenido` con `rol=sede` va a `/sede`; `leerAcceso`/`guardarAcceso` aceptan `'sede'`.
- [ ] **Step 2: Correr `npm test`; fallan.**
- [ ] **Step 3: Implementar.** Leer `node_modules/next/dist/docs/` (App Router, client components) antes de crear `page.tsx`; copiar el patrón de `src/app/supervisor/page.tsx` y `SupervisorPagina.tsx`.
- [ ] **Step 4: `npx tsc --noEmit`, `npm run lint` y `npm test` sin errores.**

### Task 9: Supervisor — sectores, fecha límite, enlaces de sede, preferencias y asignación

**Files:**
- Create: `src/components/supervisor/SectoresPanel.tsx`, `src/components/supervisor/MapaSupervisor.tsx`
- Modify: `src/components/supervisor/ReservasPanel.tsx`, `src/components/paginas/SupervisorPagina.tsx`
- Test: `src/components/supervisor/SectoresPanel.test.tsx`, `src/components/supervisor/MapaSupervisor.test.tsx`, `src/components/supervisor/ReservasPanel.test.tsx`

**Interfaces:**
- Produces: `SectoresPanel({ clave }: { clave: string })`: formulario con una fila por sector (sección, nombre, fila desde, fila hasta), botón "Dividir en 3 partes" por sección (calcula adelante/medio/atrás a partir del primer y último número de fila que devuelve `obtener_mapa_supervisor`; si la sección no tiene filas lo oculta), "Guardar sectores" → `guardar_sectores`; muestra los errores `SECTORES_INVALIDOS` fila por fila y el aviso de `SECTORES_CON_ASIGNACIONES` ("Borrá primero las asignaciones por sector."). Debajo, campo `datetime-local` de fecha límite con "Guardar" y "Sin fecha límite" → `guardar_fecha_limite`; y una tarjeta por sede (catálogo) con "Generar enlace"/"Rotar enlace" → `generar_acceso_sede` y la `TarjetaEnlace` existente con `armarEnlace(origen, clave, 'sede')`.
- Produces: `MapaSupervisor({ clave }: { clave: string })`: `MapaSalon` de solo lectura con, por sector, `detalle` "Piden: Norte, Sur · Asignado: 40/60" (preferencias de todas las sedes y suma asignada sobre capacidad) para la sesión elegida; chips de sesión.
- Modify: `ReservasPanel` y su tabla manual agregan la columna **Sector** (select con "Toda la sección" y los sectores de esa sección, desde `obtener_reservas.sectores`); las filas editables pasan `sector` a `importar_reservas`; la vista previa del CSV muestra la columna.
- Consumes: `obtener_mapa_supervisor`, `guardar_sectores`, `guardar_fecha_limite`, `generar_acceso_sede`, `obtener_reservas`, `importar_reservas` (Tareas 2 y 4); `parsearReservasCsv` (Tarea 6).

- [ ] **Step 1: Tests (fallan)**: "Dividir en 3 partes" con filas 1–20 propone 1–6, 7–13, 14–20; guardar envía el JSON esperado y muestra los errores del servidor; con `SECTORES_CON_ASIGNACIONES` no cambia el formulario y avisa; fecha límite se manda en ISO y "Sin fecha límite" manda `null`; "Generar enlace" muestra el enlace con `rol=sede`; `MapaSupervisor` marca `preferido`/`asignado` según los datos y muestra qué sedes piden cada sector; `ReservasPanel` envía `sector` en las filas y mantiene el comportamiento sin sectores (casos existentes siguen pasando).
- [ ] **Step 2: Correr `npm test`; fallan.**
- [ ] **Step 3: Implementar** y montar `SectoresPanel` y `MapaSupervisor` en `SupervisorPagina` junto a `ReservasPanel`, con el mismo estilo de tarjetas del panel actual.
- [ ] **Step 4: `npx tsc --noEmit`, `npm run lint` y `npm test` sin errores.**

### Task 10: Puerta y Sección — sector indicado y aviso "fuera de sector"

**Files:**
- Modify: `src/components/puerta/PuertaView.tsx`, `src/components/seccion/PendienteCard.tsx`, `src/components/seccion/SeccionView.tsx`, `src/state/sync.ts` (resultado de `sentar`), `src/components/paginas/SeccionPagina.tsx`
- Test: `src/components/puerta/PuertaView.test.tsx`, `src/components/seccion/SeccionView.test.tsx`, `src/state/sync.test.ts`

**Interfaces:**
- Produces: en `PuertaView`, con una sede elegida y `reservaSede.sectores.length > 0` el botón de la sección muestra una línea por sector: `"{nombre} (filas {desde}–{hasta}): quedan {n}"`; si el único sector es `sectorId: null` queda el texto actual. El número de toques no cambia.
- Produces: `PendienteCard` recibe `sectoresSede?: SectorVista[]` (los de la sede del pendiente en su sección, desde `SedeVista`) y muestra "Sede {nombre}: {sectores con filas}" arriba de "Sentar en fila X"; sin sede o sin sectores no muestra nada.
- Produces: el resultado de la acción `sentar` de `SalonAcciones` pasa a `{ ok: boolean; error?: string; fueraDeSector?: string[] }`; `SeccionView` muestra un `Aviso` (componente existente) "Esa fila está fuera del sector asignado a {sede}: {sectores}" cuando viene `fueraDeSector`; no bloquea ni deshace.
- Consumes: `SedeVista.porSeccion[s].sectores` (Tarea 6) y `sentar_pendiente` (Tarea 5).

- [ ] **Step 1: Tests (fallan)**: Puerta con sede de dos sectores en centro muestra las dos líneas con sus `quedan`; con un solo sector `null` queda el texto de la Etapa 2; sin sectores en el evento Puerta es idéntica a la actual (casos existentes pasan); `PendienteCard` muestra los sectores de la sede del pendiente y nada para "sin sede"; `sync` propaga `fuera_de_sector` del RPC a `fueraDeSector`; `SeccionView` muestra el aviso y el pendiente se sienta igual.
- [ ] **Step 2: Correr `npm test`; fallan.**
- [ ] **Step 3: Implementar** siguiendo el flujo optimista existente de `sentar` en `sync.ts` (leerlo entero antes de tocarlo; la marca viene en la respuesta del servidor, no se calcula en el cliente).
- [ ] **Step 4: `npx tsc --noEmit`, `npm run lint` y `npm test` sin errores.**

### Task 11: Verificación final y cierre

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-usherflow-mapa-preferencias-design.md` (alinear con lo construido, ver Step 1)
- Modify: `.superpowers/sdd/etapa-3/progress.md` (crear: decisiones y minors diferidos, como en la Etapa 2)

- [ ] **Step 1: Chequear que el diseño coincida con lo construido.** Las dos diferencias con el texto aprobado (clave de sede en claro, sin "cupo total por sede" aparte) ya están corregidas en §3.2 y §5 del diseño; verificar que nada más se haya movido durante la implementación.
- [ ] **Step 2: Correr todo.** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db`, `npm run build`. Esperado: todo en verde; reportar los números reales de tests.
- [ ] **Step 3: Prueba manual (la hace el usuario, en celular).** Crear sectores 3×3 con "Dividir en 3 partes"; poner una fecha límite futura; generar el enlace de una sede y abrirlo en otro celular; marcar y desmarcar preferencias; asignar con `ReservasPanel` (un sector lleno debe verse gris en el mapa del pastor sin recargar, en ≤30 s); como Puerta elegir esa sede y ver los sectores; sentar dentro y fuera del sector y ver el aviso solo fuera; poner la fecha límite en el pasado y ver el mapa cerrado. Aplicar las 5 migraciones nuevas a la nube con `supabase db push` (lo corre el usuario).
- [ ] **Step 4: Actualizar la memoria del proyecto** (`usherflow-proyecto.md`) con el estado de la Etapa 3.

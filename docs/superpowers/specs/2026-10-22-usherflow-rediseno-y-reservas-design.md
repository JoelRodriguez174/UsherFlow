# UsherFlow — Refactor, rediseño, flujo Puerta/Sección y reservas por sede

Fecha: 2026-10-22 · Estado: borrador para aprobación

## 1. Intención y por qué

UsherFlow es una app web móvil en tiempo real para el equipo de ujieres de la Iglesia Casa del Alfarero (ICC) en conferencias de ~700+ personas. **Todavía no se usó en un evento real.**

**El problema real no es de botones, es de confianza en el dato.** En la hora pico (desde que abre la iglesia hasta que arranca el servicio, ~1 hora) entra gente sin parar. Los ujieres están apurados llenando lugares y después revisan una y otra vez si los lugares se ocuparon, porque no saben si el dato es cierto. Eso termina moviendo gente de lugar y genera un ambiente apurado y forzado que nadie quiere. Después de la hora pico el volumen baja de forma exponencial y todo es más tranquilo.

**Objetivo central:** que en la hora pico el trabajo se facilite y el dato sea confiable, de modo que nadie tenga que mover a nadie ni revisar todo constantemente.

## 2. Roles reales (así trabajan hoy)

- **Ujier de Puerta:** recibe a la gente y **deriva** cada grupo a un ujier de sección. No decide la fila.
- **Ujier de Sección:** fijo en **una sola sección** (izquierda, centro o derecha) durante todo el evento. **Es quien decide en qué fila se sienta cada grupo.**
- **Pastor de sede:** carga las reservas de **su** sede (Etapa 2). Ve solo lo suyo.
- **Encargado de la sede principal:** define el cupo de reservas de cada sede, en base a lo que acuerda con el pastor de cada una (Etapa 2).

Los ujieres **no tienen login** (entran por enlace/QR, como hoy). Pastores y encargado de la sede principal sí, con Supabase Auth.

## 3. Objetivos, no objetivos, anti-objetivos

**Objetivos**
- Flujo Puerta → Sección que no exija toques en lo normal.
- Dato confiable sin que los ujieres revisen todo a mano.
- Refactor del código para que sea mantenible y probado.
- Rediseño visual cálido (ver §7).
- Plantilla del salón con reservas fijas.
- Etapa 2: reservas por sede, con cupo, sesiones y liberación automática.

**No objetivos**
- No hay sensores ni forma automática de saber si alguien se levantó.
- No hay reservas de personas con nombre ni datos personales (decisión explícita: solo sedes).
- No hay reserva de sillas individuales numeradas (las sillas son móviles, sin número).
- No hay página pública de reservas.

**Anti-objetivos (sería un fracaso aunque "funcione")**
- Que la Puerta o la app impongan la fila a los ujieres de sección.
- Que un error de la app deje a gente parada o apretada por mostrar libre algo ocupado.
- Que en la hora pico haya que tocar muchas veces por grupo.

## 4. Diseño funcional — Etapa 1

### 4.1 Flujo de un grupo
1. **Puerta** elige cuántos son (1, 2, 3, 4, 5+) y toca "Mandar N a *Sección*". Cada sección muestra **lugares libres y el grupo máximo que entra junto**, en números absolutos (no en %), porque las secciones tienen tamaños distintos. Si el grupo no entra, el botón se apaga.
2. Al ujier de esa **Sección** le llega un aviso grande ("Vienen 3") con vibración. La app sugiere una fila (la que mantiene todo junto y sin huecos), pero **no la impone**.
3. El ujier toca "Sentar en Fila X" (un toque) o "Otra fila…". Eso descuenta los lugares.
4. **Regla de confianza (decidida por el equipo):** los lugares de un grupo mandado quedan **apartados hasta que el ujier de sección confirme** que se sentaron. La confirmación es **un solo toque** ("Sentar en Fila X"). **Nunca se liberan solos ni se dan por sentados en silencio:** el dato siempre es algo que un ujier confirmó. Hoy el diseño original libera los lugares a los 2 minutos, y eso es lo que causaba el problema.
5. **Aviso de pendiente:** pasado un rato sin confirmar (placeholder: 3 min), el grupo pendiente se pone en **ámbar** en el celular del ujier ("falta confirmar: 3 personas") y también se ve en la Puerta. Los lugares siguen apartados. Salidas posibles para el ujier: "Sentar en Fila X", "Otra fila…" o "No llegaron" (libera los lugares). Además quedan "Se levantó alguien" y "Corregir conteo".
6. Cada "No llegaron" y cada pendiente que tarda mucho se registra, para revisar tras el primer domingo si el ritmo de confirmación alcanza en la hora pico.

### 4.2 Qué se cae del `PLAN.md` original
- La Puerta ya no elige fila ni crea una reserva de 2 minutos por fila. El TTL por fila se elimina; el aviso es por sección.
- El radar de 3 columnas con filtro `[1+][2+]…` se reemplaza por el panel de 3 secciones de §4.1 (se puede conservar como vista secundaria para fuera de la hora pico — decisión del constructor).

### 4.3 Fragmentación automática (se activa)
- Se activa al tocar "Se levantó alguien" en una fila con ≥ 4 ocupados: la fila pasa a `fragmentada` y el sistema deja de ofrecerla a grupos de 2 o más hasta que el ujier toque "Juntos".
- **"Corregir conteo" no fragmenta** (separado de "Se levantó alguien") para que un error de dedo no bloquee la fila.

### 4.4 Alguien se levanta y el ujier no lo nota
No hay forma automática de detectarlo. Es aceptable porque el error resultante es el inofensivo (lugar desperdiciado, nunca sobreocupación). Mitigación: cada fila muestra **hace cuánto se verificó con los ojos**; la lista "Mis filas" va en orden fijo por número (cambiado tras la prueba en celular del 2026-10-22: reordenar por verificación ponía otra fila bajo el dedo al tocar "Ya revisé"), y el ujier hace una pasada rápida cuando afloja el flujo.

### 4.5 Plantilla del salón (reservas fijas)
Un archivo/tabla de configuración, definido una sola vez, con: secciones, filas, tamaño de cada fila y reservas fijas con etiqueta.
- **Filas enteras reservadas** (pastores, iglesia madre, alabanza): no cuentan como libres, nunca se sugieren, se ven en gris con su etiqueta.
- **Asientos reservados dentro de una fila** (p. ej. 2 para mamás por fila en cierta sección; 4 para alabanza en las filas de adelante): la fila tiene `max` físico pero menos asientos disponibles al público. **Los reservados NO están siempre en un extremo** (confirmado por el equipo): sus posiciones se **establecen en la plantilla, fila por fila**. Cada fila se modela como una secuencia ordenada de **tramos**, cada uno público o reservado (con etiqueta). Los tramos públicos tienen su propia capacidad y su propio conteo de ocupados. El "grupo máximo junto" de una fila es el mayor espacio libre dentro de un solo tramo público. Una fila con un único tramo público se comporta como hasta ahora (sin toque extra); en filas con varios tramos públicos, el ujier elige el tramo al sentar (el sistema sugiere uno).
- "Reiniciar salón" vuelve a la plantilla sin perder reservas fijas.
- Las secciones pueden tener distinta cantidad de filas y de sillas.

### 4.6 Interruptor de modo
"Modo pico" simplifica la Puerta a lo mínimo; fuera de la hora pico se pueden mostrar más datos. Los detalles de qué se oculta quedan para el constructor.

## 5. Diseño funcional — Etapa 2: reservas por sede

- **Unidad de reserva:** `sede + sección + cantidad + sesión`. **Sin nombres de personas.** Las sedes son un catálogo (Catán, Tristán Suárez, Villa Mercedes, etc.), cargado una vez y ampliable.
- **Reserva por sección**, no por silla ni por tramo de fila: el ujier de sección decide el lugar exacto cuando llegan. Es coherente con §2 y evita marcar sillas físicas.
- **Sesiones:** jueves, viernes, sábado y domingo; viernes, sábado y domingo tienen mañana y tarde (7 sesiones; la sesión del jueves se confirma). Una reserva puede cubrir "todo el día" pero se puede destildar la mañana: quien solo va a la tarde no ocupa la mañana.
- **Cupo por sede:** lo asigna el encargado de la sede principal, en base a lo acordado con cada pastor. El pastor reserva dentro de su cupo y ve solo lo suyo (cupo, reservado, restante).
- **Tope de reservables** por sección (p. ej. ~1/3) para no frenar el flujo de la hora pico. Los números del mockup (30/40/etc.) son de ejemplo.
- **Llegada por tandas:** el ujier de sección ve las sedes con lugar reservado y toca "Llegaron N" (N ajustable, p. ej. "8 de 20"). Descuenta de la reserva y entra al flujo normal.
- **Liberación automática:** un tiempo antes de cada sesión (p. ej. 20 min, valor a definir con ustedes), los reservados que no llegaron vuelven al público general.
- **Llegada tardía:** entra como cualquier grupo, sin lugar garantizado.
- **Base de datos preparada desde la Etapa 1:** entidades `evento` y `sesion` (y `sede`) existen desde el inicio, aunque no se usen todavía.

## 6. Refactor técnico (Etapa 1)

Stack actual y se mantiene: Next.js 16 (App Router), React 19, Tailwind v4, Supabase (Postgres + Realtime + RPC plpgsql), lucide-react. **Leer `node_modules/next/dist/docs/` antes de escribir código** (indicación del `AGENTS.md`: esta versión de Next tiene cambios incompatibles).

**Bugs detectados que deben corregirse**
1. El toggle de sonido no tiene efecto (`sonidoHabilitado` nunca llega a `audio.ts`).
2. `sentar()` marca `fueValido` dentro del updater de `setFilasRaw` y lo lee a continuación; React puede ejecutar el updater después, dejando la UI modificada sin llamada al servidor.
3. El rollback restaura un snapshot completo y pisa cambios de otros ujieres llegados por Realtime; debe revertirse **por fila**.
4. Mientras una fila tiene mutación pendiente o en vuelo se descartan los updates de Realtime y no hay resync posterior.
5. `"lint": "next lint"` no existe en Next 16 y no hay ESLint instalado.
6. `layout.tsx` referencia `/manifest.json` que no existe.

**Seguridad**
- Las policies RLS son `FOR ALL USING (true)` para `anon`: cualquiera con la anon key (pública) puede editar o borrar filas directo. Como las RPC son `SECURITY DEFINER`, se deben **quitar las policies de escritura directa** y dejar lectura + escritura solo vía RPC.
- Pastores y encargado central requieren login (Supabase Auth) con permisos por rol y por sede; los ujieres siguen sin login.
- **Clave secreta del evento en el QR/enlace de los ujieres** (confirmado por el equipo): cada RPC de ujier valida esa clave en el servidor; sin ella, rechaza. La clave se puede **renovar** (genera un QR nuevo e invalida el anterior) si se filtra. Los ujieres siguen sin usuario ni contraseña. El enlace/QR puede identificar el rol (Puerta, o Sección izquierda/centro/derecha); si el rol se hace cumplir en el servidor o solo es una conveniencia de la interfaz queda para el constructor.

**Arquitectura**
- Partir `useSupabaseUshers.ts` (1027 líneas) en: suscripción Realtime, mutaciones optimistas con rollback por fila, y tick/cálculo de TTL/disponibilidad. Eliminar el `filasBackupRef.current = …` repetido y unificar `flushSentar`/`flushLiberar`.
- Reemplazar el prop drilling de ~9 callbacks por un Context de acciones.
- Que `React.memo` funcione: no recrear objetos ni `admite_grupo` en cada tick de 1 s.
- Pasar `eventoId` desde la página (hoy el multi-evento está a medio hacer).
- Tests unitarios sobre la lógica pura (cálculo de libres, absorción, fragmentación, grupo máximo junto) y sobre las RPC críticas.

**Accesibilidad / PWA**
- Permitir zoom (hoy `userScalable: false`), mínimo ~12 px de texto, `aria-label` en botones solo-ícono, trampa de foco en modales, `:focus-visible`.
- Crear `manifest.json` e íconos.

## 7. Diseño visual

**Dirección elegida: "Cálido"** (opción C del mockup): fondo oscuro marrón-tierra en vez de azul-negro, títulos con serifa, formas redondeadas, acento ámbar/arena para la acción principal, verde oliva para libre, naranja terracota para reservado/en tránsito, violeta y rosa rayados para reservas fijas. Pensado para leerse de un vistazo, con poca luz y una mano.

- Sistema de **tokens semánticos** (libre, ocupado, en camino, reservado fijo, advertencia) en un único `@theme`; eliminar los ~290 colores hex hardcodeados y los tokens duplicados.
- Usar `dvh`, quitar offsets sticky fijos (`top-[105px]`).
- Los mockups de referencia están en `.superpowers/brainstorm/854-1792636446/content/` (flujo-puerta-seccion, direccion-visual, reserva-por-seccion, reserva-por-sede). El cálido es la dirección; **los mockups son referencia de contenido y jerarquía, no un diseño final**.

## 8. Restricciones

- Móvil vertical 6.1"–6.7", una mano, zona del pulgar; sin login para ujieres.
- Latencia de sincronización objetivo < 200 ms; reconexión tras pérdida de red y al desbloquear el teléfono.
- Idioma de la interfaz: español rioplatense.

## 9. Decisiones de este diseño (para que las revises)

- Mantener Next 16 + Tailwind v4 + Supabase; **no** sumar HeroUI ni shadcn (el proyecto no los usa) — decisión mía.
- Fuente con serifa para títulos y una sans para el resto — elección concreta queda para el constructor.
- Valores de ejemplo (20 min de liberación, topes y cupos) son placeholders a confirmar.

## 10. Dejado al constructor

- Algoritmo exacto de sugerencia de fila (adelante→atrás, sin huecos) y el desempate.
- Qué se muestra/oculta en "modo pico".
- Modelo de datos exacto de plantilla, evento, sesión, sede, cupo y reserva, y las RPC correspondientes.
- Estrategia de auth con roles y alcance por sede.
- Orden de las tareas dentro de cada etapa.

## 10b. Decisiones del diseñador tras la revisión (mías; revisar)

Estas respuestas las decidí yo para cerrar huecos que marcó el revisor. No fueron acordadas con el equipo de ujieres.

- **Estado entre "Mandar" y "Sentar en Fila X":** al mandar, el grupo queda como **pendiente a nivel de sección** (sin fila) y **descuenta de los libres de esa sección de inmediato**, para que la Puerta nunca sobrevenda. Se resuelve cuando el ujier de sección toca "Sentar en Fila X". **Sin auto-asignación ni liberación automática** (decidido por el equipo): si nadie lo toca, el pendiente pasa a ámbar (ver §4.1) y sigue apartado hasta que se confirme o se cancele con "No llegaron". Si no hay ujier conectado en esa sección, la Puerta lo ve como aviso y el pendiente espera.
- **Una sola fuente de verdad:** el conteo vive **solo por tramo público de cada fila** (`ocupados`). Los totales por fila y por sección se **derivan**, nunca se guardan. (Ajustado tras confirmar que los reservados no están siempre en un extremo.)
- **Plantilla con posiciones:** para cada fila, la secuencia de tramos con tipo y etiqueta. Ejemplo (placeholder): `[público 3][reservado "Mamás" 2][público 3]`. Hasta tener los datos reales, valores de ejemplo en un archivo editable.
- **Libres de una sección (Puerta)** = suma de libres de sus filas − grupos pendientes − lugares reservados por sedes aún no liberados. Para el "grupo máximo junto", las reservas por sede, que no tienen fila, se descuentan **virtualmente de las filas del fondo** (las menos preferidas), así el cálculo refleja el llenado de adelante hacia atrás.
- **"Se levantó alguien"** libera 1 asiento por toque (se puede repetir); no pide cantidad.
- **Base de datos:** como la app nunca se usó, no hay datos que preservar. Aun así uso **migraciones versionadas** en `supabase/migrations/` en lugar de reescribir `schema.sql` en bloque. Asumo un proyecto de desarrollo separado del de producción; si no existe, se crea.
- **Pruebas:** Vitest para la lógica pura. Para las RPC, pgTAP con Supabase CLI local si hay Docker disponible; si no, contra un proyecto de desarrollo.
- **Alcance de este plan:** **Etapa 1 detallada**. Etapa 2 solo como esquema; tendrá su propio ciclo de diseño y plan antes de construirse. En Etapa 1 solo se crean las tablas `evento`, `sesion` (con `inicio_at`) y `sede`, sin lógica.
- **Liberación automática (Etapa 2):** se calcula **al leer** (expiración perezosa, como el TTL original), sin cron. Las sesiones tienen hora de inicio guardada por evento. Zona horaria `America/Argentina/Buenos_Aires`.
- **Plantilla del salón:** hasta tener los números reales, un archivo de configuración editable con valores de ejemplo (placeholder). Se reemplazan sin tocar código.

## 11. Pendientes (a confirmar con ustedes)

- Cuántas sesiones tiene el jueves.
- Tiempo de liberación de reservas y topes de reservables por sección.
- Si las sedes se cargan solo por el encargado central o también por los pastores.

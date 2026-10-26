# UsherFlow — Etapa 2: reparto del salón por sede

Fecha: 2026-10-22 · Estado: borrador para aprobación
Reemplaza el esquema de la §5 de `2026-10-22-usherflow-rediseno-y-reservas-design.md`. El resto de ese documento (roles, Etapa 1, diseño visual, restricciones) sigue vigente.

## 1. Intención y por qué

En la hora pico todo se resuelve en el momento. Los ujieres están apurados y el trato se resiente. A algunas personas les tocan lugares muy malos, y la gente de una misma sede termina desparramada por el salón porque llega en tandas. Además, va a llegar un día en que no entren todos, y hoy el criterio es "el que llega primero se sienta".

El 99% de la gente pertenece a alguna sede, y los pastores saben de antemano, aproximadamente, cuántos de los suyos van a cada sesión.

**Idea central:** la sede principal **reparte el salón por sede antes del evento**. En la hora pico, la Puerta pregunta "¿de qué sede son?" y la app ya sabe a qué sección mandarlos. Así la gente de una sede queda en su sección aunque llegue en tandas, y si falta lugar, el reparto se decide con tiempo y no por orden de llegada.

La idea es del usuario y todavía no la validó con el equipo de ujieres.

## 2. Objetivos, no objetivos, anti-objetivos

**Objetivos**
- La persona central carga, por cada sesión, cuántos lugares tiene cada sede y en qué sección. El reparto cubre todo lo posible, y lo que sobra queda para el que llega primero.
- La Puerta deriva a la gente de una sede a su sección con el mismo número de toques que hoy, más uno para elegir la sede.
- Los lugares reservados que nadie usó vuelven solos al público antes de que empiece la sesión.
- Las sesiones sin reservas cargadas funcionan exactamente como en la Etapa 1.

**No objetivos**
- No hay usuarios ni login de pastores. Una sola persona central carga todo.
- No hay bloques de filas por sede: la reserva es por **sección**, y el ujier de sección decide la fila, como en la Etapa 1. Pasarla a bloques de filas más adelante es agregar un dato a la reserva, no rehacer.
- No hay forma de comprobar en la app de qué sede es alguien. Pulseras, credenciales o lo que sea lo decide la organización por fuera de la app (pendiente §8).
- No hay página pública: solo los ujieres y la persona central ven las reservas.
- No hay nombres de personas.
- No se lee `.xlsx` directo: Excel y Google Sheets exportan a CSV.

**Anti-objetivos**
- Que la Puerta quede bloqueada o tenga que pensar cuando una sede ya completó su cupo.
- Que haya gente de pie mientras quedan sillas reservadas vacías después de la liberación.
- Que la Puerta ofrezca un lugar que no existe, es decir, sobreventa. Se mantiene la garantía de la Etapa 1.
- Agregar un toque en la Sección: no hay "Llegaron N".

## 3. Cómo funciona

### 3.1 Antes del evento (Supervisor)
1. La persona central carga las **sesiones** del evento, cada una con nombre e inicio (por ejemplo, "Sábado tarde", sábado 17:00). La tabla `sesion` ya existe y le falta `nombre`.
2. Carga las **reservas**: `sede + sección + sesión + cantidad`. Lo puede hacer de dos formas:
   - **Subir un CSV** con las columnas `sede,seccion,sesion,cantidad`, por ejemplo `Catán,centro,Sábado tarde,120`.
   - **A mano**, en una tabla que también sirve para corregir.
3. Las sedes forman un catálogo, que ya existe en la tabla `sede`.

### 3.2 En la hora pico — Puerta (opción A del mockup, elegida por el usuario)
- Es la pantalla de la Etapa 1 con una fila de chips de sede arriba. **"Sin sede"** es el valor por defecto: sin tocar nada, todo funciona igual que hoy.
- Al tocar una sede, por ejemplo "Catán":
  - su sección se resalta con la etiqueta "Catán: quedan 42";
  - el botón de esa sección dice "Mandar 3 de Catán al Centro";
  - las otras secciones quedan atenuadas pero se pueden usar (el ujier manda).
- Cuando una sede ya completó su cupo, su chip dice "Catán (completo)". Tocarla se comporta como "Sin sede" (decisión del diseñador).
- Las sedes que no tienen reserva en la sesión en curso no aparecen como chip.
- Mockup: `.superpowers/brainstorm/544-1792703757/content/puerta-con-sedes.html`.

### 3.3 En la hora pico — Sección
- El pendiente muestra la sede: "3 de Catán". Al tocar "Sentar en fila X", se descuenta de la reserva de Catán sin ningún toque extra.
- Abajo hay un resumen de las sedes de esa sección: "Catán 78/120 · Tristán S. 30/50".

### 3.4 Entre sesiones (respuesta del usuario)
- Siempre hay un ujier controlando quién entra y quién sale.
- Entre una sesión y la siguiente, el Supervisor toca **"Vaciar salón"** (`reiniciar_salon`, que ya existe). El conteo de sillas es por evento y no se reinicia solo. No se agrega un botón nuevo.
- Mañana y tarde están bien separadas: la mañana termina alrededor de las 12 y la tarde arranca entre las 17 y las 18. Con ese margen alcanza la regla de "sesión en curso" de §6.

### 3.5 Liberación
- **20 minutos antes del inicio** de cada sesión (valor configurable; el número exacto se confirma con el equipo, §8), lo reservado que nadie usó pasa a libre. Se calcula al leer, sin cron, como ya preveía el diseño de la Etapa 1.
- Después de la liberación, los chips de sede siguen sirviendo para etiquetar a los grupos, pero ya no apartan lugar.

## 4. Las cuentas (lo que el constructor no puede equivocar)

Para una sección S, en la sesión en curso:

- `consumido(sede)` = suma de los pendientes de esa sede y esa sesión en S con estado `pendiente` o `sentado`. Los cancelados no cuentan.
- `apartado(sede)` = `max(reserva(sede) − consumido(sede), 0)` si todavía no se liberó, o 0 si ya se liberó.
- `libres_fisicos(S)` = libres públicos de S − pendientes de S, exactamente como hoy en `mandar_grupo`.
- **Mandar un grupo "Sin sede"** entra si `cantidad ≤ libres_fisicos(S) − Σ apartado(todas las sedes en S)`.
- **Mandar un grupo de Catán** entra si `cantidad ≤ libres_fisicos(S) − Σ apartado(las otras sedes en S)`.

Consecuencia: si a Catán le quedan 2 y llegan 3, el grupo entra igual (2 salen de lo de Catán y 1 de lo libre), sin un caso especial. El `max(…, 0)` absorbe el excedente.

- La Puerta usa estas mismas cuentas para mostrar "libres" y "quedan N". Para el "grupo máximo junto", los lugares apartados se descuentan virtualmente de las filas del fondo, como ya hace `colocarVirtual` (§10b del diseño de la Etapa 1).
- `mandar_grupo` recibe la sede, que es opcional, y guarda `sede_id` y `sesion_id` en el pendiente. Toma el mismo advisory lock de sección que hoy y hace el cálculo en una sola sentencia.
- Si alguien de Catán se levanta y se va ("Se levantó alguien"), el lugar no le vuelve a Catán: vuelve a lo libre (decisión del diseñador).

## 5. Restricciones

- Se mantiene todo lo de la Etapa 1: RPC `SECURITY DEFINER` con clave, RLS sin policies, migraciones versionadas en `supabase/migrations/`, tiempo del servidor y zona horaria `America/Argentina/Buenos_Aires`.
- Next 16: leer `node_modules/next/dist/docs/` antes de escribir código (`AGENTS.md`).
- Sin git: se omiten los pasos de commit.
- Se mantienen las reglas de accesibilidad y diseño "cálido" de la Etapa 1. Los chips de sede son `button` con `aria-pressed` y tienen un tamaño de toque cómodo.

## 6. Decisiones del diseñador (no acordadas con el usuario; revisar)

- Las reservas son **por sesión**, no por día ni por evento. El usuario dijo que cambian mucho entre días: el viernes es tranquilo y el sábado y el domingo explotan.
- La **sesión en curso** la determina la hora del servidor: es la primera sesión del evento cuyo `inicio_at` es mayor que `ahora − 3 h`. Nadie la elige a mano. Funciona porque entre sesiones hay más de 3 h 20 min (§3.4). Si algún día las sesiones quedan más pegadas, hay que agregar un horario de fin a `sesion`.
- La validación "suma de reservas ≤ capacidad" se hace contra la **capacidad pública total** de la sección, no contra los libres del momento, porque el salón se vacía entre sesiones (§3.4).
- **"Corregir conteo" no descuenta de la reserva de la sede.** Si un grupo de una sede se sienta sin pasar por la Puerta, esas sillas quedan contadas dos veces (como ocupadas y como apartadas) hasta la liberación. Es un límite conocido: arreglarlo exigiría elegir la sede al corregir, y eso suma un toque en la hora pico.
- **Sede completa**: se trata como "Sin sede" y no se bloquea.
- **Importar un CSV** reemplaza todas las reservas de las sesiones que aparecen en el archivo y no toca las demás. Antes de confirmar se muestra una vista previa con los errores por fila: sección inválida, sesión inexistente, cantidad no positiva. Si en el archivo aparece una sede nueva, se agrega al catálogo y la vista previa lo avisa.
- La suma de las reservas de una sección en una sesión **no puede superar** la capacidad pública de esa sección. Si la supera, se rechaza con un mensaje claro.
- "Se levantó alguien" no devuelve el lugar a la sede (§4).
- La liberación queda en 20 minutos y se guarda como un valor por evento, editable desde Supervisor.

## 7. Dejado al constructor

- La forma exacta del esquema (columnas en `pendiente`, tabla `reserva`, `nombre` en `sesion`) y las firmas de las RPC nuevas.
- Cómo `obtener_estado_salon` expone la sesión en curso, las reservas y lo consumido, y cómo los deriva el estado del cliente (`src/state/`).
- El diseño de la pantalla de carga en Supervisor: la tabla a mano, la vista previa del CSV y la carga de sesiones.
- Cómo parsear el CSV. No se agrega una dependencia si alcanzan unas pocas líneas, pero hay que aceptar comillas y separador `;` porque Excel en español exporta así.
- Tests con Vitest para las cuentas de §4 y pgTAP para las RPC, como en la Etapa 1.

## 8. Pendientes (a confirmar con el equipo)

- El tiempo de liberación exacto (hoy son 20 min).
- Cómo identificar la sede de cada persona (pulseras, credenciales), por fuera de la app.
- Las sesiones reales del evento y cuántas tiene el jueves.
- Si el equipo de ujieres está de acuerdo con el reparto por sede (la idea es del usuario).

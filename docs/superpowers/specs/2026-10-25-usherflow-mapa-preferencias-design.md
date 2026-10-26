# UsherFlow — Etapa 3: mapa de preferencias por sector

Fecha: 2026-10-25 · Estado: borrador para aprobación
Extiende `2026-10-22-usherflow-etapa-2-design.md`. De ese documento cambian dos cosas, marcadas en §6: la reserva pasa de "por sección" a "por sector", y los pastores de sede ahora entran a la app. El resto sigue vigente.

## 1. Intención y por qué

Hoy el reparto por sede se carga como una tabla (`sede, sección, sesión, cantidad`). Un pastor ve "Sección centro, 20 lugares" y no tiene idea de qué lugar es: adelante, atrás, cerca del pasillo. Tampoco puede decir qué prefiere.

**Idea central:** un mapa del salón, parecido al de venta de entradas, donde cada pastor de sede marca dónde le gustaría sentar a su gente. Es una **ayuda visual e intuitiva**, no una reserva: la preferencia no aparta nada. Quien decide es el supervisor, que ve las preferencias de todas las sedes y fija la asignación final.

El mapa vive en la **fase de reservas**, que tiene una **fecha límite**. Pasada la fecha, el mapa se cierra. El día del evento siguen Puerta y Sección, que sirven para tres cosas: comprobar que se cumple lo reservado, que nadie se cuele en una sección que no es suya, y saber cuándo el salón se llenó con los que reservaron para decidir si hay que agregar sillas para quienes llegaron sin reservar.

## 2. Objetivos, no objetivos, anti-objetivos

**Objetivos**
- El pastor de una sede ve el mapa del salón (3 secciones × 3 sectores) y marca su preferencia.
- Los sectores sin cupo se ven en gris y se actualizan solos.
- El supervisor ve las preferencias de todas las sedes superpuestas y fija la asignación final: **sede + sector + cantidad**.
- El día del evento, Puerta le dice a cada grupo a qué sector ir según su sede, y la Sección avisa cuando alguien se sienta en un sector que no le tocaba.
- Los sectores son fijos y el supervisor los puede cambiar muy de vez en cuando.

**No objetivos**
- La preferencia no aparta lugares ni se asigna sola.
- No hay editor visual del mapa: los sectores se editan con un formulario.
- No hay cuentas ni contraseñas de pastores.
- No hay nombres de personas ni DNI. La verificación de sede por DNI se descartó (datos personales y lentitud en Puerta). Si más adelante hace falta, la alternativa liviana es un QR por grupo con la sede y la cantidad, de un solo uso. La sede se identifica por fuera de la app (pulsera de color) y se elige con el chip de Puerta, como en la Etapa 2.
- No se reescribe el flujo de Puerta y Sección: se extiende.

**Anti-objetivos**
- Que un pastor tome su preferencia como una promesa. En pantalla, "preferencia" y "asignado" se ven distintos.
- Que el mapa deje a la Puerta con más toques en la hora pico.
- Que un pastor vea las preferencias o el cupo de otras sedes. Lo único que puede deducir de otras sedes es que un sector ya está lleno (gris), sin saber de quién.

## 3. Cómo funciona

### 3.1 El salón en sectores
- Las 3 secciones (izquierda, centro, derecha) se dividen en **sectores**: rangos de filas dentro de una sección, por ejemplo "Centro adelante: filas 1 a 6, medio 7 a 13, atrás 14 a 20".
- La propuesta es 3 sectores por sección (adelante, medio, atrás). La cantidad y los cortes los define el supervisor.
- Los sectores cubren todas las filas de una sección, sin huecos ni solapes.
- Se guardan como datos de la base. El supervisor los edita en un formulario simple en Supervisor (una fila por sector: sección, nombre, fila desde, fila hasta).
- Mockup elegido por el usuario: `.superpowers/brainstorm/391-1792983032/content/mapa-estetico-v2.html` (opción A del mockup `mapa-granularidad.html`).

### 3.2 Fase de reservas (antes de la fecha límite)
Orden de los pasos (ver §5 para lo que es decisión del diseñador):
1. Cada pastor marca en el mapa los sectores que prefiere. No indica cantidades.
2. El supervisor ve las preferencias de todas las sedes y asigna directamente: sede + sector + sesión + cantidad. Esa es la asignación que vale. El pastor ve lo asignado a su sede. (No hay un "cupo total por sede" aparte: se simplificó al planificar.)

- **Pastor de sede:** entra con un enlace con clave secreta propia de su sede (mismo mecanismo que los QR de los ujieres). Ve el mapa, su cupo, y marca uno o varios sectores como preferencia (azul punteado). Puede cambiarla hasta la fecha límite.
- **Colores del mapa:** verde = queda cupo, gris = agotado, azul punteado = la preferencia de esa sede, y un estado distinto y sólido para "asignado por el supervisor".
- **Gris (agotado):** un sector está agotado cuando la suma de lo asignado a todas las sedes alcanza su capacidad pública. Se actualiza en vivo, como el resto de la app.
- **Supervisor:** ve el mismo mapa con las preferencias de todas las sedes superpuestas (qué sedes pidieron cada sector y cuántos lugares). Desde ahí crea la asignación final: sede + sector + cantidad, por sesión.
- **Fecha límite:** la define el supervisor por evento. Pasada la fecha, el pastor ya no puede cambiar la preferencia y el supervisor puede seguir ajustando la asignación.

### 3.3 Día del evento
- Puerta con la sede elegida muestra el **sector** donde ir ("Catán: andá a Centro medio, quedan 18"), además de la sección.
- La persona elige la fila libremente, siempre que esté dentro del sector asignado a su sede (decisión del usuario).
- Si alguien se sienta fuera de los sectores de su sede, la Sección lo marca para que el ujier lo vea. No lo bloquea.
- Varias sedes pueden compartir un sector: cada una tiene su propia cantidad asignada.
- Las cuentas de apartado, consumo y liberación de la Etapa 2 (§4 y §3.5 de ese diseño) se mantienen, pero ahora por sede y sector en lugar de por sede y sección.

## 4. Restricciones
- Se mantiene todo lo de las Etapas 1 y 2: RPC `SECURITY DEFINER` con clave, RLS sin policies, migraciones versionadas, tiempo del servidor, zona horaria `America/Argentina/Buenos_Aires`.
- Next 16: leer `node_modules/next/dist/docs/` antes de escribir código (`AGENTS.md`).
- Sin git: se omiten los pasos de commit.
- Accesibilidad: cada sector del mapa es un `button` con texto y estado además del color (el gris y el verde no pueden ser lo único que informe), con `aria-pressed` en la preferencia y foco visible.
- Mobile-first: los pastores lo van a abrir en el celular.
- Diseño visual "cálido" de la Etapa 1.

## 5. Decisiones del diseñador (no acordadas con el usuario; revisar)
- **Una sola figura "supervisor":** el pastor líder y el supervisor son la misma persona (lo dijo el usuario). No hay un tercer rol.
- **Los pastores de sede entran por enlace con clave por sede**, sin cuentas.
- **La preferencia es solo informativa:** no se descuenta de ningún cupo.
- **Los sectores son 3 por sección** (adelante, medio, atrás) como punto de partida.
- **Gris** = la suma asignada a todas las sedes alcanza la capacidad pública del sector.
- **Fecha límite por evento**, no por sede.
- **Una sede puede marcar varios sectores**, sin límite.
- **El cumplimiento en el día es una marca, no un bloqueo.**
- **La asignación final es por sector** (el usuario habló de "sección asignada"; se interpretó como el sector, que es la unidad del mapa).
- **La preferencia es por sede, sin cantidad y sin sesión:** una lista de sectores marcados. Se aplica a todas las sesiones.
- **Gris con asignaciones en curso:** al principio todo se ve verde y se va poniendo gris a medida que el supervisor asigna. Al pastor solo le llega "este sector está lleno", sin datos de otras sedes.
- **`sector_id` en la reserva es opcional.** Vacío significa "toda la sección", que es el comportamiento de la Etapa 2. Así las reservas viejas y el CSV viejo siguen valiendo sin migración.
- **Editar los cortes de los sectores** solo se permite si no hay asignaciones por sector en el evento. Si las hay, el supervisor primero las borra. Se muestra un aviso.
- **Cumplimiento en el día:** se evalúa al sentar. Se marca "fuera del sector asignado" cuando la sede del grupo tiene asignaciones en esa sección pero no en ese sector. "Sin sede" y las sedes sin ninguna asignación en la sesión no se marcan. Lo sentado fuera del sector no descuenta de la asignación de la sede (mismo límite conocido que "Corregir conteo" en la Etapa 2).
- **Puerta:** el chip de sede lista los sectores asignados a esa sede con "quedan N". El grupo se sigue mandando a una sección, como en la Etapa 2. La verificación de cupo se mantiene a nivel sección, con la suma de los apartados por sector de las otras sedes. Si la sede tiene un solo sector, el botón lo nombra directo.
- **Enlaces de pastor:** una clave distinta por sede, guardada en claro como las claves de acceso existentes (hace falta para volver a mostrar el enlace), y un botón en Supervisor para regenerarla si se filtra.
- **Fecha límite:** una sola por evento. Cierra solo las preferencias del pastor. El supervisor puede seguir asignando y puede mover la fecha.

## 6. Qué cambia de la Etapa 2
- La reserva `sede + sección + sesión + cantidad` pasa a `sede + sector + sesión + cantidad`. La sección sigue siendo derivable del sector. Las reservas existentes se migran asignándolas al sector que cubre toda la sección, o se vuelven a cargar (decide el constructor, sin perder datos).
- La Etapa 2 decía "no hay login de pastores" y "no hay página pública". Esto cambia: los pastores de sede entran con enlace, pero solo ven lo suyo.
- La carga por CSV/`.xlsx` de la Etapa 2 se mantiene y pasa a admitir el sector.

## 7. Dejado al constructor
- El esquema de la base (tabla de sectores, preferencias, fecha límite, el sector en la reserva) y las firmas de las RPC.
- Cómo se dibuja el mapa. No hace falta que sea idéntico al salón. Un esquema con bloques alcanza.
- El formulario de edición de sectores y el de la fecha límite.
- Cómo se genera y se muestra el enlace de cada pastor.
- Tests con Vitest para las cuentas y pgTAP para las RPC, como en las etapas anteriores.

## 8. Pendientes (a confirmar con el equipo)
- Los cortes reales de filas de cada sector, que dependen de la plantilla real del salón (hoy son números de prueba).
- La fecha límite de reservas.
- Si el equipo de pastores está de acuerdo con entrar por enlace.

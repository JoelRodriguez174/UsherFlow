# Supervisor en rutas, por pasos (diseño)

Fecha: 2026-10-26. Proyecto: UsherFlow (Next 16, React 19, Tailwind v4, Supabase). Idioma de la UI: español rioplatense.

## 1. Por qué

Hoy `/supervisor` es **una sola página larga** que apila cinco bloques: QR de ujieres y acciones (`SupervisorPanel`), sesiones y reservas (`ReservasPanel`), sectores y sedes (`SectoresPanel`) y el mapa de preferencias (`MapaSupervisor`). Son ~2300 líneas de componentes, mucho scroll, y quien configura **se pierde** entre tantas configuraciones y no sabe qué falta ni por dónde seguir.

La preocupación central del usuario: que la pantalla sea **a prueba de errores** ("APB"). El error que más le preocupa es que alguien **configure mal las secciones, las filas o la información de las sedes** y nadie lo note hasta el evento.

Quién la usa: **una sola persona de confianza, antes del evento**, normalmente desde el celular. Durante el evento no hace falta tocarla; las filas extra del día las agregan los ujieres desde su sección y se quitan al terminar la sesión (eso no cambia).

## 2. Objetivos

1. Dividir Supervisor en **rutas**, una por paso, para que cada pantalla haga un solo trabajo.
2. Ordenar los pasos **por dependencia** (cada paso se apoya en los anteriores) y habilitarlos en ese orden.
3. Una **pantalla de inicio** con los pasos como **desplegables**: cada uno muestra qué datos pide y cuáles ya están cargados, con estado visible.
4. Evitar el error de configuración: **ver antes de guardar**, **avisos de lo que no cierra** y una **Revisión** final que dice "listo" o qué falta.
5. Confirmación solo en acciones destructivas.
6. Mismo estilo visual que el resto de la app.

## 3. No-objetivos y anti-objetivos

- **No** hay "modo evento" ni bloqueo de la configuración durante el servicio (el usuario lo descartó). Supervisor queda siempre editable.
- **No** se cambia el flujo de Puerta, Sección ni Sede, ni las reglas del servidor, salvo que algún dato nuevo sea imprescindible para calcular el estado de un paso.
- **No** se rediseña el sistema visual ni se agregan dependencias de UI nuevas.
- Anti-objetivo (sería un fracaso aunque "funcione"): que alguien termine la preparación con algo mal cargado y la pantalla le diga que está todo bien; o que la división en rutas haga **más** difícil saber el estado general.

## 4. Pasos y rutas (orden de dependencia)

Todas bajo `/supervisor`. El inicio (`/supervisor`) es la lista de pasos.

| # | Paso | Ruta | Qué reúne (hoy vive en) |
|---|------|------|-------------------------|
| 1 | Salón | `/supervisor/salon` | Aplicar plantilla (`SupervisorPanel`) y definir sectores con sus filas (`SectoresPanel`) |
| 2 | Sesiones | `/supervisor/sesiones` | Sesiones y tiempo de liberación (`ReservasPanel`) |
| 3 | Sedes | `/supervisor/sedes` | Crear sedes, fecha límite de preferencias y enlaces de pastor (`SectoresPanel`) |
| 4 | Reservas | `/supervisor/reservas` | Cupo por sede y sector, importación CSV/.xlsx y mapa de preferencias (`ReservasPanel`, `MapaSupervisor`) |
| 5 | QR de ujieres | `/supervisor/qr` | QR de Puerta, las tres secciones y el supervisor; renovar claves (`SupervisorPanel`) |
| 6 | Revisión | `/supervisor/revision` | Resumen final con tildes y avisos |

Por qué ese orden: los sectores dependen de las filas de la plantilla; las reservas dependen de sectores, sesiones y sedes; y el sistema **ya impide cambiar los sectores una vez que hay reservas asignadas** (`SECTORES_CON_ASIGNACIONES`), así que los sectores tienen que estar bien antes. Los QR van al final para que nadie los reparta con el salón a medias.

## 5. Pantalla de inicio (`/supervisor`)

Una lista de los 6 pasos. Cada paso es un **desplegable** (preferir `<details>/<summary>` o botón con `aria-expanded`, según el HTML semántico del proyecto). Cerrado muestra: número, nombre, estado (✅ listo / 🟡 falta algo / 🔒 bloqueado) y un resumen corto ("3 sectores · 752 lugares"). Abierto muestra la **lista de lo que pide el paso**, cada ítem con ✅ o ❌ y un ejemplo ("Ejemplo: Jueves 19:00"), y un botón **"Completar este paso →"** que navega a la ruta del paso.

- Un paso 🔒 se puede abrir para ver qué pide, pero su botón está deshabilitado y dice "Se abre al completar <paso anterior>".
- Arriba: "N de 6 pasos listos".
- Los pasos ya hechos siguen abiertos para corregir.
- Mockups aprobados en el visual companion: `.superpowers/brainstorm/323-1793030168/content/desplegables.html` y `navegacion-pasos.html` (el usuario eligió el desplegable con lo que hay que rellenar).

## 6. Dentro de cada paso

- Una barra de pasos fija arriba (chips con ✅/🟡/🔒 y el paso actual marcado) y un botón **"Siguiente: <paso>"** abajo, deshabilitado hasta que el paso actual esté completo, con el motivo a la vista ("Falta cargar al menos una sesión").
- **Entrar por URL a un paso bloqueado** (Sesiones, Sedes, Reservas, Revisión) muestra "Completá <paso> primero" con un enlace, sin formularios. **El paso QR nunca se bloquea** para ver los QR ni renovar claves (es la salida de emergencia si un QR se filtra); si faltan pasos, muestra un aviso arriba: "El salón todavía no está listo: falta <paso>".
- **Ver antes de guardar** (sectores): resumen del tipo "Sector A: filas 1 a 8 · 64 lugares". **Avisos de lo que no cierra**: filas fuera de todo sector, sectores que se pisan, sede sin reservas, sede sin enlace.
- Confirmación (modal existente) solo en lo destructivo: vaciar auditorio, renovar claves, borrar sesión o sede, rotar enlace, aplicar plantilla.

## 7. Cuándo un paso está "listo" (criterios, a validar contra los datos reales)

Son mi propuesta; el constructor los ajusta a lo que el servidor ya devuelve.

1. **Salón:** hay filas cargadas y **cada sección con filas públicas** (capacidad pública > 0; las filas solo reservadas como Pastores o Alabanza no cuentan) tiene sectores, todas sus filas caen dentro de algún sector y no hay sectores que se pisen.
2. **Sesiones:** hay al menos una sesión y el tiempo de liberación está definido.
3. **Sedes:** hay al menos una sede (la fecha límite es opcional: se avisa si falta, no bloquea).
4. **Reservas:** hay al menos una reserva; aviso (no bloqueo) si una sede no tiene ninguna.
5. **QR:** habilitado cuando 1 a 4 están listos. Los QR siempre se pueden volver a ver.
6. **Revisión:** lista los avisos de los pasos anteriores; "Todo listo" solo si no hay ❌.

## 7b. Qué detecta la Revisión (avisos, no bloqueos)

Además de "falta algo", la Revisión y cada paso muestran **avisos** calculados en el cliente con los datos que ya llegan (sin migración): reservas que superan la capacidad pública de su sección o sector; sesión con fecha pasada; fecha límite posterior al inicio de una sesión; sesión sin reservas; sede sin reservas o sin enlace; nombres de sede casi iguales (posible error de tipeo). Un aviso **no impide avanzar** pero deja el paso en 🟡 y aparece en la Revisión; "Todo listo" exige cero ❌ y muestra los 🟡 que queden.

## 7c. Cuando algo ya hecho vuelve a quedar mal

- El estado se calcula en vivo. Si un paso anterior se rompe (por ejemplo, al aplicar una plantilla nueva), los pasos siguientes **no se vuelven a bloquear** ni se invalidan: se marca el paso roto en 🟡/❌ y la Revisión lo muestra. Los QR ya repartidos siguen funcionando.
- **Aplicar plantilla** reemplaza las filas y puede dejar sectores que ya no coinciden: la confirmación lo advierte ("revisá los sectores después") y el paso Salón muestra el aviso de filas fuera de sector. El constructor verifica en las migraciones si toca la tabla `sector`.
- **Sectores bloqueados por reservas asignadas** (`SECTORES_CON_ASIGNACIONES`): la pantalla Salón explica el motivo y enlaza a Reservas, donde se corrigen o quitan las asignaciones; no hay cambio de servidor.
- El mapa de preferencias es informativo: no condiciona que Reservas esté "listo".

## 7d. Sedes nuevas al importar (decisión del usuario)

- La importación CSV/.xlsx **sigue creando las sedes que no existen**, pero antes de guardar muestra "Sedes nuevas que se van a crear: …" y pide confirmarlo, para que un error de tipeo no cree una sede sin que nadie lo note. Por eso el paso Reservas **no exige** tener sedes creadas: lo exige el aviso, no el bloqueo (Sedes sigue siendo el camino recomendado y está antes en el orden).
- **Los nombres de sede no distinguen mayúsculas, minúsculas ni acentos ni caracteres especiales** ("Catán", "catan" y "CATÁN" son la misma sede). Hoy el servidor ya ignora mayúsculas (`lower`) pero **no acentos** (a diferencia de las sesiones, que usan `unaccent` + `lower`). Esto es un requisito del usuario, así que **sí hay una migración nueva**: comparar sedes con `lower(extensions.unaccent(...))` en `importar_reservas` (existencia, filas repetidas del mismo archivo, alta y reserva), en `guardar_sede` y en cualquier otro punto que busque una sede por nombre, con tests pgTAP y revisando si la restricción única de `sede.nombre` debe pasar a ser sobre el nombre normalizado. La vista previa del cliente aplica la misma normalización para no avisar de "sedes nuevas" que en realidad ya existen.
- Si en la nube ya hubiera sedes duplicadas por acento, la migración no las fusiona: se revisan a mano antes de aplicar.

## 8. Decisiones mías (a revisar)

- **Botón → ruta propia** y no formulario dentro del desplegable: los formularios de sectores y reservas son largos para el celular.
- **Estado de cada paso calculado en el cliente** con los RPC que ya existen (estado del salón, `obtener_reservas`, `obtener_mapa_supervisor`, etc.); **sin RPC nuevos** para el estado de los pasos salvo que falte un dato imprescindible (con migración y tests pgTAP). La única migración prevista es la de nombres de sede sin acentos (§7d).
- **Dónde caen las acciones sueltas:** *Aplicar plantilla* y *Vaciar auditorio* → Salón; *Renovar claves* → QR de ujieres.
- **Estructura de Next:** un `layout.tsx` en `src/app/supervisor/` que monta una sola vez las claves y el `SalonProvider` para todas las rutas (hoy lo hace `SupervisorPagina`). Mantener el remontaje por `key` tras "Renovar claves" (la clave vieja deja de servir en el servidor).
- **Dividir los paneles existentes** en componentes por paso reutilizando su lógica y sus tests; los contadores `vSectores`/`vReservas` que sincronizan los paneles entre sí dejan de hacer falta si cada ruta carga sus datos al entrar.
- La URL de entrada de los supervisores (`/entrar?k=…` → `/supervisor`) no cambia.

## 9. Restricciones

- **Next 16 con cambios incompatibles:** antes de escribir código leer la guía relevante en `node_modules/next/dist/docs/` (lo exige `AGENTS.md`).
- Estilo: tokens de `src/app/globals.css` (`bg-superficie`, `text-texto`, `text-texto-suave`, `border-borde`, `bg-acento`, `font-titulo`...), `Boton`, `Aviso`, `Modal`, `lucide-react`. Nunca colores literales en componentes.
- Mobile-first (se verifica a 360 px), objetivos táctiles ≥ 44 px, `aria-label` en botones de solo ícono, foco visible, inputs ≥ 16 px.
- Mantener los tests actuales (vitest 446, pgTAP 1004) en verde; los tests de `SupervisorPanel`, `ReservasPanel`, `SectoresPanel` y `MapaSupervisor` se adaptan al mover componentes. Agregar tests para la lógica de "paso listo" y para el bloqueo por URL.
- El repo ya existe (https://github.com/JoelRodriguez174/UsherFlow.git, rama `main`); commits en español, con la atribución estándar.

## 10. Qué queda al constructor

Nombres de archivos y componentes, cómo se parte cada panel, el componente exacto del desplegable, los textos finos de los avisos, y los criterios de "listo" si los datos reales obligan a ajustarlos.

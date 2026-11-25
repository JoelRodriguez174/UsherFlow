# UsherFlow — Contexto para Gemini

Este documento te da contexto para trabajar en este repositorio. Leelo entero antes de tocar código. El `README.md` tiene las instrucciones operativas (cómo levantarlo y crear un evento); acá está el resto: qué es el proyecto, cómo está armado, cómo se trabajó y con qué skills y plugins.

**Idioma:** el código, la UI, los commits y la documentación están en español rioplatense (voseo). Mantenelo así.

---

## 1. Qué es

UsherFlow es una app web mobile-first, en tiempo real, para el equipo de ujieres de una iglesia en conferencias de ~700 personas, en un salón con **sillas móviles sin numerar**. Todavía no se usó en un evento real.

**El problema de fondo es la confianza en el dato, no la cantidad de botones.** En la hora pico (~1 h antes del servicio) los ujieres no saben si los lugares que figuran libres están libres de verdad, entonces revisan una y otra vez y terminan moviendo gente. El objetivo es que el dato sea confiable: **todo lugar ocupado es algo que un ujier confirmó**. Nada se libera ni se da por sentado solo.

### Roles

| Rol | Ruta | Qué hace |
|---|---|---|
| Puerta | `/puerta` | Elige el tamaño del grupo (1–5+) y lo manda a una sección (izquierda, centro o derecha). **No elige la fila.** |
| Sección | `/seccion/[seccion]` | Recibe el aviso ("Vienen 3"), la app le sugiere una fila y el ujier confirma con un toque. **Decide la fila.** También tiene "No llegaron", "Se levantó alguien", "Corregir conteo" y "Ya revisé". |
| Supervisor | `/supervisor/*` | Prepara el evento antes del servicio, en pasos: Salón → Sesiones → Sedes → Reservas → QR → Revisión. |
| Pastor de sede | `/sede` | Carga las reservas de **su** sede dentro de su cupo y ve solo lo suyo. |

**Acceso:** nadie tiene cuenta. Se entra por enlace o QR con una clave secreta (`/entrar?k=<clave>&rol=...`); la clave se guarda en el cliente y viaja como parámetro de cada RPC. No se usa Supabase Auth.

### Conceptos del dominio

- **Fila → tramos:** cada fila es una secuencia ordenada de tramos, cada uno público o reservado (con etiqueta). El "grupo máximo que entra junto" de una fila es el mayor espacio libre dentro de **un solo** tramo público.
- **Pendiente:** un grupo mandado por la Puerta deja sus lugares apartados hasta que la Sección lo confirma. A los ~3 min sin confirmar se marca en ámbar.
- **Fragmentación:** "Se levantó alguien" en una fila con 4 o más ocupados la marca `fragmentada` y deja de ofrecerse a grupos de 2 o más hasta que el ujier toque "Juntos". "Corregir conteo" no fragmenta.
- **Plantilla:** secciones, filas, tramos y reservas fijas (`src/config/plantilla.ts` todavía es un ejemplo).
- **Etapa 2, reservas por sede:** la unidad es `sede + sector + cantidad + sesión`, sin nombres de personas. Hay cupo por sede, tope por sector, sesiones (jue a dom, mañana y tarde) y liberación automática de los lugares reservados que no se usan.

**Anti-objetivos** (cuentan como fracaso aunque "funcione"): que la app imponga la fila; que muestre libre algo ocupado; que la hora pico exija muchos toques por grupo.

---

## 2. Stack

- **Next.js 16** (App Router) + **React 19** + **Tailwind CSS v4** + `lucide-react`.
- **Supabase** (Postgres + Realtime `postgres_changes` + funciones RPC en `plpgsql`). Corre en local con Docker.
- `qrcode` para los QR y `read-excel-file` para importar reservas desde .xlsx/CSV.
- Tests: **Vitest + Testing Library + jsdom** en el cliente y **pgTAP** (`supabase test db`) en la base.
- Proyecto vinculado a Vercel (`.vercel/`), sin deploy automatizado.

> ⚠️ **Next.js 16 tiene cambios que rompen compatibilidad** respecto de lo que probablemente conocés (ver `AGENTS.md`). Antes de escribir código de Next, leé la guía que corresponda en `node_modules/next/dist/docs/` y respetá los avisos de deprecación. No asumas APIs de Next 13–15.

---

## 3. Arquitectura

```
src/
  app/            Rutas (App Router). Las page.tsx son finas y delegan en components/paginas.
    entrar/       Lee ?k=&rol=, guarda el acceso y redirige.
    puerta/  seccion/[seccion]/  sede/
    supervisor/   layout.tsx (claves + estado de pasos compartido) y una subruta por paso.
  components/
    paginas/      Contenedores por rol: conectan Supabase/Realtime con las vistas.
    puerta/ seccion/ sede/ mapa/   Vistas por rol (presentacionales, probadas aparte).
    supervisor/   Shell, MarcoPaso, PasosInicio, hooks (usePreparacion, useRpcSupervisor, useArmado).
    supervisor/pasos/  Un componente por paso: Salon, Sesiones, Sedes, Reservas, Qr, Revision.
    ui/           Primitivas propias: Boton, Modal, Aviso, IndicadorConexion.
  domain/         Lógica pura sin React ni Supabase: disponibilidad, sugerencia de fila,
                  fragmentación, pendientes, plantilla, resumen, preparación, sedes.
  lib/            supabase.ts (cliente único), rpc.ts (wrapper con timeout y ClaveInvalidaError),
                  acceso.ts (guardar/leer clave), ajustes.ts, csv.ts, fechas.ts (hora AR).
  config/         plantilla.ts
  utils/          Sonidos de feedback.
supabase/
  migrations/     19 migraciones en orden (base, salón, flujo, supervisor, sedes, reservas, sectores...).
  tests/database/ Un test pgTAP por migración (001_… a 017_…).
docs/superpowers/ specs/ (diseños aprobados) y plans/ (planes de implementación por etapa).
```

**Reglas de la arquitectura:**

1. **Toda escritura pasa por una RPC `plpgsql`** que valida la clave y aplica las reglas en el servidor (`mandar_grupo`, `sentar_pendiente`, `se_levanto`, `corregir_conteo`, `guardar_sectores`, `importar_reservas`, etc.). El cliente no escribe tablas directo. La concurrencia (dos Puertas mandando al mismo tiempo) se resuelve en la base, no en el cliente.
2. **Las lecturas** se hacen por RPC (`obtener_estado_salon`, `obtener_reservas`, ...) y se refrescan con Realtime.
3. **La lógica de dominio va en `src/domain/`**, pura y con su test al lado (`*.test.ts`). Los componentes la consumen y no la duplican.
4. **Las llamadas RPC usan `src/lib/rpc.ts`** (timeout `RPC_TIMEOUT_MS`, resultado tipado y manejo de clave inválida). No llames `supabase.rpc` suelto.
5. **Las fechas usan `src/lib/fechas.ts`** (zona horaria de Argentina).
6. **No se agregan dependencias de UI** (ni HeroUI ni shadcn): el proyecto tiene sus propias primitivas en `components/ui/`.

**Tablas:** `evento`, `acceso`, `acceso_sede`, `sector`, `fila`, `tramo`, `pendiente`, `registro`, `sede`, `sesion`, `reserva`, `preferencia`.

---

## 4. Seguridad y cuidados (no negociables)

- Las migraciones de `supabase/migrations/` son **destructivas desde la primera**: borran el esquema viejo. Nunca las apliques a un proyecto hospedado con datos.
- `crear_evento` solo la ejecuta el rol de servicio y se corre desde SQL o Studio.
- Nunca actives el registro de sentencias o parámetros en Postgres (`log_statement='all'`, pgaudit, auto_explain con parámetros): las claves viajan como parámetro de las RPC.
- No se guardan datos personales; las reservas son por sede, nunca por persona.
- `.env.local` tiene credenciales: no lo leas en voz alta, no lo commitees y no lo copies.

---

## 5. Cómo se trabajó (metodología)

El proyecto se construyó con Claude Code y el plugin **Superpowers**, con este flujo:

1. **Brainstorming → spec.** Cada cambio grande empezó con un diseño en `docs/superpowers/specs/AAAA-MM-DD-<tema>-design.md` (intención, roles, objetivos, no-objetivos y anti-objetivos). Los mockups HTML del brainstorming visual están en `.superpowers/brainstorm/`.
2. **Plan.** El spec aprobado se convierte en un plan por tareas en `docs/superpowers/plans/`.
3. **TDD.** Primero el test que falla (Vitest o pgTAP) y después el código.
4. **Worktrees y subagentes.** Las tareas independientes se hicieron en ramas `wt/tN` y se integraron en una rama de feature (ver `git log`).
5. **Verificación antes de decir "listo"**: `npm run lint` (0 errores, 0 warnings), `npm test`, `npm run test:db` y `npm run build`.
6. **Commits** en español con prefijo convencional (`feat:`, `fix:`, `refactor:`, `test:`).

**Documentos vigentes, en orden de lectura:**
- `docs/superpowers/specs/2026-10-22-usherflow-rediseno-y-reservas-design.md`: diseño base (Etapas 1 y 2).
- `docs/superpowers/specs/2026-10-22-usherflow-etapa-2-design.md`
- `docs/superpowers/specs/2026-10-25-usherflow-mapa-preferencias-design.md`
- `docs/superpowers/specs/2026-10-26-usherflow-supervisor-rutas-design.md`: Supervisor por pasos.
- Los planes correspondientes, en `docs/superpowers/plans/`.
- `PLAN.md` es el plan original y quedó **superado**; no lo tomes como referencia.

---

## 6. Skills y plugins

Las *skills* son carpetas con un `SKILL.md` (instrucciones en Markdown, a veces con referencias extra) que el agente carga cuando la tarea coincide con su descripción. Gemini no las carga solo: **cuando una tarea coincida, abrí el `SKILL.md` indicado y seguilo.**

### 6.1 Plugins de Claude Code habilitados

| Plugin | Para qué se usó en este proyecto |
|---|---|
| **superpowers** (`claude-plugins-official`) | Toda la metodología de la sección 5: `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `using-git-worktrees`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review` y `finishing-a-development-branch`. Los specs y planes de `docs/superpowers/` salen de este plugin. |
| **ponytail** (`DietrichGebert/ponytail`) | Modo "senior perezoso": el cambio completo más chico posible, sin abstracciones ni dependencias que nadie pidió, reutilizar lo que ya existe y dejar un test mínimo para la lógica no trivial. Incluye `ponytail-review` y `ponytail-audit` para revisiones. |
| **modern-web-guidance** (`claude-plugins-official`) | Buenas prácticas actuales de HTML, CSS y JS del cliente (modales, formularios, layout, rendimiento). |
| **vercel** (`claude-plugins-official`) | Guías de Next.js, React y Vercel, más el MCP de Vercel. El proyecto está vinculado (`.vercel/`), pero no hay deploy automatizado. |

### 6.2 Skills del proyecto (`.agents/skills/`, dentro del repo)

| Skill | Cuándo aplicarla |
|---|---|
| `nextjs-app-router-patterns`, `nextjs-best-practices` | Rutas, layouts y componentes de servidor y cliente. Ojo: están escritas para Next 14 y hay que contrastarlas con la doc de Next 16 en `node_modules`. |
| `react-best-practices` | Rendimiento de React y fetching de datos. |
| `mobile-design` | UX táctil a una mano, zona del pulgar, tipografía y color en móvil (incluye archivos de referencia). |
| `ui-states` | Estados que se suelen olvidar: vacío, cargando, error, sin conexión y éxito. |
| `ui-a11y` | Auditoría y corrección de accesibilidad. |
| `api-security-best-practices` | Diseño seguro de las RPC (validar la clave y las entradas). |
| `secrets-management` | Manejo de claves y secretos. |
| `playwright-skill` | Pruebas end-to-end en el navegador. |

### 6.3 Skills globales del usuario relevantes (`~/.claude/skills/` y `~/.agents/skills/`)

| Skill | Cuándo aplicarla |
|---|---|
| `supabase` | Cualquier tarea de Supabase: RPC, Realtime, CLI, migraciones, RLS. |
| `supabase-postgres-best-practices` | **Antes** de escribir o cambiar SQL: tablas, migraciones, funciones, triggers, índices, tests pgTAP. (El último fix, un `UPDATE` sin `WHERE` en un trigger, es justo el tipo de error que esta skill previene.) |
| `web-design-guidelines` | Revisar la UI contra guías de interfaz y accesibilidad. |
| `taste-skill`, `awesome-design` | Dirección estética. El proyecto ya tiene su propio estilo visual cálido: no lo rediseñes sin que te lo pidan. |
| `unvime-thesis-assistant` | Solo si te piden documentar algo para la tesis. |

Hay otras skills globales instaladas (Three.js/R3F, HeroUI, shadcn, SIU-Guaraní) que **no aplican** a este proyecto.

---

## 7. Preferencias del usuario para UI

- HTML semántico primero (`button`, `a`, `label`, `nav`, `main`); ARIA solo si hace falta.
- Botones de solo ícono con `aria-label`, íconos decorativos con `aria-hidden="true"` y todo `<img>` con `alt`.
- Nunca quitar el `outline` sin un reemplazo con `:focus-visible`. Los modales atrapan el foco y lo devuelven al cerrar.
- Inputs con `font-size` de 16px o más en móvil, `label` asociado y `type`/`autocomplete` correctos. Nunca bloquear el pegado.
- Mobile-first con los prefijos responsivos de Tailwind. Pensado para celulares de 6.1" a 6.7" en vertical y operado con una mano. Supervisor y Sede también tienen versión de escritorio.

---

## 8. Comandos

```bash
npm install
npx supabase start     # necesita Docker; aplica las migraciones
npm run dev
npm run lint           # tiene que dar 0 errores y 0 warnings
npm test               # Vitest
npm run test:db        # pgTAP (con Supabase levantado)
npm run build
```

## 9. Estado y pendientes

- Etapa 1 (Puerta/Sección), Etapa 2 (reservas por sede), mapa de preferencias y Supervisor por pasos: **construidos**. Falta la prueba manual en celular de la Etapa 2.
- Pendiente con el equipo: sesión del jueves, tiempos de liberación y topes de reservas.
- Pendiente: cargar la plantilla real del salón y reemplazar el logo por uno de alta resolución.

# Plan por fases — Cuentas de pastores de sede (Allowlist + 2FA)

Basado en [2026-11-25-cuentas-pastores-sede-design.md](../specs/2026-11-25-cuentas-pastores-sede-design.md).  
Cada fase cierra con: tests pasando (`pgTAP` / `Vitest` / `lint`), revisión de ciberseguridad y aprobación del usuario antes de pasar a la siguiente.

---

## Fase 1 — Base de datos y lista blanca del supervisor
**Objetivo:** modelar `public.sede_pastor` y permitir que el supervisor cargue/edite/importe emails autorizados por sede de forma segura.

- [x] Migración SQL nueva (`20261125000100_sede_pastor.sql`):
  - Tabla `public.sede_pastor (sede_id uuid primary key references public.sede(id) on delete cascade, email text not null, updated_at timestamptz not null default now())` con índice único sobre `email` (normalizado en minúsculas) y `check` de formato básico.
  - RLS activado en `sede_pastor` sin acceso directo para `anon`/`authenticated`.
  - RPC `guardar_email_sede(p_clave text, p_sede_id uuid, p_email text)`: valida clave de supervisor, normaliza `lower(trim(p_email))`, permite `null`/vacío para desautorizar, rechaza email duplicado en otra sede (`EMAIL_DUPLICADO`) y registra en `public.registro`.
  - RPC `importar_emails_sedes(p_clave text, p_filas jsonb, p_simular boolean default false)`: acepta `[{sede, email}]`, valida todas las filas atómicamente (formato, duplicados en archivo y en DB, sedes nuevas a crear, sedes que cambian de email) y aplica solo si `p_simular = false`.
  - Extender `obtener_mapa_supervisor(p_clave)` para devolver `email_autorizado` y si ya activó cuenta (`cuenta_activa` booleano).
- [x] Test pgTAP (`019_sede_pastor.test.sql`): alta, edición, revocación, duplicados insensibles a mayúsculas, simulación vs confirmación de importación, y rechazo con clave de ujier o acceso directo a la tabla.
- [x] **Checklist de seguridad Fase 1:** verificar `revoke all`, `security definer`, `set search_path = ''`, RLS sin políticas permisivas, y que `obtener_mapa_sede` nunca filtre emails de otras sedes.

---

## Fase 2 — Auth de pastores + 2FA por código de 6 dígitos en servidor
**Objetivo:** habilitar Supabase Auth para pastores con verificación obligatoria de lista blanca + segundo factor de 6 dígitos por email validado en Postgres.

- [x] Habilitar `[auth]` e Inbucket/Mailpit en `supabase/config.toml` para pruebas locales (`minimum_password_length = 8`, `otp_expiry = 600`).
- [x] Instalar `@supabase/ssr` y crear cliente de servidor para sesiones en cookies `HttpOnly` (`src/lib/supabaseServer.ts`), manteniendo `src/lib/supabase.ts` intacto para ujieres/supervisor.
- [x] Migración SQL de sesiones 2FA + RPCs autenticadas (`20261125000200_auth_pastor_2fa.sql`):
  - Trigger `before insert on auth.users` que bloquea registros fuera de `public.sede_pastor`.
  - Tabla `private.pastor_sesion_2fa (user_id, session_id, verificado_en, expira_en)` + helper `private.sede_de_pastor_autenticado()` que exige JWT válido + email vigente en `sede_pastor` + sesión 2FA activa.
  - RPCs `estado_email_pastor`, `confirmar_2fa_pastor` (valida `amr = 'otp'` reciente), `revocar_2fa_pastor`, `obtener_eventos_pastor`, `obtener_mapa_sede_auth` y `guardar_reservas_sede_auth`.
- [x] Route Handlers en `src/app/api/sede/`: `auth/iniciar`, `auth/login`, `auth/recuperar`, `auth/verificar-codigo`, `auth/definir-clave`, `auth/salir`, `sesion`, `mapa` y `reservas`.
- [x] Tests pgTAP (`020_auth_pastor_2fa.test.sql`) + tests unitarios (`pastorAuth.test.ts`, `authRoutes.test.ts`).
- [x] **Checklist de seguridad Fase 2:** cookies `HttpOnly`/`SameSite=Lax`, sin bypass de 2FA llamando RPCs directo con el JWT del paso 1, revocación inmediata al cambiar el email en `sede_pastor`, y límites de intentos/vencimiento del código.

---

## Fase 3 — Panel del Supervisor (`/supervisor/sedes`)
**Objetivo:** reemplazar enlaces de sede por gestión de emails autorizados + importación Excel/CSV.

- [ ] Lógica pura en `src/lib/csv.ts` (o `src/domain/sedesEmail.ts`) + tests unitarios para parsear y validar planillas `sede, email`.
- [ ] Actualizar `src/components/supervisor/pasos/SedesPaso.tsx`:
  - Edición inline del email autorizado por sede + badge (`Sin email`, `Pendiente de activar`, `Cuenta activa`).
  - Subida de `.xlsx` / `.csv` con vista previa de simulación (sedes nuevas, cambios de email, errores por línea) y botón de confirmación.
- [ ] Actualizar `src/domain/preparacion.ts` y tests (`SedesPaso.test.tsx`, `preparacion.test.ts`).
- [ ] **Checklist de seguridad Fase 3:** validación de tamaño/tipo de archivo, sin inyección en nombres/emails, mensajes de error claros sin filtrar internos.

---

## Fase 4 — Pantalla de ingreso y Panel del Pastor (`/sede/ingresar` y `/sede`)
**Objetivo:** experiencia móvil y escritorio clara para el pastor, conectada al mapa estilo Movistar Arena.

- [ ] Crear `src/app/sede/ingresar/page.tsx` y flujo guiado (Email → Contraseña / Primera activación → Código de 6 dígitos → Redirección a `/sede` + "¿Olvidaste tu contraseña?").
- [ ] Actualizar `src/components/paginas/SedePagina.tsx` y `src/components/sede/SedePanel.tsx` para usar sesión autenticada, selector de evento si hay más de uno abierto y botón `Cerrar sesión`.
- [ ] Actualizar `GuiaUso.tsx` (`rol="supervisor"` y `rol="sede"`) para reflejar el ingreso con email + contraseña + código de 6 dígitos.
- [ ] Verificación completa: `npm run lint`, `npm test`, `npm run test:db`, `npm run build` y **auditoría final de ciberseguridad** (OWASP Top 10 / RLS / cookies / headers / flujo completo en vivo con Mailpit local).

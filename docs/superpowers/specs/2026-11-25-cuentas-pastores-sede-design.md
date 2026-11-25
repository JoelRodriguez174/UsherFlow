# Cuentas de pastores de sede con lista blanca y 2FA por email

**Fecha:** 2026-11-25  
**Estado:** Aprobado  
**Alcance:** Autenticación de pastores (`/sede/ingresar`, `/sede`), gestión de emails autorizados + Excel/CSV en `/supervisor/sedes`, y RPCs autenticadas en Supabase.  
**Fuera de alcance:** Los ujieres de Puerta (`/puerta`) y Sección (`/seccion/*`) mantienen su acceso actual por QR sin cuenta para no agregar fricción en la hora pico.

## Intención

Reemplazar el acceso por enlace con clave fija de los pastores de sede por cuentas individuales controladas por una **lista blanca de emails** administrada por el supervisor (manual o por Excel/CSV), con **contraseña + código de 6 dígitos al correo (2FA)**, de modo que solo los pastores de nuestras sedes puedan ingresar y reservar en el mapa del salón.

## Decisiones

1. **Identificación por lista blanca (Allowlist):** una tabla `public.sede_pastor` vincula cada sede a 1 email autorizado (normalizado en minúsculas, editable por el supervisor). Si el supervisor cambia el email de una sede, el anterior pierde acceso inmediatamente en el servidor.
2. **Carga individual y masiva:** en `/supervisor/sedes` el supervisor puede editar el email de cada sede o importar una planilla `.xlsx` / `.csv` (`sede, email`) con vista previa antes de aplicar.
3. **Autenticación en dos factores (contraseña + código de 6 dígitos al email):**
   - **Primera vez:** email autorizado → código de 6 dígitos al email → define contraseña → entra.
   - **Ingresos posteriores:** email + contraseña → código de 6 dígitos al email (2FA) → entra.
   - **Recuperación:** código de 6 dígitos al email para restablecer contraseña.
4. **Eventos automáticos:** al entrar en `/sede`, el pastor ve el evento activo automáticamente (o un selector si hay más de uno abierto). Se retira el flujo de "Generar / Rotar enlace" en `/supervisor/sedes`.

## Modelo de ciberseguridad (requisitos no negociables)

- **Validación en servidor (nunca confiar en el cliente):** toda lectura/escritura del pastor verifica en Postgres tanto el `auth.uid()` / email del JWT como que ese email siga vigente en `public.sede_pastor` y que el 2FA de esa sesión haya sido verificado y no haya vencido.
- **Sin registro abierto:** ningún usuario cuyo email no figure en `public.sede_pastor` puede activar cuenta ni solicitar códigos OTP.
- **Anti-enumeración y rate limiting:** limitar intentos de código de 6 dígitos (ej. máx. 5 intentos por desafío, vencimiento de 10 minutos, código de un solo uso y almacenado con hash `sha256`, nunca en texto plano).
- **Sesión en cookies seguras:** usar `@supabase/ssr` con cookies `HttpOnly` / `SameSite=Lax` / `Secure` en producción, sin exponer tokens en URL ni `localStorage`.
- **Privacidad entre sedes:** ninguna RPC ni respuesta de error revela emails, nombres ni desglose de reservas de otras sedes.
- **RLS y privilegios mínimos:** `sede_pastor` y la tabla de desafíos 2FA con RLS habilitado y sin políticas públicas (`revoke all` para `anon` y `authenticated`); acceso únicamente a través de RPCs `security definer` con `set search_path = ''`.
- **Auditoría:** registrar en `public.registro` los cambios de email autorizado y las importaciones masivas (sin guardar contraseñas ni códigos OTP).

## Fases de entrega

1. **Fase 1 — Base de datos y lista blanca:** migración `sede_pastor` + RPCs del supervisor (`guardar_email_sede`, `importar_emails_sedes`) + tests pgTAP + revisión de seguridad SQL.
2. **Fase 2 — Motor de Auth + 2FA en servidor:** habilitar Supabase Auth local, tabla de desafíos 2FA con hash y límite de intentos, RPCs autenticadas del pastor (`obtener_eventos_pastor`, `obtener_mapa_sede_auth`, `guardar_reservas_sede_auth`), Route Handlers / `@supabase/ssr` + tests pgTAP y unitarios + revisión de ciberseguridad.
3. **Fase 3 — Panel del Supervisor (`/supervisor/sedes`):** edición de email por sede, estado de activación, importación `.xlsx`/`.csv` con simulación previa, actualización de `preparacion.ts` + tests Vitest.
4. **Fase 4 — Ingreso y Panel del Pastor (`/sede/ingresar` y `/sede`):** UI guiada de ingreso/activación/2FA/recuperación, integración con `SedePanel`, cierre de sesión, verificación end-to-end y auditoría final de ciberseguridad.

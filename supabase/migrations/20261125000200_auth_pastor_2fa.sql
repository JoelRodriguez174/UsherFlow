-- Fase 2 (cuentas de pastores): verificación 2FA en servidor + bloqueo de registros fuera de lista blanca +
-- RPCs autenticadas del pastor (`estado_email_pastor`, `confirmar_2fa_pastor`, `revocar_2fa_pastor`,
-- `obtener_eventos_pastor`, `obtener_mapa_sede_auth`, `guardar_reservas_sede_auth`).
--
-- Seguridad (defensa en profundidad):
--   1. Trigger `before insert on auth.users`: rechaza cualquier alta cuyo email no figure en `public.sede_pastor`.
--   2. `private.pastor_sesion_2fa`: vincula (user_id, session_id del JWT) a una verificación OTP reciente (`amr` = 'otp').
--   3. Ninguna RPC de lectura/escritura del pastor funciona sólo con contraseña (`amr` = 'password'): exige sesión 2FA
--      vigente Y que el email siga en `public.sede_pastor` en cada llamada (revocación inmediata al cambiar de email).

-- ---------------------------------------------------------------------------
-- 1. Bloquear altas en auth.users si el email no está en public.sede_pastor
-- ---------------------------------------------------------------------------
create or replace function private.bloquear_registro_no_autorizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalizar_email(new.email);
begin
  if v_email = '' or not exists (select 1 from public.sede_pastor sp where sp.email = v_email) then
    raise exception 'EMAIL_NO_AUTORIZADO';
  end if;
  return new;
end;
$$;

revoke all on function private.bloquear_registro_no_autorizado() from public, anon, authenticated;

drop trigger if exists trg_bloquear_registro_no_autorizado on auth.users;
create trigger trg_bloquear_registro_no_autorizado
  before insert on auth.users
  for each row execute function private.bloquear_registro_no_autorizado();

-- ---------------------------------------------------------------------------
-- 2. Tabla privada de sesiones con 2FA verificado
-- ---------------------------------------------------------------------------
create table private.pastor_sesion_2fa (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  verificado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  primary key (user_id, session_id)
);

revoke all on table private.pastor_sesion_2fa from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers privados de identidad y 2FA del pastor
-- ---------------------------------------------------------------------------
create or replace function private.jwt_session_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(auth.jwt()->>'session_id', ''), '');
$$;

create or replace function private.jwt_tiene_otp_reciente(p_ventana interval default interval '10 minutes')
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) item
     where item->>'method' = 'otp'
       and (item->>'timestamp') ~ '^[0-9]+$'
       and to_timestamp((item->>'timestamp')::double precision) >= clock_timestamp() - p_ventana
  );
$$;

-- Valida: JWT autenticado + email vigente en sede_pastor + sesión 2FA activa (no expirada).
create or replace function private.sede_de_pastor_autenticado()
returns table (user_id uuid, sede_id uuid, email text, session_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := private.normalizar_email(auth.jwt()->>'email');
  v_sid text := private.jwt_session_id();
  v_sede uuid;
begin
  if v_uid is null or v_email = '' or v_sid = '' then
    raise exception 'NO_AUTENTICADO';
  end if;

  select sp.sede_id into v_sede from public.sede_pastor sp where sp.email = v_email;
  if v_sede is null then
    raise exception 'NO_AUTORIZADO';
  end if;

  if not exists (
    select 1 from private.pastor_sesion_2fa s
     where s.user_id = v_uid
       and s.session_id = v_sid
       and s.expira_en > clock_timestamp()
  ) then
    raise exception 'DOS_FACTORES_REQUERIDO';
  end if;

  return query select v_uid, v_sede, v_email, v_sid;
end;
$$;

revoke all on function private.jwt_session_id() from public, anon, authenticated;
revoke all on function private.jwt_tiene_otp_reciente(interval) from public, anon, authenticated;
revoke all on function private.sede_de_pastor_autenticado() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. estado_email_pastor: devuelve sólo {autorizado, cuenta_activa} (sin filtrar nombres ni IDs).
-- ---------------------------------------------------------------------------
create or replace function public.estado_email_pastor(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalizar_email(p_email);
  v_autorizado boolean;
  v_activa boolean;
begin
  if not private.es_email_valido(v_email) then
    return jsonb_build_object('autorizado', false, 'cuenta_activa', false);
  end if;

  select exists (select 1 from public.sede_pastor sp where sp.email = v_email) into v_autorizado;
  if not v_autorizado then
    return jsonb_build_object('autorizado', false, 'cuenta_activa', false);
  end if;

  -- Cuenta activa = existe usuario confirmado en auth.users con contraseña definida (encrypted_password no vacío).
  select exists (
    select 1 from auth.users u
     where lower(u.email) = v_email
       and u.email_confirmed_at is not null
       and coalesce(u.encrypted_password, '') <> ''
  ) into v_activa;

  return jsonb_build_object('autorizado', true, 'cuenta_activa', v_activa);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. confirmar_2fa_pastor / revocar_2fa_pastor
-- ---------------------------------------------------------------------------
create or replace function public.confirmar_2fa_pastor()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := private.normalizar_email(auth.jwt()->>'email');
  v_sid text := private.jwt_session_id();
  v_expira timestamptz := clock_timestamp() + interval '12 hours';
begin
  if v_uid is null or v_email = '' or v_sid = '' then
    raise exception 'NO_AUTENTICADO';
  end if;

  if not exists (select 1 from public.sede_pastor sp where sp.email = v_email) then
    raise exception 'NO_AUTORIZADO';
  end if;

  if not private.jwt_tiene_otp_reciente(interval '10 minutes') then
    return jsonb_build_object('success', false, 'error', 'OTP_REQUERIDO');
  end if;

  -- Limpia sesiones vencidas del mismo usuario y registra la actual.
  delete from private.pastor_sesion_2fa
   where user_id = v_uid and expira_en <= clock_timestamp();

  insert into private.pastor_sesion_2fa (user_id, session_id, verificado_en, expira_en)
  values (v_uid, v_sid, clock_timestamp(), v_expira)
  on conflict (user_id, session_id) do update
    set verificado_en = excluded.verificado_en,
        expira_en = excluded.expira_en;

  return jsonb_build_object('success', true, 'expira_en', v_expira);
end;
$$;

create or replace function public.revocar_2fa_pastor()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := private.jwt_session_id();
begin
  if v_uid is not null and v_sid <> '' then
    delete from private.pastor_sesion_2fa
     where user_id = v_uid and session_id = v_sid;
  end if;
  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPCs autenticadas del pastor: obtener_eventos_pastor, obtener_mapa_sede_auth, guardar_reservas_sede_auth
-- ---------------------------------------------------------------------------
create or replace function public.obtener_eventos_pastor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sede uuid;
begin
  select p.sede_id into v_sede from private.sede_de_pastor_autenticado() p;

  return jsonb_build_object(
    'success', true,
    'sede', (select jsonb_build_object('id', sd.id, 'nombre', sd.nombre) from public.sede sd where sd.id = v_sede),
    'eventos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', e.id,
                 'nombre', e.nombre,
                 'fecha_limite', e.fecha_limite,
                 'abierto', e.fecha_limite is null or clock_timestamp() < e.fecha_limite,
                 'creado_en', e.creado_en
               )
               order by (e.fecha_limite is null or clock_timestamp() < e.fecha_limite) desc, e.creado_en desc)
        from public.evento e), '[]'::jsonb));
end;
$$;

create or replace function public.obtener_mapa_sede_auth(p_evento_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sede uuid;
  v_limite timestamptz;
begin
  select p.sede_id into v_sede from private.sede_de_pastor_autenticado() p;

  if p_evento_id is null or not exists (select 1 from public.evento e where e.id = p_evento_id) then
    return jsonb_build_object('success', false, 'error', 'EVENTO_INVALIDO');
  end if;

  select e.fecha_limite into v_limite from public.evento e where e.id = p_evento_id;

  return jsonb_build_object(
    'success', true,
    'sede', (select jsonb_build_object('id', sd.id, 'nombre', sd.nombre) from public.sede sd where sd.id = v_sede),
    'fecha_limite', v_limite,
    'abierto', v_limite is null or clock_timestamp() < v_limite,
    'sectores', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.id, 'seccion', s.seccion, 'nombre', s.nombre,
                                  'fila_desde', s.fila_desde, 'fila_hasta', s.fila_hasta)
               order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
        from public.sector s where s.evento_id = p_evento_id), '[]'::jsonb),
    'preferencias', coalesce((
      select jsonb_agg(p.sector_id order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
        from public.preferencia p
        join public.sector s on s.id = p.sector_id
       where p.sede_id = v_sede and s.evento_id = p_evento_id), '[]'::jsonb),
    'sesiones', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', ss.id,
                 'nombre', ss.nombre,
                 'inicio_at', ss.inicio_at,
                 'sectores', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'sector_id', q.id,
                              'agotado', q.total >= q.capacidad,
                              'asignado', q.propio,
                              'capacidad', q.capacidad,
                              'disponibles', greatest(0, q.capacidad - (q.total - q.propio))::integer
                            )
                            order by array_position(array['izquierda', 'centro', 'derecha'], q.seccion), q.orden, q.id)
                     from (select s.id, s.seccion, s.orden,
                                  private.capacidad_sector(s.id) as capacidad,
                                  coalesce(sum(r.cantidad), 0) as total,
                                  coalesce(sum(r.cantidad) filter (where r.sede_id = v_sede), 0)::integer as propio
                             from public.sector s
                             left join public.reserva r on r.sector_id = s.id and r.sesion_id = ss.id
                            where s.evento_id = p_evento_id
                            group by s.id) q), '[]'::jsonb))
               order by ss.inicio_at, ss.nombre)
        from public.sesion ss where ss.evento_id = p_evento_id), '[]'::jsonb));
end;
$$;

create or replace function public.guardar_reservas_sede_auth(
  p_evento_id uuid,
  p_filas jsonb,
  p_sesiones text[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sede uuid;
  v_limite timestamptz;
begin
  select p.sede_id into v_sede from private.sede_de_pastor_autenticado() p;

  if p_evento_id is null or not exists (select 1 from public.evento e where e.id = p_evento_id) then
    return jsonb_build_object('success', false, 'error', 'EVENTO_INVALIDO');
  end if;

  select e.fecha_limite into v_limite from public.evento e where e.id = p_evento_id;
  if v_limite is not null and clock_timestamp() >= v_limite then
    return jsonb_build_object('success', false, 'error', 'FECHA_LIMITE_VENCIDA');
  end if;

  return private.importar_reservas_core(p_evento_id, p_filas, false, p_sesiones, v_sede);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function public.estado_email_pastor(text) from public, anon, authenticated;
revoke execute on function public.confirmar_2fa_pastor() from public, anon, authenticated;
revoke execute on function public.revocar_2fa_pastor() from public, anon, authenticated;
revoke execute on function public.obtener_eventos_pastor() from public, anon, authenticated;
revoke execute on function public.obtener_mapa_sede_auth(uuid) from public, anon, authenticated;
revoke execute on function public.guardar_reservas_sede_auth(uuid, jsonb, text[]) from public, anon, authenticated;

grant execute on function public.estado_email_pastor(text) to anon, authenticated;
grant execute on function public.confirmar_2fa_pastor() to authenticated;
grant execute on function public.revocar_2fa_pastor() to authenticated;
grant execute on function public.obtener_eventos_pastor() to authenticated;
grant execute on function public.obtener_mapa_sede_auth(uuid) to authenticated;
grant execute on function public.guardar_reservas_sede_auth(uuid, jsonb, text[]) to authenticated;

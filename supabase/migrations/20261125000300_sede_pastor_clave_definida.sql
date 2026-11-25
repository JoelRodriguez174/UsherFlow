-- Registra explícitamente cuándo el pastor definió su contraseña (GoTrue puede poblar encrypted_password al crear
-- un usuario OTP, por lo que `clave_definida_en` en `sede_pastor` es la fuente confiable de `cuenta_activa`).

alter table public.sede_pastor
  add column if not exists clave_definida_en timestamptz;

-- 1. estado_email_pastor usa `clave_definida_en is not null`
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

  select true, (sp.clave_definida_en is not null)
    into v_autorizado, v_activa
    from public.sede_pastor sp
   where sp.email = v_email;

  if not coalesce(v_autorizado, false) then
    return jsonb_build_object('autorizado', false, 'cuenta_activa', false);
  end if;

  return jsonb_build_object('autorizado', true, 'cuenta_activa', coalesce(v_activa, false));
end;
$$;

-- 2. marcar_clave_pastor_definida: exige sesión 2FA verificada y marca `clave_definida_en = now()`
create or replace function public.marcar_clave_pastor_definida()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sede uuid;
begin
  select p.sede_id into v_sede from private.sede_de_pastor_autenticado() p;
  update public.sede_pastor
     set clave_definida_en = now(),
         updated_at = now()
   where sede_id = v_sede;
  return jsonb_build_object('success', true);
end;
$$;

-- 3. guardar_email_sede resetea `clave_definida_en` cuando cambia el email
create or replace function public.guardar_email_sede(
  p_clave text,
  p_sede_id uuid,
  p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_email text := private.normalizar_email(p_email);
begin
  perform pg_advisory_xact_lock(hashtextextended('sede_pastor', 0));

  if p_sede_id is null or not exists (select 1 from public.sede s where s.id = p_sede_id) then
    return jsonb_build_object('success', false, 'error', 'SEDE_INVALIDA');
  end if;

  if v_email = '' then
    delete from public.sede_pastor where sede_id = p_sede_id;
    insert into public.registro (evento_id, tipo, detalle)
    values (v_evento, 'email_sede', jsonb_build_object('sede_id', p_sede_id, 'accion', 'quitar'));
    return jsonb_build_object('success', true, 'email', null);
  end if;

  if not private.es_email_valido(v_email) then
    return jsonb_build_object('success', false, 'error', 'EMAIL_INVALIDO');
  end if;

  if exists (select 1 from public.sede_pastor sp where sp.email = v_email and sp.sede_id <> p_sede_id) then
    return jsonb_build_object('success', false, 'error', 'EMAIL_DUPLICADO');
  end if;

  insert into public.sede_pastor (sede_id, email, clave_definida_en, updated_at)
  values (p_sede_id, v_email, null, now())
  on conflict (sede_id) do update
    set email = excluded.email,
        clave_definida_en = case when public.sede_pastor.email = excluded.email then public.sede_pastor.clave_definida_en else null end,
        updated_at = now();

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'email_sede', jsonb_build_object('sede_id', p_sede_id, 'accion', 'guardar'));

  return jsonb_build_object('success', true, 'email', v_email);
end;
$$;

-- 4. obtener_mapa_supervisor usa `clave_definida_en is not null` para `cuenta_activa`
create or replace function public.obtener_mapa_supervisor(p_clave text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
begin
  return jsonb_build_object(
    'success', true,
    'fecha_limite', (select e.fecha_limite from public.evento e where e.id = v_evento),
    'sectores', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.id, 'seccion', s.seccion, 'nombre', s.nombre,
                                  'fila_desde', s.fila_desde, 'fila_hasta', s.fila_hasta,
                                  'capacidad', private.capacidad_sector(s.id))
               order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
        from public.sector s where s.evento_id = v_evento), '[]'::jsonb),
    'sedes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'sede_id', sd.id,
                 'nombre', sd.nombre,
                 'clave_acceso', (select a.clave from public.acceso_sede a
                                   where a.evento_id = v_evento and a.sede_id = sd.id),
                 'email_autorizado', (select sp.email from public.sede_pastor sp where sp.sede_id = sd.id),
                 'cuenta_activa', exists (
                   select 1 from public.sede_pastor sp
                    where sp.sede_id = sd.id and sp.clave_definida_en is not null),
                 'preferencias', coalesce((
                   select jsonb_agg(p.sector_id order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
                     from public.preferencia p
                     join public.sector s on s.id = p.sector_id
                    where p.sede_id = sd.id and s.evento_id = v_evento), '[]'::jsonb))
               order by sd.nombre)
        from public.sede sd), '[]'::jsonb),
    'sesiones', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', ss.id,
                 'nombre', ss.nombre,
                 'inicio_at', ss.inicio_at,
                 'asignado', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('sector_id', r.sector_id, 'sede_id', r.sede_id, 'cantidad', r.cantidad)
                            order by r.sector_id, r.sede_id)
                     from public.reserva r
                    where r.sesion_id = ss.id and r.sector_id is not null), '[]'::jsonb))
               order by ss.inicio_at, ss.nombre)
        from public.sesion ss where ss.evento_id = v_evento), '[]'::jsonb));
end;
$$;

revoke execute on function public.marcar_clave_pastor_definida() from public, anon, authenticated;
grant execute on function public.marcar_clave_pastor_definida() to authenticated;

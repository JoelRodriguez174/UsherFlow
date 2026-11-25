-- Fase 1 (cuentas de pastores): tabla de lista blanca `sede_pastor`, RPCs de gestión para el supervisor
-- (`guardar_email_sede`, `importar_emails_sedes`) y extensión de `obtener_mapa_supervisor`.
--
-- Seguridad:
--   - `sede_pastor` tiene RLS habilitado y sin privilegios para `public`, `anon` ni `authenticated`.
--   - Todo acceso pasa por RPCs `security definer` con `set search_path = ''` que validan la clave de supervisor.
--   - `obtener_mapa_sede` no expone ningún email.

-- ---------------------------------------------------------------------------
-- Tabla public.sede_pastor: 1 email autorizado (único, en minúsculas) por sede
-- ---------------------------------------------------------------------------
create table public.sede_pastor (
  sede_id uuid primary key references public.sede(id) on delete cascade,
  email text not null,
  updated_at timestamptz not null default now(),
  constraint sede_pastor_email_normalizado
    check (email = lower(btrim(email))
           and length(email) <= 254
           and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create unique index sede_pastor_email_uidx on public.sede_pastor (email);

alter table public.sede_pastor enable row level security;
revoke all on table public.sede_pastor from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helper privado: normalización y validación de email
-- ---------------------------------------------------------------------------
create or replace function private.normalizar_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_email, '')));
$$;

create or replace function private.es_email_valido(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select length(p_email) <= 254 and p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
$$;

revoke all on function private.normalizar_email(text) from public, anon, authenticated;
revoke all on function private.es_email_valido(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- guardar_email_sede: asigna, cambia o quita (null/vacío) el email autorizado de una sede.
--   Exige clave de supervisor. Errores: SEDE_INVALIDA, EMAIL_INVALIDO, EMAIL_DUPLICADO.
-- ---------------------------------------------------------------------------
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

  insert into public.sede_pastor (sede_id, email, updated_at)
  values (p_sede_id, v_email, now())
  on conflict (sede_id) do update
    set email = excluded.email,
        updated_at = now();

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'email_sede', jsonb_build_object('sede_id', p_sede_id, 'accion', 'guardar'));

  return jsonb_build_object('success', true, 'email', v_email);
end;
$$;

-- ---------------------------------------------------------------------------
-- importar_emails_sedes: carga/actualiza en lote [{sede, email}] desde Excel/CSV.
--   p_simular = true valida y devuelve resumen {total, sedes_nuevas, cambios} sin escribir.
-- ---------------------------------------------------------------------------
create or replace function public.importar_emails_sedes(
  p_clave text,
  p_filas jsonb,
  p_simular boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_errores jsonb;
  v_validas jsonb;
  v_nuevas jsonb;
  v_cambios integer;
  v_total integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('sede_pastor', 0));

  if jsonb_typeof(p_filas) is distinct from 'array' then
    return jsonb_build_object('success', false, 'error', 'FILAS_INVALIDAS',
      'errores', jsonb_build_array(jsonb_build_object('fila', 0, 'motivo', 'Formato inválido: se esperaba un arreglo')));
  end if;

  with f as (
    select t.ord::integer as ord,
           btrim(coalesce(t.e->>'sede', '')) as sede,
           private.normalizar_email(t.e->>'email') as email
      from jsonb_array_elements(p_filas) with ordinality t(e, ord)
  ), q as (
    select f.ord, f.sede, f.email,
           private.sin_acentos(f.sede) as sede_norm,
           case
             when f.sede = '' then 'Falta el nombre de la sede'
             when f.email = '' then 'Falta el email'
             when not private.es_email_valido(f.email) then 'Email inválido: ' || f.email
           end as motivo
      from f
  ), d as (
    select q.*,
           row_number() over (partition by q.sede_norm order by q.ord) as rn_sede,
           row_number() over (partition by q.email order by q.ord) as rn_email,
           (select sd.id from public.sede sd where private.sin_acentos(sd.nombre) = q.sede_norm order by sd.creado_en, sd.id limit 1) as sede_id
      from q where q.motivo is null
  ), colisiones_db as (
    -- Email ya asignado en DB a otra sede que NO está siendo actualizada en este mismo archivo.
    select d.ord, d.email, sd_otra.nombre as otra_sede
      from d
      join public.sede_pastor sp on sp.email = d.email
      join public.sede sd_otra on sd_otra.id = sp.sede_id
     where d.rn_sede = 1 and d.rn_email = 1
       and (d.sede_id is null or sp.sede_id <> d.sede_id)
       and not exists (select 1 from d d2 where d2.rn_sede = 1 and d2.sede_id = sp.sede_id)
  ), e as (
    select ord, motivo from q where motivo is not null
    union all
    select ord, 'Sede repetida en el archivo: ' || sede from d where rn_sede > 1
    union all
    select ord, 'Email repetido en el archivo: ' || email from d where rn_email > 1
    union all
    select ord, format('El email %s ya está asignado a %s', email, otra_sede) from colisiones_db
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('fila', e.ord, 'motivo', e.motivo) order by e.ord, e.motivo), '[]'::jsonb) from e),
         (select coalesce(jsonb_agg(jsonb_build_object('ord', d.ord, 'sede', d.sede, 'sede_norm', d.sede_norm,
                                                       'email', d.email, 'sede_id', d.sede_id)
                                    order by d.ord), '[]'::jsonb)
            from d where d.rn_sede = 1 and d.rn_email = 1)
    into v_errores, v_validas;

  if jsonb_array_length(v_errores) > 0 then
    return jsonb_build_object('success', false, 'error', 'FILAS_INVALIDAS', 'errores', v_errores);
  end if;

  v_total := jsonb_array_length(v_validas);

  select coalesce(jsonb_agg(x->>'sede' order by (x->>'ord')::integer), '[]'::jsonb)
    into v_nuevas
    from jsonb_array_elements(v_validas) x
   where x->>'sede_id' is null;

  select count(*)::integer
    into v_cambios
    from jsonb_array_elements(v_validas) x
    join public.sede_pastor sp on sp.sede_id = (x->>'sede_id')::uuid
   where sp.email <> (x->>'email');

  if not coalesce(p_simular, false) and v_total > 0 then
    insert into public.sede (nombre)
    select jsonb_array_elements_text(v_nuevas)
    on conflict do nothing;

    -- Dos pasos: primero borra las sedes tocadas (permite intercambiar emails entre dos sedes en el mismo lote), luego inserta.
    with resueltas as (
      select sd.id as sede_id, x->>'email' as email
        from jsonb_array_elements(v_validas) x
        cross join lateral (
          select s.id from public.sede s
           where private.sin_acentos(s.nombre) = (x->>'sede_norm')
           order by s.creado_en, s.id limit 1
        ) sd
    )
    delete from public.sede_pastor sp
     using resueltas r
     where sp.sede_id = r.sede_id;

    with resueltas as (
      select sd.id as sede_id, x->>'email' as email
        from jsonb_array_elements(v_validas) x
        cross join lateral (
          select s.id from public.sede s
           where private.sin_acentos(s.nombre) = (x->>'sede_norm')
           order by s.creado_en, s.id limit 1
        ) sd
    )
    insert into public.sede_pastor (sede_id, email, updated_at)
    select r.sede_id, r.email, now() from resueltas r;

    insert into public.registro (evento_id, tipo, detalle)
    values (v_evento, 'importar_emails_sedes', jsonb_build_object(
      'total', v_total, 'sedes_nuevas', jsonb_array_length(v_nuevas), 'cambios', v_cambios));
  end if;

  return jsonb_build_object('success', true, 'total', v_total, 'sedes_nuevas', v_nuevas, 'cambios', v_cambios);
end;
$$;

-- ---------------------------------------------------------------------------
-- Extender obtener_mapa_supervisor con email_autorizado y cuenta_activa por sede
-- ---------------------------------------------------------------------------
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
                   join auth.users u on lower(u.email) = sp.email
                  where sp.sede_id = sd.id and u.email_confirmed_at is not null),
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

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function public.guardar_email_sede(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.importar_emails_sedes(text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.obtener_mapa_supervisor(text) from public, anon, authenticated;

grant execute on function public.guardar_email_sede(text, uuid, text) to anon, authenticated;
grant execute on function public.importar_emails_sedes(text, jsonb, boolean) to anon, authenticated;
grant execute on function public.obtener_mapa_supervisor(text) to anon, authenticated;

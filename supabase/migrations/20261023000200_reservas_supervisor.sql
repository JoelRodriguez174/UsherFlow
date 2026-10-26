-- UsherFlow Etapa 2 / Tarea 7: RPC de Supervisor para sesiones y reservas.
--   guardar_sesion, borrar_sesion, guardar_liberacion, obtener_reservas, importar_reservas
--
-- Todas exigen la clave de SUPERVISOR (private.evento_de_clave(p_clave, true)); una clave de ujier LANZA
-- CLAVE_INVALIDA. Errores esperados: {success:false, error:CODE}.
--
-- Concurrencia: mandar_grupo calcula el cupo de una sección bajo pg_advisory_xact_lock(evento || sección).
-- Quien cambia `reserva` (importar_reservas, borrar_sesion) toma los TRES locks en orden fijo
-- (izquierda, centro, derecha) antes de escribir, igual que reiniciar_salon, así mandar_grupo ve un
-- apartado consistente y no hay ciclos de espera.
--
-- Nombres de sesión: se comparan sin distinguir mayúsculas ni acentos (unaccent + lower). Las sedes, sólo
-- sin distinguir mayúsculas.
-- Capacidad pública total de una sección = Σ tramo.capacidad de los tramos 'publico' de sus filas (la misma
-- base que usa mandar_grupo para los libres, pero sin descontar ocupados).

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- guardar_sesion: upsert por (evento, nombre normalizado). Devuelve {success, sesion_id}.
-- ---------------------------------------------------------------------------
create function public.guardar_sesion(p_clave text, p_nombre text, p_inicio_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_id uuid;
begin
  if v_nombre = '' then
    return jsonb_build_object('success', false, 'error', 'NOMBRE_INVALIDO');
  end if;
  if p_inicio_at is null then
    return jsonb_build_object('success', false, 'error', 'INICIO_INVALIDO');
  end if;

  select s.id into v_id
    from public.sesion s
   where s.evento_id = v_evento
     and lower(extensions.unaccent(s.nombre)) = lower(extensions.unaccent(v_nombre))
   order by (s.nombre = v_nombre) desc
   limit 1;

  if found then
    update public.sesion set nombre = v_nombre, inicio_at = p_inicio_at where id = v_id;
  else
    insert into public.sesion (evento_id, nombre, inicio_at)
    values (v_evento, v_nombre, p_inicio_at)
    on conflict (evento_id, nombre) do update set inicio_at = excluded.inicio_at
    returning id into v_id;
  end if;

  return jsonb_build_object('success', true, 'sesion_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- borrar_sesion: borra la sesión y sus reservas (cascada). Otro evento = inexistente.
-- ---------------------------------------------------------------------------
create function public.borrar_sesion(p_clave text, p_sesion_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
begin
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'izquierda', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'centro', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'derecha', 0));

  delete from public.sesion s where s.id = p_sesion_id and s.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'SESION_INEXISTENTE');
  end if;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'borrar_sesion', jsonb_build_object('sesion_id', p_sesion_id));

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- guardar_liberacion: minutos antes de la sesión en que las reservas se liberan (0-180).
-- ---------------------------------------------------------------------------
create function public.guardar_liberacion(p_clave text, p_minutos integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
begin
  if p_minutos is null or p_minutos < 0 or p_minutos > 180 then
    return jsonb_build_object('success', false, 'error', 'RANGO_INVALIDO');
  end if;

  update public.evento set liberacion_min = p_minutos where id = v_evento;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'liberacion', jsonb_build_object('minutos', p_minutos));

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- obtener_reservas: {success, liberacion_min, sesiones:[{id, nombre, inicio_at, reservas:[{sede, seccion, cantidad}]}]}
-- ---------------------------------------------------------------------------
create function public.obtener_reservas(p_clave text)
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
    'liberacion_min', (select e.liberacion_min from public.evento e where e.id = v_evento),
    'sesiones', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', s.id,
                 'nombre', s.nombre,
                 'inicio_at', s.inicio_at,
                 'reservas', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('sede', sd.nombre, 'seccion', r.seccion, 'cantidad', r.cantidad)
                            order by sd.nombre, array_position(array['izquierda', 'centro', 'derecha'], r.seccion))
                     from public.reserva r
                     join public.sede sd on sd.id = r.sede_id
                    where r.sesion_id = s.id), '[]'::jsonb))
               order by s.inicio_at, s.nombre)
        from public.sesion s
       where s.evento_id = v_evento), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- importar_reservas: valida TODO y recién después escribe (o no, con p_simular).
--   Reemplaza las reservas de las sesiones que aparecen en p_filas o en p_sesiones.
-- ---------------------------------------------------------------------------
create function public.importar_reservas(
  p_clave text,
  p_filas jsonb,
  p_simular boolean default false,
  p_sesiones text[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_filas jsonb := coalesce(p_filas, '[]'::jsonb);
  v_err_ses jsonb;
  v_ids uuid[];
  v_errores jsonb;
  v_validas jsonb;
  v_nuevas jsonb;
begin
  if jsonb_typeof(v_filas) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'RESERVAS_INVALIDAS',
      'errores', jsonb_build_array(jsonb_build_object('fila', 0, 'motivo', 'Formato inválido: se esperaba un arreglo')));
  end if;
  if jsonb_array_length(v_filas) = 0 and coalesce(cardinality(p_sesiones), 0) = 0 then
    return jsonb_build_object('success', true, 'sedes_nuevas', '[]'::jsonb, 'reservas', 0);
  end if;

  if not coalesce(p_simular, false) then
    perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'izquierda', 0));
    perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'centro', 0));
    perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'derecha', 0));
  end if;

  -- Sesiones pedidas en p_sesiones (aunque no tengan filas).
  select coalesce(jsonb_agg(jsonb_build_object('fila', 0, 'motivo', 'Sesión inexistente: ' || x.nombre)
                            order by x.ord) filter (where s.id is null), '[]'::jsonb),
         coalesce(array_agg(s.id) filter (where s.id is not null), '{}')
    into v_err_ses, v_ids
    from unnest(coalesce(p_sesiones, '{}')) with ordinality x(nombre, ord)
    left join lateral (
      select s.id from public.sesion s
       where s.evento_id = v_evento
         and lower(extensions.unaccent(s.nombre)) = lower(extensions.unaccent(btrim(x.nombre)))
       order by s.nombre limit 1) s on true;

  with f as (
    select t.ord::integer as ord,
           btrim(coalesce(t.e->>'sede', '')) as sede,
           lower(btrim(coalesce(t.e->>'seccion', ''))) as seccion,
           btrim(coalesce(t.e->>'sesion', '')) as ses_txt,
           btrim(coalesce(t.e->>'cantidad', '')) as cant_txt
      from jsonb_array_elements(v_filas) with ordinality t(e, ord)
  ), p as (
    select f.*, s.id as sesion_id, s.nombre as sesion_nombre
      from f
      left join lateral (
        select s.id, s.nombre from public.sesion s
         where s.evento_id = v_evento
           and lower(extensions.unaccent(s.nombre)) = lower(extensions.unaccent(f.ses_txt))
         order by s.nombre limit 1) s on true
  ), q as (
    select p.*,
           case
             when sesion_id is null then 'Sesión inexistente: ' || ses_txt
             when seccion not in ('izquierda', 'centro', 'derecha') then 'Sección inválida: ' || seccion
             when cant_txt !~ '^[0-9]{1,6}$' or cant_txt::integer < 1 then 'Cantidad inválida: ' || cant_txt
             when sede = '' then 'Sede vacía'
           end as motivo
      from p
  ), d as (
    select q.*, row_number() over (partition by lower(sede), seccion, sesion_id order by ord) as rn
      from q where motivo is null
  ), cap as (
    select d.sesion_id, d.sesion_nombre, d.seccion, min(d.ord) as ord, sum(d.cant_txt::integer) as suma,
           (select coalesce(sum(t.capacidad), 0)
              from public.tramo t join public.fila fi on fi.id = t.fila_id
             where fi.evento_id = v_evento and fi.seccion = d.seccion and t.tipo = 'publico') as capacidad
      from d where d.rn = 1
     group by d.sesion_id, d.sesion_nombre, d.seccion
  ), e as (
    select ord, motivo from q where motivo is not null
    union all
    select ord, 'Fila repetida: ' || sede || ', ' || seccion || ', ' || ses_txt from d where rn > 1
    union all
    select ord, format('Excede la capacidad de %s en %s: %s > %s', seccion, sesion_nombre, suma, capacidad)
      from cap where suma > capacidad
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('fila', e.ord, 'motivo', e.motivo) order by e.ord, e.motivo), '[]'::jsonb) from e),
         (select coalesce(jsonb_agg(jsonb_build_object('ord', d.ord, 'sede', d.sede, 'seccion', d.seccion,
                                                       'sesion_id', d.sesion_id, 'cantidad', d.cant_txt::integer)
                                   order by d.ord), '[]'::jsonb) from d where d.rn = 1)
    into v_errores, v_validas;

  v_errores := v_err_ses || v_errores;
  if jsonb_array_length(v_errores) > 0 then
    return jsonb_build_object('success', false, 'error', 'RESERVAS_INVALIDAS', 'errores', v_errores);
  end if;

  -- Sedes que faltan (primera grafía de cada nombre, en orden de aparición).
  select coalesce(jsonb_agg(n.sede order by n.ord), '[]'::jsonb)
    into v_nuevas
    from (select distinct on (lower(x->>'sede')) x->>'sede' as sede, (x->>'ord')::integer as ord
            from jsonb_array_elements(v_validas) x
           order by lower(x->>'sede'), (x->>'ord')::integer) n
   where not exists (select 1 from public.sede sd where lower(sd.nombre) = lower(n.sede));

  if not coalesce(p_simular, false) then
    insert into public.sede (nombre)
    select jsonb_array_elements_text(v_nuevas)
    on conflict (nombre) do nothing;

    v_ids := v_ids || array(select distinct (x->>'sesion_id')::uuid from jsonb_array_elements(v_validas) x);
    delete from public.reserva where sesion_id = any(v_ids);

    insert into public.reserva (sesion_id, sede_id, seccion, cantidad)
    select (x->>'sesion_id')::uuid, sd.id, x->>'seccion', (x->>'cantidad')::integer
      from jsonb_array_elements(v_validas) x
      cross join lateral (select s.id from public.sede s
                           where lower(s.nombre) = lower(x->>'sede') order by s.nombre limit 1) sd;

    insert into public.registro (evento_id, tipo, detalle)
    values (v_evento, 'importar_reservas', jsonb_build_object(
      'reservas', jsonb_array_length(v_validas), 'sesiones', cardinality(v_ids)));
  end if;

  return jsonb_build_object('success', true, 'sedes_nuevas', v_nuevas, 'reservas', jsonb_array_length(v_validas));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function public.guardar_sesion(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.borrar_sesion(text, uuid) from public, anon, authenticated;
revoke execute on function public.guardar_liberacion(text, integer) from public, anon, authenticated;
revoke execute on function public.obtener_reservas(text) from public, anon, authenticated;
revoke execute on function public.importar_reservas(text, jsonb, boolean, text[]) from public, anon, authenticated;

grant execute on function public.guardar_sesion(text, text, timestamptz) to anon, authenticated;
grant execute on function public.borrar_sesion(text, uuid) to anon, authenticated;
grant execute on function public.guardar_liberacion(text, integer) to anon, authenticated;
grant execute on function public.obtener_reservas(text) to anon, authenticated;
grant execute on function public.importar_reservas(text, jsonb, boolean, text[]) to anon, authenticated;

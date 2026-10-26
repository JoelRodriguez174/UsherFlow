-- UsherFlow Etapa 3 / Tarea 2: RPC de Supervisor para sectores, fecha límite, acceso por sede y mapa.
--   guardar_sectores, guardar_fecha_limite, generar_acceso_sede, obtener_mapa_supervisor
--
-- Todas exigen la clave de SUPERVISOR (private.evento_de_clave(p_clave, true)); una clave de ujier LANZA
-- CLAVE_INVALIDA. Errores esperados: {success:false, error:CODE}.
-- Concurrencia: SÓLO guardar_sectores toma los TRES locks de sección en orden fijo (izquierda, centro,
-- derecha), igual que importar_reservas, porque borra/reescribe sectores que mandar_grupo lee. Las otras tres
-- no tocan `reserva` y la lectura es un único snapshot, así que no se serializan con la ruta caliente.
-- Sectores: dentro de cada sección presente en la entrada cubren TODAS sus filas sin huecos ni solapes
-- (de la primera a la última fila existente). Una sección ausente de la entrada queda sin sectores.

-- ---------------------------------------------------------------------------
-- guardar_sectores: reemplaza todos los sectores del evento (las preferencias caen en cascada).
--   p_sectores = [{seccion, nombre, fila_desde, fila_hasta}]. Devuelve {success, sectores:n}.
-- ---------------------------------------------------------------------------
create function public.guardar_sectores(p_clave text, p_sectores jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_errores jsonb;
  v_validos jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'izquierda', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'centro', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'derecha', 0));

  if jsonb_typeof(p_sectores) is distinct from 'array' then
    return jsonb_build_object('success', false, 'error', 'SECTORES_INVALIDOS',
      'errores', jsonb_build_array(jsonb_build_object('motivo', 'Formato inválido: se esperaba un arreglo')));
  end if;

  with f as (
    select t.ord::integer as ord,
           lower(btrim(coalesce(t.e->>'seccion', ''))) as seccion,
           btrim(coalesce(t.e->>'nombre', '')) as nombre,
           btrim(coalesce(t.e->>'fila_desde', '')) as d_txt,
           btrim(coalesce(t.e->>'fila_hasta', '')) as h_txt
      from jsonb_array_elements(p_sectores) with ordinality t(e, ord)
  ), rg as (
    select fi.seccion, min(fi.numero) as fmin, max(fi.numero) as fmax
      from public.fila fi where fi.evento_id = v_evento group by fi.seccion
  ), q as (
    select f.*, rg.fmin, rg.fmax,
           case
             when f.seccion not in ('izquierda', 'centro', 'derecha') then 'Sección inválida: ' || f.seccion
             when f.nombre = '' then 'Nombre vacío en ' || f.seccion
             when f.d_txt !~ '^[0-9]{1,6}$' or f.h_txt !~ '^[0-9]{1,6}$'
               then format('Filas inválidas en %s %s: %s a %s', f.seccion, f.nombre, f.d_txt, f.h_txt)
             when f.d_txt::integer < 1 or f.d_txt::integer > f.h_txt::integer
               then format('Rango inválido en %s %s: %s a %s', f.seccion, f.nombre, f.d_txt, f.h_txt)
             when rg.fmin is null then 'La sección ' || f.seccion || ' no tiene filas'
           end as motivo
      from f left join rg on rg.seccion = f.seccion
  ), v as (
    select q.ord, q.seccion, q.nombre, q.fmin, q.fmax,
           q.d_txt::integer as desde, q.h_txt::integer as hasta,
           row_number() over (partition by q.seccion, lower(q.nombre) order by q.ord) as rn,
           max(q.h_txt::integer) over (partition by q.seccion order by q.d_txt::integer, q.ord
                                       rows between unbounded preceding and 1 preceding) as prev_max
      from q where q.motivo is null
  ), e as (
    select ord, motivo from q where motivo is not null
    union all
    select ord, 'Nombre repetido en ' || seccion || ': ' || nombre from v where rn > 1
    union all
    select ord, format('Solape en %s: %s empieza en la fila %s, ya cubierta', seccion, nombre, desde)
      from v where prev_max is not null and desde <= prev_max
    union all
    select ord, format('Hueco en %s: faltan las filas %s a %s', seccion, prev_max + 1, desde - 1)
      from v where prev_max is not null and desde > prev_max + 1
    union all
    select min(ord), format('La sección %s debe empezar en la fila %s', seccion, fmin)
      from v group by seccion, fmin having min(desde) <> fmin
    union all
    select min(ord), format('La sección %s debe terminar en la fila %s', seccion, fmax)
      from v group by seccion, fmax having max(hasta) <> fmax
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('motivo', e.motivo) order by e.ord, e.motivo), '[]'::jsonb) from e),
         (select coalesce(jsonb_agg(jsonb_build_object('seccion', v.seccion, 'nombre', v.nombre,
                                                       'fila_desde', v.desde, 'fila_hasta', v.hasta)
                                    order by v.ord), '[]'::jsonb) from v)
    into v_errores, v_validos;

  if jsonb_array_length(v_errores) > 0 then
    return jsonb_build_object('success', false, 'error', 'SECTORES_INVALIDOS', 'errores', v_errores);
  end if;

  if exists (select 1 from public.reserva r join public.sector s on s.id = r.sector_id
              where s.evento_id = v_evento) then
    return jsonb_build_object('success', false, 'error', 'SECTORES_CON_ASIGNACIONES');
  end if;

  delete from public.sector where evento_id = v_evento;

  insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
  select v_evento, x.e->>'seccion', x.e->>'nombre', (x.e->>'fila_desde')::integer, (x.e->>'fila_hasta')::integer, x.ord::integer
    from jsonb_array_elements(v_validos) with ordinality x(e, ord);

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'guardar_sectores', jsonb_build_object('sectores', jsonb_array_length(v_validos)));

  return jsonb_build_object('success', true, 'sectores', jsonb_array_length(v_validos));
end;
$$;

-- ---------------------------------------------------------------------------
-- guardar_fecha_limite: null la borra; cualquier fecha es válida (también pasada).
-- ---------------------------------------------------------------------------
create function public.guardar_fecha_limite(p_clave text, p_fecha timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
begin
  update public.evento set fecha_limite = p_fecha where id = v_evento;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'fecha_limite', jsonb_build_object('fecha', p_fecha));

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- generar_acceso_sede: clave de acceso de una sede a este evento. Si ya existe devuelve la misma,
--   salvo p_rotar (la anterior deja de servir). Devuelve {success, clave}.
-- ---------------------------------------------------------------------------
create function public.generar_acceso_sede(p_clave text, p_sede_id uuid, p_rotar boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_nueva text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_clave text;
begin
  if p_sede_id is null or not exists (select 1 from public.sede where id = p_sede_id) then
    return jsonb_build_object('success', false, 'error', 'SEDE_INVALIDA');
  end if;

  insert into public.acceso_sede (evento_id, sede_id, clave)
  values (v_evento, p_sede_id, v_nueva)
  on conflict (evento_id, sede_id) do nothing;

  if found then
    v_clave := v_nueva;
  elsif coalesce(p_rotar, false) then
    update public.acceso_sede set clave = v_nueva
     where evento_id = v_evento and sede_id = p_sede_id;
    v_clave := v_nueva;
  else
    select a.clave into v_clave from public.acceso_sede a
     where a.evento_id = v_evento and a.sede_id = p_sede_id;
    return jsonb_build_object('success', true, 'clave', v_clave);
  end if;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'acceso_sede', jsonb_build_object('sede_id', p_sede_id, 'rotada', coalesce(p_rotar, false)));

  return jsonb_build_object('success', true, 'clave', v_clave);
end;
$$;

-- ---------------------------------------------------------------------------
-- obtener_mapa_supervisor: {success, fecha_limite, sectores:[{id, seccion, nombre, fila_desde, fila_hasta, capacidad}],
--   sedes:[{sede_id, nombre, clave_acceso|null, preferencias:[sector_id]}],
--   sesiones:[{id, nombre, inicio_at, asignado:[{sector_id, sede_id, cantidad}]}]}
--   `sedes` es todo el catálogo; `asignado` sólo cuenta reservas ligadas a un sector.
-- ---------------------------------------------------------------------------
create function public.obtener_mapa_supervisor(p_clave text)
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
revoke execute on function public.guardar_sectores(text, jsonb) from public, anon, authenticated;
revoke execute on function public.guardar_fecha_limite(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.generar_acceso_sede(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.obtener_mapa_supervisor(text) from public, anon, authenticated;

grant execute on function public.guardar_sectores(text, jsonb) to anon, authenticated;
grant execute on function public.guardar_fecha_limite(text, timestamptz) to anon, authenticated;
grant execute on function public.generar_acceso_sede(text, uuid, boolean) to anon, authenticated;
grant execute on function public.obtener_mapa_supervisor(text) to anon, authenticated;

-- UsherFlow Etapa 3 / Tarea 4: obtener_reservas e importar_reservas conocen los sectores.
-- Se re-crean con la misma firma (los privilegios de 20261023000200 se conservan). Sin columna `sector`
-- en las filas todo se comporta como en la Etapa 2.
--
-- Reserva por sector: `sector` (nombre, sin distinguir mayúsculas ni acentos DENTRO de la sección) liga la
-- fila a un sector; vacío = toda la sección. Clave de duplicados: (sede, sección, sesión, sector).
-- Una misma sede no puede mezclar filas con sector y sin sector en una (sección, sesión).
-- Capacidad: la de la sección sigue siendo Σ de todas las filas; además cada sector tiene la suya
-- (private.capacidad_sector). Concurrencia igual que antes: importar_reservas (sin p_simular) toma los
-- tres locks de sección en orden fijo; obtener_reservas no toma ninguno.

-- ---------------------------------------------------------------------------
-- obtener_reservas: {success, liberacion_min,
--   sectores:[{id, seccion, nombre, fila_desde, fila_hasta}],
--   sesiones:[{id, nombre, inicio_at, reservas:[{sede, seccion, cantidad, sector?}]}]}
--   `sector` (nombre) se omite en las reservas de sección entera (jsonb_strip_nulls): el cliente lee `r.sector ?? null`.
-- ---------------------------------------------------------------------------
create or replace function public.obtener_reservas(p_clave text)
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
    'sectores', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.id, 'seccion', s.seccion, 'nombre', s.nombre,
                                  'fila_desde', s.fila_desde, 'fila_hasta', s.fila_hasta)
               order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
        from public.sector s where s.evento_id = v_evento), '[]'::jsonb),
    'sesiones', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', ss.id,
                 'nombre', ss.nombre,
                 'inicio_at', ss.inicio_at,
                 'reservas', coalesce((
                   select jsonb_agg(
                            jsonb_strip_nulls(jsonb_build_object(
                              'sede', sd.nombre, 'seccion', r.seccion, 'cantidad', r.cantidad, 'sector', sc.nombre))
                            order by sd.nombre, array_position(array['izquierda', 'centro', 'derecha'], r.seccion),
                                     sc.orden, sc.id)
                     from public.reserva r
                     join public.sede sd on sd.id = r.sede_id
                     left join public.sector sc on sc.id = r.sector_id
                    where r.sesion_id = ss.id), '[]'::jsonb))
               order by ss.inicio_at, ss.nombre)
        from public.sesion ss
       where ss.evento_id = v_evento), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- importar_reservas: valida TODO y recién después escribe (o no, con p_simular).
--   Reemplaza las reservas de las sesiones que aparecen en p_filas o en p_sesiones.
--   Filas: {sede, seccion, sesion, cantidad, sector?}.
-- ---------------------------------------------------------------------------
create or replace function public.importar_reservas(
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
           btrim(coalesce(t.e->>'cantidad', '')) as cant_txt,
           btrim(coalesce(t.e->>'sector', '')) as sec_txt
      from jsonb_array_elements(v_filas) with ordinality t(e, ord)
  ), p as (
    select f.*, s.id as sesion_id, s.nombre as sesion_nombre, sc.id as sector_id, sc.nombre as sector_nombre
      from f
      left join lateral (
        select s.id, s.nombre from public.sesion s
         where s.evento_id = v_evento
           and lower(extensions.unaccent(s.nombre)) = lower(extensions.unaccent(f.ses_txt))
         order by s.nombre limit 1) s on true
      left join lateral (
        select c.id, c.nombre from public.sector c
         where f.sec_txt <> '' and c.evento_id = v_evento and c.seccion = f.seccion
           and lower(extensions.unaccent(c.nombre)) = lower(extensions.unaccent(f.sec_txt))
         order by c.nombre limit 1) sc on true
  ), q as (
    select p.*,
           case
             when sesion_id is null then 'Sesión inexistente: ' || ses_txt
             when seccion not in ('izquierda', 'centro', 'derecha') then 'Sección inválida: ' || seccion
             when cant_txt !~ '^[0-9]{1,6}$' or cant_txt::integer < 1 then 'Cantidad inválida: ' || cant_txt
             when sede = '' then 'Sede vacía'
             when sec_txt <> '' and sector_id is null then 'Sector inexistente: ' || sec_txt
           end as motivo
      from p
  ), d as (
    select q.*, row_number() over (partition by lower(sede), seccion, sesion_id, coalesce(sector_id, 0) order by ord) as rn
      from q where motivo is null
  ), cap as (
    select d.sesion_id, d.sesion_nombre, d.seccion, min(d.ord) as ord, sum(d.cant_txt::integer) as suma,
           (select coalesce(sum(t.capacidad), 0)
              from public.tramo t join public.fila fi on fi.id = t.fila_id
             where fi.evento_id = v_evento and fi.seccion = d.seccion and t.tipo = 'publico') as capacidad
      from d where d.rn = 1
     group by d.sesion_id, d.sesion_nombre, d.seccion
  ), capsec as (
    select d.sesion_id, d.sesion_nombre, d.sector_id, d.sector_nombre, min(d.ord) as ord,
           sum(d.cant_txt::integer) as suma, private.capacidad_sector(d.sector_id) as capacidad
      from d where d.rn = 1 and d.sector_id is not null
     group by d.sesion_id, d.sesion_nombre, d.sector_id, d.sector_nombre
  ), mezcla as (
    select min(d.ord) as ord, (array_agg(d.sede order by d.ord))[1] as sede, d.seccion,
           (array_agg(d.ses_txt order by d.ord))[1] as ses_txt
      from d where d.rn = 1
     group by lower(d.sede), d.seccion, d.sesion_id
    having bool_or(d.sector_id is null) and bool_or(d.sector_id is not null)
  ), e as (
    select ord, motivo from q where motivo is not null
    union all
    select ord, 'Fila repetida: ' || sede || ', ' || seccion || ', ' || ses_txt from d where rn > 1
    union all
    select ord, 'Mezcla de sector y sección entera: ' || sede || ', ' || seccion || ', ' || ses_txt from mezcla
    union all
    select ord, format('Excede la capacidad de %s en %s: %s > %s', seccion, sesion_nombre, suma, capacidad)
      from cap where suma > capacidad
    union all
    select ord, format('Excede la capacidad del sector %s en %s: %s > %s', sector_nombre, sesion_nombre, suma, capacidad)
      from capsec where suma > capacidad
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('fila', e.ord, 'motivo', e.motivo) order by e.ord, e.motivo), '[]'::jsonb) from e),
         (select coalesce(jsonb_agg(jsonb_build_object('ord', d.ord, 'sede', d.sede, 'seccion', d.seccion,
                                                       'sesion_id', d.sesion_id, 'cantidad', d.cant_txt::integer,
                                                       'sector_id', d.sector_id)
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

    insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id)
    select (x->>'sesion_id')::uuid, sd.id, x->>'seccion', (x->>'cantidad')::integer, (x->>'sector_id')::bigint
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

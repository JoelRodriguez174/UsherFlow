-- UsherFlow: el pastor carga las reservas de SU sede; el supervisor las ve en el paso Reservas.
--   private.importar_reservas_core, importar_reservas (re-creada), guardar_reservas_sede, obtener_reservas_sede
--
-- Alcance del reemplazo (antes importar_reservas siempre pisaba la sesión entera):
--   - p_sede (pastor): sólo las reservas de esa sede en las sesiones guardadas; el nombre de sede de las filas se ignora.
--   - supervisor con p_sesiones (tabla): toda la sesión, como antes (así se puede quitar una fila).
--   - supervisor sin p_sesiones (Excel/CSV): sólo cada par (sede, sesión) que aparece en el archivo; el resto queda.
-- La capacidad suma también lo que queda de las otras sedes, porque ya no se pisa toda la sesión.
-- Concurrencia igual que importar_reservas: sin p_simular toma los tres locks de sección en orden fijo.

create function private.importar_reservas_core(
  p_evento uuid,
  p_filas jsonb,
  p_simular boolean,
  p_sesiones text[],
  p_sede uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := p_evento;
  v_filas jsonb := coalesce(p_filas, '[]'::jsonb);
  v_sede_nombre text := (select sd.nombre from public.sede sd where sd.id = p_sede);
  v_toda_sesion boolean := coalesce(cardinality(p_sesiones), 0) > 0;
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
  if jsonb_array_length(v_filas) = 0 and not v_toda_sesion then
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
           coalesce(v_sede_nombre, btrim(coalesce(t.e->>'sede', ''))) as sede,
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
    select q.*, row_number() over (partition by private.sin_acentos(sede), seccion, sesion_id, coalesce(sector_id, 0) order by ord) as rn
      from q where motivo is null
  ), otras as (
    -- Lo que sobrevive de otras sedes en las sesiones tocadas: cuenta para la capacidad.
    select r.sesion_id, r.seccion, r.sector_id, r.cantidad
      from public.reserva r
     where (r.sesion_id = any(v_ids) or r.sesion_id in (select d.sesion_id from d))
       and not case
                 when p_sede is not null then r.sede_id = p_sede
                 when v_toda_sesion then true
                 else exists (select 1 from d join public.sede sd on sd.id = r.sede_id
                               where d.sesion_id = r.sesion_id and private.sin_acentos(d.sede) = private.sin_acentos(sd.nombre))
               end
  ), cap as (
    select d.sesion_id, d.sesion_nombre, d.seccion, min(d.ord) as ord,
           sum(d.cant_txt::integer)
             + (select coalesce(sum(o.cantidad), 0) from otras o where o.sesion_id = d.sesion_id and o.seccion = d.seccion) as suma,
           (select coalesce(sum(t.capacidad), 0)
              from public.tramo t join public.fila fi on fi.id = t.fila_id
             where fi.evento_id = v_evento and fi.seccion = d.seccion and t.tipo = 'publico') as capacidad
      from d where d.rn = 1
     group by d.sesion_id, d.sesion_nombre, d.seccion
  ), capsec as (
    select d.sesion_id, d.sesion_nombre, d.sector_id, d.sector_nombre, min(d.ord) as ord,
           sum(d.cant_txt::integer)
             + (select coalesce(sum(o.cantidad), 0) from otras o where o.sesion_id = d.sesion_id and o.sector_id = d.sector_id) as suma,
           private.capacidad_sector(d.sector_id) as capacidad
      from d where d.rn = 1 and d.sector_id is not null
     group by d.sesion_id, d.sesion_nombre, d.sector_id, d.sector_nombre
  ), mezcla as (
    select min(d.ord) as ord, (array_agg(d.sede order by d.ord))[1] as sede, d.seccion,
           (array_agg(d.ses_txt order by d.ord))[1] as ses_txt
      from d where d.rn = 1
     group by private.sin_acentos(d.sede), d.seccion, d.sesion_id
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
    from (select distinct on (private.sin_acentos(x->>'sede')) x->>'sede' as sede, (x->>'ord')::integer as ord
            from jsonb_array_elements(v_validas) x
           order by private.sin_acentos(x->>'sede'), (x->>'ord')::integer) n
   where not exists (select 1 from public.sede sd where private.sin_acentos(sd.nombre) = private.sin_acentos(n.sede));

  if not coalesce(p_simular, false) then
    insert into public.sede (nombre)
    select jsonb_array_elements_text(v_nuevas)
    on conflict do nothing;

    v_ids := v_ids || array(select distinct (x->>'sesion_id')::uuid from jsonb_array_elements(v_validas) x);
    delete from public.reserva r
     where r.sesion_id = any(v_ids)
       and case
             when p_sede is not null then r.sede_id = p_sede
             when v_toda_sesion then true
             else exists (select 1 from jsonb_array_elements(v_validas) x
                            join public.sede sd on sd.id = r.sede_id
                           where (x->>'sesion_id')::uuid = r.sesion_id
                             and private.sin_acentos(x->>'sede') = private.sin_acentos(sd.nombre))
           end;

    insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id)
    select (x->>'sesion_id')::uuid, sd.id, x->>'seccion', (x->>'cantidad')::integer, (x->>'sector_id')::bigint
      from jsonb_array_elements(v_validas) x
      cross join lateral (select s.id from public.sede s
                           where private.sin_acentos(s.nombre) = private.sin_acentos(x->>'sede') order by s.nombre limit 1) sd;

    insert into public.registro (evento_id, tipo, detalle)
    values (v_evento, 'importar_reservas', jsonb_build_object(
      'reservas', jsonb_array_length(v_validas), 'sesiones', cardinality(v_ids), 'sede_id', p_sede));
  end if;

  return jsonb_build_object('success', true, 'sedes_nuevas', v_nuevas, 'reservas', jsonb_array_length(v_validas));
end;
$$;

revoke all on function private.importar_reservas_core(uuid, jsonb, boolean, text[], uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- importar_reservas: misma firma y privilegios; ahora delega en el núcleo (ver alcance del reemplazo arriba).
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
begin
  return private.importar_reservas_core(private.evento_de_clave(p_clave, true), p_filas, p_simular, p_sesiones, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- guardar_reservas_sede: el pastor reemplaza SUS reservas en las sesiones de p_sesiones (y en las que traen las filas).
--   Filas: {seccion, sesion, cantidad, sector?}. Errores: FECHA_LIMITE_VENCIDA, RESERVAS_INVALIDAS {errores}.
-- ---------------------------------------------------------------------------
create function public.guardar_reservas_sede(p_clave text, p_filas jsonb, p_sesiones text[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid;
  v_sede uuid;
  v_limite timestamptz;
begin
  select k.evento_id, k.sede_id into v_evento, v_sede from private.sede_de_clave(p_clave) k;
  select e.fecha_limite into v_limite from public.evento e where e.id = v_evento;
  if v_limite is not null and clock_timestamp() >= v_limite then
    return jsonb_build_object('success', false, 'error', 'FECHA_LIMITE_VENCIDA');
  end if;
  return private.importar_reservas_core(v_evento, p_filas, false, p_sesiones, v_sede);
end;
$$;

-- ---------------------------------------------------------------------------
-- obtener_reservas_sede: {success, sesiones:[{id, nombre, reservas:[{seccion, cantidad, sector?}]}]} sólo de la sede de la clave.
-- ---------------------------------------------------------------------------
create function public.obtener_reservas_sede(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_evento uuid;
  v_sede uuid;
begin
  select k.evento_id, k.sede_id into v_evento, v_sede from private.sede_de_clave(p_clave) k;
  return jsonb_build_object(
    'success', true,
    'sesiones', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', ss.id,
                 'nombre', ss.nombre,
                 'reservas', coalesce((
                   select jsonb_agg(
                            jsonb_strip_nulls(jsonb_build_object('seccion', r.seccion, 'cantidad', r.cantidad, 'sector', sc.nombre))
                            order by array_position(array['izquierda', 'centro', 'derecha'], r.seccion), sc.orden, sc.id)
                     from public.reserva r
                     left join public.sector sc on sc.id = r.sector_id
                    where r.sesion_id = ss.id and r.sede_id = v_sede), '[]'::jsonb))
               order by ss.inicio_at, ss.nombre)
        from public.sesion ss where ss.evento_id = v_evento), '[]'::jsonb));
end;
$$;

revoke execute on function public.guardar_reservas_sede(text, jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.obtener_reservas_sede(text) from public, anon, authenticated;
grant execute on function public.guardar_reservas_sede(text, jsonb, text[]) to anon, authenticated;
grant execute on function public.obtener_reservas_sede(text) to anon, authenticated;

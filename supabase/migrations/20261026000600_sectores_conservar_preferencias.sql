-- UsherFlow Etapa 3 / tanda final (F1): guardar_sectores conserva las preferencias de las sedes cuyo sector
-- mantiene (sección, fila_desde, fila_hasta); las de sectores con otro rango siguen cayendo (se avisa en la UI).
-- Misma firma, validación, errores, privilegios (create or replace) y los mismos 3 locks.

create or replace function public.guardar_sectores(p_clave text, p_sectores jsonb)
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
  v_prefs jsonb;
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

  -- Se guardan las preferencias por (sede, sección, rango) para reponer las de los sectores cuyo rango no cambia.
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', p.sede_id, 'seccion', s.seccion,
                                               'fila_desde', s.fila_desde, 'fila_hasta', s.fila_hasta)), '[]'::jsonb)
    into v_prefs
    from public.preferencia p join public.sector s on s.id = p.sector_id
   where s.evento_id = v_evento;

  delete from public.sector where evento_id = v_evento;

  insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
  select v_evento, x.e->>'seccion', x.e->>'nombre', (x.e->>'fila_desde')::integer, (x.e->>'fila_hasta')::integer, x.ord::integer
    from jsonb_array_elements(v_validos) with ordinality x(e, ord);

  insert into public.preferencia (sede_id, sector_id)
  select (x.e->>'sede_id')::uuid, s.id
    from jsonb_array_elements(v_prefs) x(e)
    join public.sector s on s.evento_id = v_evento
                        and s.seccion = x.e->>'seccion'
                        and s.fila_desde = (x.e->>'fila_desde')::integer
                        and s.fila_hasta = (x.e->>'fila_hasta')::integer;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'guardar_sectores', jsonb_build_object('sectores', jsonb_array_length(v_validos)));

  return jsonb_build_object('success', true, 'sectores', jsonb_array_length(v_validos));
end;
$$;

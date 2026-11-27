-- Agrega fecha/hora de fin opcional (fin_at) a las sesiones/eventos y actualiza las RPCs correspondientes.

alter table public.sesion
  add column if not exists fin_at timestamptz;

alter table public.sesion
  drop constraint if exists sesion_fin_despues_inicio_check;

alter table public.sesion
  add constraint sesion_fin_despues_inicio_check
  check (fin_at is null or fin_at > inicio_at);

drop function if exists public.guardar_sesion(text, text, timestamptz);

create or replace function public.guardar_sesion(
  p_clave text,
  p_nombre text,
  p_inicio_at timestamptz,
  p_fin_at timestamptz default null
)
returns jsonb
language plpgsql
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
  if p_fin_at is not null and p_fin_at <= p_inicio_at then
    return jsonb_build_object('success', false, 'error', 'FIN_INVALIDO');
  end if;

  select s.id into v_id
    from public.sesion s
   where s.evento_id = v_evento
     and lower(extensions.unaccent(s.nombre)) = lower(extensions.unaccent(v_nombre))
   order by (s.nombre = v_nombre) desc
   limit 1;

  if found then
    update public.sesion
       set nombre = v_nombre,
           inicio_at = p_inicio_at,
           fin_at = p_fin_at
     where id = v_id;
  else
    insert into public.sesion (evento_id, nombre, inicio_at, fin_at)
    values (v_evento, v_nombre, p_inicio_at, p_fin_at)
    on conflict (evento_id, nombre) do update
       set inicio_at = excluded.inicio_at,
           fin_at = excluded.fin_at
    returning id into v_id;
  end if;

  return jsonb_build_object('success', true, 'sesion_id', v_id);
end;
$$;

grant execute on function public.guardar_sesion(text, text, timestamptz, timestamptz) to anon, authenticated;

create or replace function public.obtener_reservas(p_clave text)
returns jsonb
language plpgsql
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
                 'fin_at', ss.fin_at,
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

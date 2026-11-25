-- Extiende obtener_mapa_sede con `capacidad` y `disponibles` por sector y sesión para la reserva directa en el mapa.
-- Privacidad: `disponibles` es `capacidad - reservas_de_otras_sedes` (nunca expone nombres ni desglose de otras sedes).

create or replace function public.obtener_mapa_sede(p_clave text)
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
        from public.sector s where s.evento_id = v_evento), '[]'::jsonb),
    'preferencias', coalesce((
      select jsonb_agg(p.sector_id order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
        from public.preferencia p
        join public.sector s on s.id = p.sector_id
       where p.sede_id = v_sede and s.evento_id = v_evento), '[]'::jsonb),
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
                            where s.evento_id = v_evento
                            group by s.id) q), '[]'::jsonb))
               order by ss.inicio_at, ss.nombre)
        from public.sesion ss where ss.evento_id = v_evento), '[]'::jsonb));
end;
$$;

revoke execute on function public.obtener_mapa_sede(text) from public, anon, authenticated;
grant execute on function public.obtener_mapa_sede(text) to anon, authenticated;

-- Etapa 2 / correcciones finales: guardar_liberacion avisa a las pantallas abiertas.
-- `evento` no está en la publicación realtime; `sesion` sí. Un update sin cambios (inicio_at = inicio_at)
-- escribe una fila nueva en el WAL y dispara el evento de `sesion`, que hace resincronizar a los clientes.
create or replace function public.guardar_liberacion(p_clave text, p_minutos integer)
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
  update public.sesion set inicio_at = inicio_at where evento_id = v_evento;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'liberacion', jsonb_build_object('minutos', p_minutos));

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function public.guardar_liberacion(text, integer) from public, anon, authenticated;
grant execute on function public.guardar_liberacion(text, integer) to anon, authenticated;

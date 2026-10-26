-- UsherFlow Etapa 3 / tanda final (F3b): crear sedes sin importar reservas, para poder invitar pastores antes.
--   guardar_sede(p_clave, p_nombre): clave de SUPERVISOR (ujier LANZA CLAVE_INVALIDA).
--   Nombre vacío -> {success:false, error:'NOMBRE_INVALIDO'}. Si ya existe una sede con ese nombre (sin
--   distinguir mayúsculas) devuelve la existente (idempotente). Devuelve {success:true, sede_id}.
-- Sin locks: no toca `reserva`; la colisión de dos altas simultáneas la resuelve unique (nombre).

create function public.guardar_sede(p_clave text, p_nombre text)
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

  select s.id into v_id from public.sede s where lower(s.nombre) = lower(v_nombre) order by s.creado_en, s.id limit 1;

  if v_id is null then
    insert into public.sede (nombre) values (v_nombre)
    on conflict (nombre) do nothing
    returning id into v_id;
    if v_id is null then
      select s.id into v_id from public.sede s where s.nombre = v_nombre;
    end if;

    insert into public.registro (evento_id, tipo, detalle)
    values (v_evento, 'guardar_sede', jsonb_build_object('sede_id', v_id, 'nombre', v_nombre));
  end if;

  return jsonb_build_object('success', true, 'sede_id', v_id);
end;
$$;

revoke execute on function public.guardar_sede(text, text) from public, anon, authenticated;
grant execute on function public.guardar_sede(text, text) to anon, authenticated;

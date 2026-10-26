-- UsherFlow Etapa 3 / Tarea 3: RPC del pastor de sede, por clave de acceso de la sede (acceso_sede.clave).
--   private.sede_de_clave, obtener_mapa_sede, guardar_preferencias
--
-- Una clave de ujier o de supervisor NO está en acceso_sede: LANZA CLAVE_INVALIDA. Errores esperados de
-- guardar_preferencias: {success:false, error:CODE}.
-- Privacidad: el pastor sólo ve su sede; de las demás únicamente se deriva `agotado` por sector y sesión.
-- Concurrencia: SÓLO guardar_preferencias toma un lock (por sede, para que dos pestañas no se pisen);
-- no toca `reserva`, así que no se serializa con la ruta caliente. obtener_mapa_sede es un único snapshot.

-- ---------------------------------------------------------------------------
-- private.sede_de_clave: (evento, sede) de una clave de acceso de sede; lanza CLAVE_INVALIDA si no existe.
-- ---------------------------------------------------------------------------
create function private.sede_de_clave(p_clave text)
returns table (evento_id uuid, sede_id uuid)
language plpgsql
stable
set search_path = ''
as $$
begin
  return query
    select a.evento_id, a.sede_id from public.acceso_sede a where a.clave = p_clave;
  if not found then
    raise exception 'CLAVE_INVALIDA';
  end if;
end;
$$;

revoke all on function private.sede_de_clave(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- obtener_mapa_sede: {success, sede:{id, nombre}, fecha_limite, abierto, sectores:[{id, seccion, nombre, fila_desde,
--   fila_hasta}], preferencias:[sector_id], sesiones:[{id, nombre, inicio_at, sectores:[{sector_id, agotado, asignado}]}]}
--   `agotado`: Σ reservas de TODAS las sedes en el sector y la sesión >= capacidad del sector (un sector sin
--   capacidad cuenta como agotado); `asignado`: sólo lo de la sede de la clave. Reservas sin sector no cuentan.
-- ---------------------------------------------------------------------------
create function public.obtener_mapa_sede(p_clave text)
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
                            jsonb_build_object('sector_id', q.id, 'agotado', q.total >= q.capacidad, 'asignado', q.propio)
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

-- ---------------------------------------------------------------------------
-- guardar_preferencias: reemplaza las preferencias de la sede. Lista vacía las borra; los repetidos cuentan una vez.
--   Errores: FECHA_LIMITE_VENCIDA (clock_timestamp() >= fecha_limite), SECTOR_INVALIDO (nulo, inexistente o de otro evento).
-- ---------------------------------------------------------------------------
create function public.guardar_preferencias(p_clave text, p_sectores bigint[])
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

  perform pg_advisory_xact_lock(hashtextextended(v_sede::text, 0));

  select e.fecha_limite into v_limite from public.evento e where e.id = v_evento;
  if v_limite is not null and clock_timestamp() >= v_limite then
    return jsonb_build_object('success', false, 'error', 'FECHA_LIMITE_VENCIDA');
  end if;

  if p_sectores is null
     or exists (select 1 from unnest(p_sectores) u(id)
                 where u.id is null
                    or not exists (select 1 from public.sector s where s.id = u.id and s.evento_id = v_evento)) then
    return jsonb_build_object('success', false, 'error', 'SECTOR_INVALIDO');
  end if;

  -- Sólo las preferencias de ESTE evento: la sede puede tener también las de otros eventos.
  delete from public.preferencia p
   using public.sector s
   where p.sector_id = s.id and s.evento_id = v_evento and p.sede_id = v_sede;

  insert into public.preferencia (sede_id, sector_id)
  select v_sede, u.id from unnest(p_sectores) u(id) group by u.id;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'preferencias', jsonb_build_object('sede_id', v_sede, 'sectores', to_jsonb(p_sectores)));

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function public.obtener_mapa_sede(text) from public, anon, authenticated;
revoke execute on function public.guardar_preferencias(text, bigint[]) from public, anon, authenticated;

grant execute on function public.obtener_mapa_sede(text) to anon, authenticated;
grant execute on function public.guardar_preferencias(text, bigint[]) to anon, authenticated;

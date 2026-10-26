-- UsherFlow Etapa 3 / Tarea 5: sentar_pendiente registra el sector del asiento y avisa si queda
-- fuera de los sectores de la sede; obtener_estado_salon suma `sectores` y los campos de sector
-- en cada reserva. Re-crea ambas funciones (mismas firmas; create or replace conserva grants).

-- ---------------------------------------------------------------------------
-- 1. sentar_pendiente: cuerpo de 20261022000300_flujo.sql + sector.
--    Sector del asiento = el de la sección cuyo rango de filas contiene la fila del tramo (o null).
--    fuera_de_sector: el pendiente tiene sede, la sede tiene reservas CON sector en esa sección y
--    sesión, y ninguna es el sector donde se sentó. Sentar fuera no toca la reserva del sector.
-- ---------------------------------------------------------------------------
create or replace function public.sentar_pendiente(p_clave text, p_pendiente_id uuid, p_tramo_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_seccion text;
  v_p public.pendiente%rowtype;
  v_tramo_id bigint;
  v_tipo text;
  v_capacidad integer;
  v_ocupados integer;
  v_fila_id bigint;
  v_fila_seccion text;
  v_fila_numero integer;
  v_segundos numeric;
  v_sector bigint;
  v_fuera boolean := false;
  v_sectores jsonb;
begin
  -- Paso 1 (sin bloquear): sólo para conocer la sección del pendiente. Otro evento = inexistente.
  select p.seccion into v_seccion
    from public.pendiente p
   where p.id = p_pendiente_id and p.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'PENDIENTE_YA_RESUELTO');
  end if;

  -- Paso 2: lock de la sección (mismo que mandar_grupo y cancelar_pendiente).
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || v_seccion, 0));

  -- Paso 3: releer con FOR UPDATE y re-verificar el estado.
  select * into v_p
    from public.pendiente p
   where p.id = p_pendiente_id and p.evento_id = v_evento
     for update;
  if not found or v_p.estado <> 'pendiente' then
    return jsonb_build_object('success', false, 'error', 'PENDIENTE_YA_RESUELTO');
  end if;

  -- Tramo (de este evento) bloqueado para escritura.
  select t.id, t.tipo, t.capacidad, t.ocupados, f.id, f.seccion, f.numero
    into v_tramo_id, v_tipo, v_capacidad, v_ocupados, v_fila_id, v_fila_seccion, v_fila_numero
    from public.tramo t
    join public.fila f on f.id = t.fila_id
   where t.id = p_tramo_id and f.evento_id = v_evento
     for update of t;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  if v_tipo = 'reservado' then
    return jsonb_build_object('success', false, 'error', 'TRAMO_RESERVADO');
  end if;
  if v_fila_seccion <> v_p.seccion then
    return jsonb_build_object('success', false, 'error', 'SECCION_INCORRECTA');
  end if;
  if v_capacidad - v_ocupados < v_p.cantidad then
    return jsonb_build_object('success', false, 'error', 'TRAMO_SIN_CUPO');
  end if;

  select s.id into v_sector
    from public.sector s
   where s.evento_id = v_evento
     and s.seccion = v_p.seccion
     and v_fila_numero between s.fila_desde and s.fila_hasta
   order by s.orden, s.id
   limit 1;

  -- Sin reservas con sector (sin sede, sin sesión o sección entera) no hay aviso: bool_and queda null.
  if v_p.sede_id is not null and v_p.sesion_id is not null then
    select jsonb_agg(s.nombre order by s.orden, s.id),
           coalesce(bool_and(r.sector_id is distinct from v_sector), false)
      into v_sectores, v_fuera
      from public.reserva r
      join public.sector s on s.id = r.sector_id
     where r.sesion_id = v_p.sesion_id
       and r.sede_id = v_p.sede_id
       and r.seccion = v_p.seccion;
  end if;

  update public.tramo
     set ocupados = ocupados + v_p.cantidad
   where id = v_tramo_id;

  update public.pendiente
     set estado = 'sentado',
         resuelto_en = clock_timestamp(),
         sector_id = v_sector
   where id = v_p.id;

  -- La fila queda verificada; deja de estar fragmentada sólo si ya no tiene asientos públicos libres.
  update public.fila f
     set verificada_en = clock_timestamp(),
         fragmentada = case
           when exists (select 1 from public.tramo t
                         where t.fila_id = f.id and t.tipo = 'publico' and t.ocupados < t.capacidad)
             then f.fragmentada
           else false
         end
   where f.id = v_fila_id;

  v_segundos := round(extract(epoch from (clock_timestamp() - v_p.creado_en))::numeric, 1);

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'confirmacion', jsonb_build_object(
    'pendiente_id', v_p.id,
    'tramo_id', v_tramo_id,
    'fila_id', v_fila_id,
    'cantidad', v_p.cantidad,
    'segundos', v_segundos,
    'sector_id', v_sector,
    'fuera_de_sector', v_fuera));

  if v_fuera then
    return jsonb_build_object('success', true, 'fuera_de_sector', true, 'sectores', v_sectores);
  end if;
  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. obtener_estado_salon: cuerpo de 20261023000100_sedes.sql + `sectores` y campos de sector.
--    `sentados` es por sector si la reserva tiene sector, por sección si no; `sentados_seccion`
--    es siempre por (sede, sección, sesión), igual que private.apartado.
-- ---------------------------------------------------------------------------
create or replace function public.obtener_estado_salon(p_clave text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_sesion uuid := private.sesion_en_curso(v_evento);
begin
  return (
    select jsonb_build_object(
      'server_now', to_jsonb(clock_timestamp()),
      'evento_id', v_evento,
      'filas', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', f.id,
                   'seccion', f.seccion,
                   'numero', f.numero,
                   'fragmentada', f.fragmentada,
                   'verificada_en', f.verificada_en,
                   'tramos', coalesce((
                     select jsonb_agg(
                              jsonb_build_object(
                                'id', t.id,
                                'orden', t.orden,
                                'tipo', t.tipo,
                                'capacidad', t.capacidad,
                                'ocupados', t.ocupados,
                                'etiqueta', t.etiqueta)
                              order by t.orden)
                       from public.tramo t
                      where t.fila_id = f.id), '[]'::jsonb))
                 order by array_position(array['izquierda', 'centro', 'derecha'], f.seccion), f.numero)
          from public.fila f
         where f.evento_id = v_evento), '[]'::jsonb),
      'pendientes', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', p.id,
                   'seccion', p.seccion,
                   'cantidad', p.cantidad,
                   'sede_id', p.sede_id,
                   'creado_en', p.creado_en)
                 order by p.creado_en, p.id)
          from public.pendiente p
         where p.evento_id = v_evento and p.estado = 'pendiente'), '[]'::jsonb),
      'sesion', (
        select jsonb_build_object(
                 'id', s.id,
                 'nombre', s.nombre,
                 'inicio_at', s.inicio_at,
                 'libera_at', s.inicio_at - make_interval(mins => e.liberacion_min))
          from public.sesion s
          join public.evento e on e.id = s.evento_id
         where s.id = v_sesion),
      'sectores', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id,
                   'seccion', s.seccion,
                   'nombre', s.nombre,
                   'fila_desde', s.fila_desde,
                   'fila_hasta', s.fila_hasta,
                   'orden', s.orden)
                 order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
          from public.sector s
         where s.evento_id = v_evento), '[]'::jsonb),
      'reservas', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'sede_id', r.sede_id,
                   'sede', sd.nombre,
                   'seccion', r.seccion,
                   'cantidad', r.cantidad,
                   'sector_id', r.sector_id,
                   'sector', sc.nombre,
                   'fila_desde', sc.fila_desde,
                   'fila_hasta', sc.fila_hasta,
                   'sentados', coalesce((
                     select sum(p.cantidad)
                       from public.pendiente p
                      where p.sesion_id = r.sesion_id
                        and p.sede_id = r.sede_id
                        and p.seccion = r.seccion
                        and p.estado = 'sentado'
                        and (r.sector_id is null or p.sector_id = r.sector_id)), 0),
                   'sentados_seccion', coalesce((
                     select sum(p.cantidad)
                       from public.pendiente p
                      where p.sesion_id = r.sesion_id
                        and p.sede_id = r.sede_id
                        and p.seccion = r.seccion
                        and p.estado = 'sentado'), 0))
                 order by sd.nombre, array_position(array['izquierda', 'centro', 'derecha'], r.seccion),
                          sc.orden nulls first, r.sector_id)
          from public.reserva r
          join public.sede sd on sd.id = r.sede_id
          left join public.sector sc on sc.id = r.sector_id
         where r.sesion_id = v_sesion), '[]'::jsonb)
    )
  );
end;
$$;

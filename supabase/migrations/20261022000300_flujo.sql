-- UsherFlow Etapa 1 / Tarea 7: RPC del flujo Puerta -> Sección.
--   public.mandar_grupo, public.sentar_pendiente, public.cancelar_pendiente
--
-- ---------------------------------------------------------------------------
-- CONCURRENCIA (lo central de esta migración: evitar la sobreventa de asientos)
-- ---------------------------------------------------------------------------
-- Regla: toda función que cambia tramo.ocupados o un pendiente de una sección toma PRIMERO el mismo
-- advisory lock de transacción de esa sección:
--     pg_advisory_xact_lock(hashtextextended(evento_id::text || seccion, 0))
-- y lo mantiene hasta el COMMIT/ROLLBACK. Así, mandar / sentar / cancelar de una misma sección se
-- serializan por completo y nunca se ve un estado a medio confirmar. Secciones distintas (o eventos
-- distintos) no se bloquean entre sí.
--
-- * mandar_grupo conoce la sección (parámetro): toma el lock, calcula `libres` en UNA sola sentencia
--   SQL (cupo público menos pendientes) y recién ahí inserta el pendiente.
-- * sentar_pendiente / cancelar_pendiente sólo conocen la sección a través del pendiente. Patrón:
--     1) leer el pendiente SIN bloquearlo, sólo para obtener su sección (evento y sección de un
--        pendiente son inmutables, así que esa lectura no puede quedar vieja);
--     2) tomar el advisory lock de esa sección;
--     3) volver a leer el pendiente con FOR UPDATE y re-verificar estado = 'pendiente'
--        (si otra transacción lo resolvió mientras esperábamos el lock -> PENDIENTE_YA_RESUELTO).
--   Un pendiente de otro evento se trata como inexistente (PENDIENTE_YA_RESUELTO) para no filtrar datos.
-- * sentar_pendiente además bloquea la fila del tramo con FOR UPDATE (después del advisory lock;
--   el orden advisory -> pendiente -> tramo es siempre el mismo, así que no hay deadlocks).
-- * Los modos de falla son devueltos como {success:false,error:CODE}; la clave inválida se LANZA.
--   Cuando se devuelve un error no se modificó nada.
-- * Un pendiente NUNCA se libera por tiempo (spec 4.1): no hay lógica de vencimiento en ningún lado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. mandar_grupo(p_clave, p_seccion, p_cantidad)
--    Orden de validación: clave -> sección -> cantidad -> cupo.
--    Devuelve {success:true, pendiente_id} | {success:false, error:'SECCION_INVALIDA' |
--    'CANTIDAD_INVALIDA'} | {success:false, error:'SECCION_SIN_CUPO', libres}.
-- ---------------------------------------------------------------------------
create function public.mandar_grupo(p_clave text, p_seccion text, p_cantidad integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_libres integer;
  v_id uuid;
begin
  if p_seccion is null or p_seccion not in ('izquierda', 'centro', 'derecha') then
    return jsonb_build_object('success', false, 'error', 'SECCION_INVALIDA');
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 20 then
    return jsonb_build_object('success', false, 'error', 'CANTIDAD_INVALIDA');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || p_seccion, 0));

  -- libres = cupo público de la sección - personas en pendientes aún no resueltos (mínimo 0).
  -- Una sola sentencia => una sola instantánea; con el lock tomado ya no hay escritores en curso
  -- sobre esta sección, así que nunca lee un estado a medio confirmar.
  select greatest(
           coalesce((select sum(greatest(t.capacidad - t.ocupados, 0))
                       from public.tramo t
                       join public.fila f on f.id = t.fila_id
                      where f.evento_id = v_evento
                        and f.seccion = p_seccion
                        and t.tipo = 'publico'), 0)
           - coalesce((select sum(p.cantidad)
                         from public.pendiente p
                        where p.evento_id = v_evento
                          and p.seccion = p_seccion
                          and p.estado = 'pendiente'), 0),
           0)::integer
    into v_libres;

  if p_cantidad > v_libres then
    return jsonb_build_object('success', false, 'error', 'SECCION_SIN_CUPO', 'libres', v_libres);
  end if;

  insert into public.pendiente (evento_id, seccion, cantidad)
  values (v_evento, p_seccion, p_cantidad)
  returning id into v_id;

  return jsonb_build_object('success', true, 'pendiente_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. sentar_pendiente(p_clave, p_pendiente_id, p_tramo_id)
--    Orden de validación: clave -> pendiente -> tramo existe -> reservado -> sección -> capacidad.
--    Errores: PENDIENTE_YA_RESUELTO | TRAMO_INEXISTENTE | TRAMO_RESERVADO | SECCION_INCORRECTA |
--    TRAMO_SIN_CUPO. Un tramo de otro evento es TRAMO_INEXISTENTE.
-- ---------------------------------------------------------------------------
create function public.sentar_pendiente(p_clave text, p_pendiente_id uuid, p_tramo_id bigint)
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
  v_segundos numeric;
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
  select t.id, t.tipo, t.capacidad, t.ocupados, f.id, f.seccion
    into v_tramo_id, v_tipo, v_capacidad, v_ocupados, v_fila_id, v_fila_seccion
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

  update public.tramo
     set ocupados = ocupados + v_p.cantidad
   where id = v_tramo_id;

  update public.pendiente
     set estado = 'sentado',
         resuelto_en = clock_timestamp()
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
    'segundos', v_segundos));

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. cancelar_pendiente(p_clave, p_pendiente_id)
--    El grupo no llegó: libera su cupo (deja de contar en `libres`). Mismo patrón de lock que sentar.
-- ---------------------------------------------------------------------------
create function public.cancelar_pendiente(p_clave text, p_pendiente_id uuid)
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
  v_segundos numeric;
begin
  select p.seccion into v_seccion
    from public.pendiente p
   where p.id = p_pendiente_id and p.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'PENDIENTE_YA_RESUELTO');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || v_seccion, 0));

  select * into v_p
    from public.pendiente p
   where p.id = p_pendiente_id and p.evento_id = v_evento
     for update;
  if not found or v_p.estado <> 'pendiente' then
    return jsonb_build_object('success', false, 'error', 'PENDIENTE_YA_RESUELTO');
  end if;

  update public.pendiente
     set estado = 'cancelado',
         resuelto_en = clock_timestamp()
   where id = v_p.id;

  v_segundos := round(extract(epoch from (clock_timestamp() - v_p.creado_en))::numeric, 1);

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'no_llegaron', jsonb_build_object(
    'pendiente_id', v_p.id,
    'seccion', v_p.seccion,
    'cantidad', v_p.cantidad,
    'segundos', v_segundos));

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privilegios: API pública de la app (la clave es la credencial).
-- ---------------------------------------------------------------------------
revoke execute on function public.mandar_grupo(text, text, integer) from public, anon, authenticated;
revoke execute on function public.sentar_pendiente(text, uuid, bigint) from public, anon, authenticated;
revoke execute on function public.cancelar_pendiente(text, uuid) from public, anon, authenticated;

grant execute on function public.mandar_grupo(text, text, integer) to anon, authenticated;
grant execute on function public.sentar_pendiente(text, uuid, bigint) to anon, authenticated;
grant execute on function public.cancelar_pendiente(text, uuid) to anon, authenticated;

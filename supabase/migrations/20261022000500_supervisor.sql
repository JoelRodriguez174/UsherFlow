-- UsherFlow Etapa 1 / Tarea 9: RPC de supervisor (destructivas y de gestión de claves).
--   public.reiniciar_salon, public.aplicar_plantilla, public.regenerar_claves,
--   public.modificar_capacidad_tramo, public.obtener_claves
--
-- ---------------------------------------------------------------------------
-- CLAVE Y PRIVILEGIOS
-- ---------------------------------------------------------------------------
-- Las cinco funciones exigen la clave de SUPERVISOR: private.evento_de_clave(p_clave, true). Una clave
-- de ujier, una inexistente, NULL o vacía LANZA CLAVE_INVALIDA, antes de mirar los demás argumentos.
-- Igual que en las Tareas 7 y 8, la clave es la credencial: EXECUTE sólo para anon y authenticated
-- (nunca PUBLIC), SECURITY DEFINER y search_path vacío con todo calificado por esquema.
--
-- ---------------------------------------------------------------------------
-- CONCURRENCIA (misma regla que las Tareas 7 y 8; evita sobreventa de asientos)
-- ---------------------------------------------------------------------------
-- Toda función que escribe tramo.ocupados / capacidad, fila.fragmentada / verificada_en, filas, tramos
-- o pendientes de una sección toma PRIMERO el advisory lock de transacción de esa sección:
--     pg_advisory_xact_lock(hashtextextended(evento_id::text || seccion, 0))
-- y lo mantiene hasta el COMMIT/ROLLBACK.
--
-- * reiniciar_salon(p_seccion := null) y aplicar_plantilla tocan LAS TRES secciones: toman los tres
--   locks en orden FIJO (izquierda, centro, derecha) ANTES de escribir nada. Como el resto de las
--   funciones toma un único advisory lock a la vez (nunca espera un segundo advisory estando con uno
--   tomado), no hay ciclos posibles: quien toma varios locks lo hace siempre en el mismo orden y los
--   demás sólo toman uno.
-- * reiniciar_salon con sección valida la sección y toma sólo ese lock.
-- * modificar_capacidad_tramo sólo conoce la sección a través del tramo. Patrón de las Tareas 7/8:
--     1) leer tramo+fila SIN bloquear, sólo para obtener la fila y su sección (la fila de un tramo y la
--        sección de una fila son inmutables, esa lectura no puede quedar vieja);
--     2) tomar el advisory lock de esa sección;
--     3) releer fila (FOR UPDATE) y después tramo (FOR UPDATE) y re-validar (otra transacción pudo
--        borrarlos mientras esperábamos, p. ej. aplicar_plantilla -> TRAMO_INEXISTENTE).
--   Orden de locks: advisory de la sección -> fila -> tramo (como en la Tarea 8).
-- * regenerar_claves / obtener_claves no tocan asientos: sin locks de sección. regenerar_claves
--   bloquea la fila de `acceso` del evento FOR UPDATE.
-- * Los modos de falla se devuelven como {success:false,error:CODE}; la clave inválida se LANZA.
--   Cuando se devuelve un error no se modificó nada.
-- * Marcas de tiempo: siempre clock_timestamp() (now() queda congelado dentro de una transacción).
-- * Una entidad de otro evento se trata como inexistente (TRAMO_INEXISTENTE) para no filtrar datos.
-- * El registro (auditoría) NUNCA guarda claves.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. obtener_claves(p_clave)
--    El panel del supervisor necesita la clave de ujier para armar los QR de los ujieres.
--    Devuelve {success:true, clave_ujier, clave_supervisor}. No escribe registro.
-- ---------------------------------------------------------------------------
create function public.obtener_claves(p_clave text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_ujier text;
  v_supervisor text;
begin
  select a.clave_ujier, a.clave_supervisor into v_ujier, v_supervisor
    from public.acceso a
   where a.evento_id = v_evento;

  return jsonb_build_object(
    'success', true,
    'clave_ujier', v_ujier,
    'clave_supervisor', v_supervisor
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. regenerar_claves(p_clave)
--    Genera claves nuevas de ujier y de supervisor (misma fórmula que crear_evento: dos uuid sin
--    guiones = 64 hex). Las anteriores dejan de servir de inmediato (se reemplazan en `acceso`) y
--    rotada_en = clock_timestamp(). Las restricciones UNIQUE de acceso siguen mandando: una colisión
--    (probabilidad despreciable, 244 bits aleatorios) abortaría la transacción entera.
--    La fila de `acceso` se bloquea FOR UPDATE y se re-verifica que la clave usada siga siendo la
--    vigente: dos regenerar_claves simultáneos con la misma clave vieja no pueden rotar dos veces
--    (el segundo, tras esperar, ve la clave ya rotada -> CLAVE_INVALIDA).
--    Devuelve EXACTAMENTE {success:true, clave_ujier, clave_supervisor} (el cliente lee esas tres).
--    Registro 'regenerar_claves' con detalle {} (nunca claves).
-- ---------------------------------------------------------------------------
create function public.regenerar_claves(p_clave text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_actual text;
  v_ujier text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_supervisor text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select a.clave_supervisor into v_actual
    from public.acceso a
   where a.evento_id = v_evento
     for update;
  if not found or v_actual is distinct from p_clave then
    raise exception 'CLAVE_INVALIDA';
  end if;

  update public.acceso
     set clave_ujier = v_ujier,
         clave_supervisor = v_supervisor,
         rotada_en = clock_timestamp()
   where evento_id = v_evento;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'regenerar_claves', '{}'::jsonb);

  return jsonb_build_object(
    'success', true,
    'clave_ujier', v_ujier,
    'clave_supervisor', v_supervisor
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. modificar_capacidad_tramo(p_clave, p_tramo_id, p_capacidad)
--    Cambia la capacidad de un tramo (público o reservado) y ajusta ocupados = least(ocupados,
--    capacidad). No toca fragmentada ni verificada_en.
--    Orden de validación: clave -> tramo existe (de este evento) -> capacidad (entero 1..1000).
--    Devuelve {success:true, capacidad, ocupados:<nuevo>} | {success:false, error:'TRAMO_INEXISTENTE' |
--    'CAPACIDAD_INVALIDA'}.
--    Registro 'capacidad': {tramo_id, antes, despues, ocupados_antes, ocupados_despues}.
--    Nota: bajar la capacidad puede dejar pendientes que ya no caben en la sección. Eso no vende de más:
--    `libres` de mandar_grupo se acota en 0 (greatest(..., 0)) y no se aceptan más grupos hasta que se
--    resuelvan pendientes o alguien se levante; sentar_pendiente revalida la capacidad del tramo.
-- ---------------------------------------------------------------------------
create function public.modificar_capacidad_tramo(p_clave text, p_tramo_id bigint, p_capacidad integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_fila_id bigint;
  v_seccion text;
  v_antes integer;
  v_ocupados_antes integer;
  v_ocupados integer;
begin
  -- Paso 1 (sin bloquear): sólo para conocer la fila y la sección. Otro evento = inexistente.
  select f.id, f.seccion into v_fila_id, v_seccion
    from public.tramo t
    join public.fila f on f.id = t.fila_id
   where t.id = p_tramo_id and f.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  if p_capacidad is null or p_capacidad < 1 or p_capacidad > 1000 then
    return jsonb_build_object('success', false, 'error', 'CAPACIDAD_INVALIDA');
  end if;

  -- Paso 2: lock de la sección (el mismo que toma el flujo de las Tareas 7 y 8).
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || v_seccion, 0));

  -- Paso 3: releer con FOR UPDATE (fila y después tramo) y re-validar.
  perform 1
     from public.fila f
    where f.id = v_fila_id and f.evento_id = v_evento
      for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  select t.capacidad, t.ocupados into v_antes, v_ocupados_antes
    from public.tramo t
   where t.id = p_tramo_id and t.fila_id = v_fila_id
     for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  update public.tramo
     set capacidad = p_capacidad,
         ocupados = least(ocupados, p_capacidad)
   where id = p_tramo_id
  returning ocupados into v_ocupados;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'capacidad', jsonb_build_object(
    'tramo_id', p_tramo_id,
    'antes', v_antes,
    'despues', p_capacidad,
    'ocupados_antes', v_ocupados_antes,
    'ocupados_despues', v_ocupados));

  return jsonb_build_object('success', true, 'capacidad', p_capacidad, 'ocupados', v_ocupados);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. reiniciar_salon(p_clave, p_seccion default null)
--    "Vaciar el auditorio": ocupados = 0 y fragmentada = false en todos los tramos/filas del evento (o
--    sólo de la sección dada) y los pendientes de ese alcance pasan a 'cancelado' con
--    resuelto_en = clock_timestamp(). CONSERVA filas, tramos, capacidades y tramos reservados (tipo y
--    etiqueta). Los pendientes ya 'sentado' / 'cancelado' no se tocan y ningún pendiente se borra.
--    verificada_en = NULL: un reinicio significa que nada está verificado (todo el conteo previo deja de
--    valer), así que se borra la marca en las filas del alcance.
--    Sólo se escriben las filas que cambian (menos eventos de Realtime): tramos con ocupados <> 0 y
--    filas con fragmentada o verificada_en.
--    Orden de validación: clave -> sección (NULL = todo el salón; otro valor inválido -> SECCION_INVALIDA).
--    Devuelve {success:true, tramos_reiniciados, pendientes_cancelados} | {success:false,
--    error:'SECCION_INVALIDA'}. tramos_reiniciados = tramos que tenían ocupados > 0.
--    Registro 'reinicio': {seccion|null, tramos_reiniciados, pendientes_cancelados}.
-- ---------------------------------------------------------------------------
create function public.reiniciar_salon(p_clave text, p_seccion text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_tramos integer;
  v_pendientes integer;
  v_ahora timestamptz;
begin
  if p_seccion is not null and p_seccion not in ('izquierda', 'centro', 'derecha') then
    return jsonb_build_object('success', false, 'error', 'SECCION_INVALIDA');
  end if;

  -- Locks ANTES de escribir: una sección, o las tres en orden fijo izquierda, centro, derecha.
  if p_seccion is null then
    perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'izquierda', 0));
    perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'centro', 0));
    perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'derecha', 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_evento::text || p_seccion, 0));
  end if;

  v_ahora := clock_timestamp();

  update public.pendiente p
     set estado = 'cancelado',
         resuelto_en = v_ahora
   where p.evento_id = v_evento
     and p.estado = 'pendiente'
     and (p_seccion is null or p.seccion = p_seccion);
  get diagnostics v_pendientes = row_count;

  update public.tramo t
     set ocupados = 0
    from public.fila f
   where f.id = t.fila_id
     and f.evento_id = v_evento
     and (p_seccion is null or f.seccion = p_seccion)
     and t.ocupados <> 0;
  get diagnostics v_tramos = row_count;

  update public.fila f
     set fragmentada = false,
         verificada_en = null
   where f.evento_id = v_evento
     and (p_seccion is null or f.seccion = p_seccion)
     and (f.fragmentada or f.verificada_en is not null);

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'reinicio', jsonb_build_object(
    'seccion', p_seccion,
    'tramos_reiniciados', v_tramos,
    'pendientes_cancelados', v_pendientes));

  return jsonb_build_object(
    'success', true,
    'tramos_reiniciados', v_tramos,
    'pendientes_cancelados', v_pendientes);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. aplicar_plantilla(p_clave, p_plantilla)
--    Reemplaza TODAS las filas y tramos del evento por los de la plantilla y cancela los pendientes.
--    Forma de p_plantilla: la del tipo Plantilla del cliente (ver private.aplicar_plantilla).
--    Orden de validación: clave -> plantilla vacía o que no es un objeto (PLANTILLA_INVALIDA, ANTES de
--    borrar nada: private.aplicar_plantilla acepta una plantilla vacía y, sin este chequeo, esta función
--    vaciaría el salón) -> resto de la plantilla (PLANTILLA_INVALIDA).
--    Atomicidad: el borrado, la cancelación de pendientes y la inserción corren dentro de UN bloque con
--    EXCEPTION (subtransacción). Si private.aplicar_plantilla lanza PLANTILLA_INVALIDA, el bloque se
--    deshace entero (el salón y los pendientes quedan como estaban) y se devuelve
--    {success:false,error:'PLANTILLA_INVALIDA'}. Cualquier otro error se relanza.
--    Se mantienen los locks de las tres secciones, tomados antes del bloque.
--    Devuelve {success:true, filas:<cantidad>} | {success:false, error:'PLANTILLA_INVALIDA'}.
--    Registro 'plantilla': {filas, tramos}. Los pendientes no se borran (queda el historial).
-- ---------------------------------------------------------------------------
create function public.aplicar_plantilla(p_clave text, p_plantilla jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave, true);
  v_filas integer;
  v_tramos integer;
  v_ahora timestamptz;
begin
  -- Plantilla vacía o que no es un objeto: rechazar antes de tocar nada ni tomar locks.
  if p_plantilla is null or jsonb_typeof(p_plantilla) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'PLANTILLA_INVALIDA');
  end if;
  if coalesce((select sum(jsonb_array_length(e.value))
                 from jsonb_each(p_plantilla) e
                where jsonb_typeof(e.value) = 'array'), 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'PLANTILLA_INVALIDA');
  end if;

  -- Los tres locks, en orden fijo, ANTES de escribir.
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'izquierda', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'centro', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || 'derecha', 0));

  v_ahora := clock_timestamp();

  begin
    update public.pendiente p
       set estado = 'cancelado',
           resuelto_en = v_ahora
     where p.evento_id = v_evento
       and p.estado = 'pendiente';

    -- Borra todas las filas del evento; los tramos caen en cascada.
    delete from public.fila f where f.evento_id = v_evento;

    perform private.aplicar_plantilla(v_evento, p_plantilla);
  exception
    when raise_exception then
      if sqlerrm = 'PLANTILLA_INVALIDA' then
        -- El bloque ya se deshizo (subtransacción): nada cambió.
        return jsonb_build_object('success', false, 'error', 'PLANTILLA_INVALIDA');
      end if;
      raise;
  end;

  select count(*)::integer into v_filas
    from public.fila f
   where f.evento_id = v_evento;
  select count(*)::integer into v_tramos
    from public.tramo t
    join public.fila f on f.id = t.fila_id
   where f.evento_id = v_evento;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'plantilla', jsonb_build_object('filas', v_filas, 'tramos', v_tramos));

  return jsonb_build_object('success', true, 'filas', v_filas);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privilegios: API pública de la app (la clave de supervisor es la credencial).
-- ---------------------------------------------------------------------------
revoke execute on function public.reiniciar_salon(text, text) from public, anon, authenticated;
revoke execute on function public.aplicar_plantilla(text, jsonb) from public, anon, authenticated;
revoke execute on function public.regenerar_claves(text) from public, anon, authenticated;
revoke execute on function public.modificar_capacidad_tramo(text, bigint, integer) from public, anon, authenticated;
revoke execute on function public.obtener_claves(text) from public, anon, authenticated;

grant execute on function public.reiniciar_salon(text, text) to anon, authenticated;
grant execute on function public.aplicar_plantilla(text, jsonb) to anon, authenticated;
grant execute on function public.regenerar_claves(text) to anon, authenticated;
grant execute on function public.modificar_capacidad_tramo(text, bigint, integer) to anon, authenticated;
grant execute on function public.obtener_claves(text) to anon, authenticated;

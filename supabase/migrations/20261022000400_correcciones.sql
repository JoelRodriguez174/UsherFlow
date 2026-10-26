-- UsherFlow Etapa 1 / Tarea 8: RPC de correcciones y verificación de filas.
--   public.se_levanto, public.corregir_conteo, public.juntar_fila, public.verificar_fila,
--   public.agregar_fila_al_fondo
--
-- ---------------------------------------------------------------------------
-- CONCURRENCIA (misma regla que la Tarea 7; evita sobreventa de asientos)
-- ---------------------------------------------------------------------------
-- Toda función que escribe tramo.ocupados / capacidad / tipo, fila.fragmentada o crea filas toma
-- PRIMERO el mismo advisory lock de transacción de la sección que mandar_grupo / sentar_pendiente /
-- cancelar_pendiente:
--     pg_advisory_xact_lock(hashtextextended(evento_id::text || seccion, 0))
-- y lo mantiene hasta el COMMIT/ROLLBACK. Así, correcciones y flujo de una misma sección se
-- serializan por completo; secciones o eventos distintos no se bloquean entre sí.
--
-- * agregar_fila_al_fondo recibe la sección: la valida, toma el lock y recién ahí calcula
--   max(numero) + 1 (dos llamadas simultáneas no pueden elegir el mismo número).
-- * se_levanto / corregir_conteo (reciben un tramo) y juntar_fila / verificar_fila (reciben una fila)
--   sólo conocen la sección a través de la entidad. Patrón:
--     1) leer la entidad SIN bloquear, sólo para obtener su sección (evento y sección de una fila, y la
--        fila de un tramo, son inmutables: esa lectura no puede quedar vieja);
--     2) tomar el advisory lock de esa sección;
--     3) volver a leer con FOR UPDATE y re-validar (otra transacción pudo borrarla mientras
--        esperábamos el lock -> se trata como inexistente).
--   Una entidad de otro evento se trata como inexistente (TRAMO_INEXISTENTE / FILA_INEXISTENTE) para
--   no filtrar datos.
-- * Orden de locks: advisory de la sección -> fila (FOR UPDATE) -> tramo (FOR UPDATE).
--   La Tarea 7 usa advisory -> pendiente -> tramo -> fila. Como TODAS las rutas toman primero el
--   mismo advisory lock de la sección, a partir de ahí hay un único escritor por sección y no puede
--   haber deadlocks entre filas/tramos de la misma sección; filas de secciones distintas no se
--   comparten nunca.
-- * Los modos de falla se devuelven como {success:false,error:CODE}; la clave inválida se LANZA
--   (private.evento_de_clave acepta clave de ujier o de supervisor). Cuando se devuelve un error no se
--   modificó nada.
-- * Marcas de tiempo: siempre clock_timestamp() (now() queda congelado dentro de una transacción), y
--   se calcula una sola vez por llamada.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. se_levanto(p_clave, p_tramo_id)
--    Alguien se levantó de un tramo público: ocupados - 1.
--    Fragmentación: ocupadosFila = suma de ocupados de los tramos PÚBLICOS de la fila, contada
--    ANTES de restar. Si es >= 4 la fila pasa a fragmentada = true (y así se queda hasta juntar_fila,
--    aunque después baje de 4). No toca verificada_en: levantarse no es verificar la fila.
--    Orden de validación: clave -> tramo existe (de este evento) -> reservado -> vacío.
--    Devuelve {success:true, ocupados:<nuevo>, fragmentada:<marca actual de la fila>} |
--    {success:false, error:'TRAMO_INEXISTENTE' | 'TRAMO_RESERVADO' | 'TRAMO_VACIO'}.
--    Registro 'se_levanto': {tramo_id, fila_id, ocupados_antes, ocupados_despues, fragmenta}, donde
--    fragmenta indica que en ESTA llamada se cumplió la condición (ocupadosFila >= 4).
-- ---------------------------------------------------------------------------
create function public.se_levanto(p_clave text, p_tramo_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_fila_id bigint;
  v_seccion text;
  v_tipo text;
  v_ocupados integer;
  v_ocupados_fila integer;
  v_fragmenta boolean;
  v_fragmentada boolean;
begin
  -- Paso 1 (sin bloquear): sólo para conocer la fila y la sección. Otro evento = inexistente.
  select f.id, f.seccion into v_fila_id, v_seccion
    from public.tramo t
    join public.fila f on f.id = t.fila_id
   where t.id = p_tramo_id and f.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  -- Paso 2: lock de la sección (el mismo que toma el flujo de la Tarea 7).
  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || v_seccion, 0));

  -- Paso 3: releer con FOR UPDATE (fila y después tramo) y re-validar.
  perform 1
     from public.fila f
    where f.id = v_fila_id and f.evento_id = v_evento
      for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  select t.tipo, t.ocupados into v_tipo, v_ocupados
    from public.tramo t
   where t.id = p_tramo_id and t.fila_id = v_fila_id
     for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  if v_tipo = 'reservado' then
    return jsonb_build_object('success', false, 'error', 'TRAMO_RESERVADO');
  end if;
  if v_ocupados = 0 then
    return jsonb_build_object('success', false, 'error', 'TRAMO_VACIO');
  end if;

  -- ocupadosFila ANTES de restar (con el lock de la sección tomado, nadie más escribe esta fila).
  select coalesce(sum(t.ocupados), 0)::integer into v_ocupados_fila
    from public.tramo t
   where t.fila_id = v_fila_id and t.tipo = 'publico';
  v_fragmenta := v_ocupados_fila >= 4;

  update public.tramo
     set ocupados = ocupados - 1
   where id = p_tramo_id;

  -- Una vez fragmentada, la marca sólo la apaga juntar_fila.
  update public.fila
     set fragmentada = fragmentada or v_fragmenta
   where id = v_fila_id
  returning fragmentada into v_fragmentada;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'se_levanto', jsonb_build_object(
    'tramo_id', p_tramo_id,
    'fila_id', v_fila_id,
    'ocupados_antes', v_ocupados,
    'ocupados_despues', v_ocupados - 1,
    'fragmenta', v_fragmenta));

  return jsonb_build_object('success', true, 'ocupados', v_ocupados - 1, 'fragmentada', v_fragmentada);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. corregir_conteo(p_clave, p_tramo_id, p_libres_vistos)
--    El ujier contó los asientos libres de un tramo público: ocupados = capacidad - libres.
--    NO toca fragmentada. Deja la fila verificada (verificada_en = clock_timestamp()).
--    Orden de validación: clave -> tramo existe (de este evento) -> reservado -> rango.
--    Un tramo reservado se rechaza (TRAMO_RESERVADO) porque no se cuenta. p_libres_vistos debe estar
--    en 0..capacidad (NULL también es RANGO_INVALIDO).
--    Devuelve {success:true, ocupados:<nuevo>} | {success:false, error:'TRAMO_INEXISTENTE' |
--    'TRAMO_RESERVADO' | 'RANGO_INVALIDO'}.
--    Registro 'correccion': {tramo_id, fila_id, antes, despues, libres_vistos}.
--    Nota: una corrección hacia arriba puede dejar ocupados + pendientes > capacidad pública de la
--    sección. Eso no vende de más: `libres` de mandar_grupo se acota en 0 (greatest(..., 0)) y no se
--    aceptan más grupos hasta que se resuelvan pendientes o alguien se levante.
-- ---------------------------------------------------------------------------
create function public.corregir_conteo(p_clave text, p_tramo_id bigint, p_libres_vistos integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_fila_id bigint;
  v_seccion text;
  v_tipo text;
  v_capacidad integer;
  v_ocupados integer;
  v_nuevo integer;
  v_ahora timestamptz;
begin
  select f.id, f.seccion into v_fila_id, v_seccion
    from public.tramo t
    join public.fila f on f.id = t.fila_id
   where t.id = p_tramo_id and f.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || v_seccion, 0));

  perform 1
     from public.fila f
    where f.id = v_fila_id and f.evento_id = v_evento
      for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  select t.tipo, t.capacidad, t.ocupados into v_tipo, v_capacidad, v_ocupados
    from public.tramo t
   where t.id = p_tramo_id and t.fila_id = v_fila_id
     for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'TRAMO_INEXISTENTE');
  end if;

  if v_tipo = 'reservado' then
    return jsonb_build_object('success', false, 'error', 'TRAMO_RESERVADO');
  end if;
  if p_libres_vistos is null or p_libres_vistos < 0 or p_libres_vistos > v_capacidad then
    return jsonb_build_object('success', false, 'error', 'RANGO_INVALIDO');
  end if;

  v_ahora := clock_timestamp();
  v_nuevo := v_capacidad - p_libres_vistos;

  update public.tramo
     set ocupados = v_nuevo
   where id = p_tramo_id;

  update public.fila
     set verificada_en = v_ahora
   where id = v_fila_id;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'correccion', jsonb_build_object(
    'tramo_id', p_tramo_id,
    'fila_id', v_fila_id,
    'antes', v_ocupados,
    'despues', v_nuevo,
    'libres_vistos', p_libres_vistos));

  return jsonb_build_object('success', true, 'ocupados', v_nuevo);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. juntar_fila(p_clave, p_fila_id)
--    La fila se volvió a juntar: fragmentada = false. Idempotente (éxito aunque ya estuviera apagada).
--    Devuelve {success:true} | {success:false, error:'FILA_INEXISTENTE'}.
--    Registro 'juntar': {fila_id}.
-- ---------------------------------------------------------------------------
create function public.juntar_fila(p_clave text, p_fila_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_seccion text;
begin
  select f.seccion into v_seccion
    from public.fila f
   where f.id = p_fila_id and f.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'FILA_INEXISTENTE');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || v_seccion, 0));

  perform 1
     from public.fila f
    where f.id = p_fila_id and f.evento_id = v_evento
      for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'FILA_INEXISTENTE');
  end if;

  update public.fila
     set fragmentada = false
   where id = p_fila_id;

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'juntar', jsonb_build_object('fila_id', p_fila_id));

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. verificar_fila(p_clave, p_fila_id)
--    El ujier confirmó a ojo que la fila está como el sistema dice: sólo verificada_en =
--    clock_timestamp(). NO escribe registro: es una acción de muy alto volumen y poco valor de auditoría
--    (verificada_en ya guarda el último momento).
--    Devuelve {success:true} | {success:false, error:'FILA_INEXISTENTE'}.
-- ---------------------------------------------------------------------------
create function public.verificar_fila(p_clave text, p_fila_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_seccion text;
  v_ahora timestamptz;
begin
  select f.seccion into v_seccion
    from public.fila f
   where f.id = p_fila_id and f.evento_id = v_evento;
  if not found then
    return jsonb_build_object('success', false, 'error', 'FILA_INEXISTENTE');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || v_seccion, 0));

  perform 1
     from public.fila f
    where f.id = p_fila_id and f.evento_id = v_evento
      for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'FILA_INEXISTENTE');
  end if;

  v_ahora := clock_timestamp();

  update public.fila
     set verificada_en = v_ahora
   where id = p_fila_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. agregar_fila_al_fondo(p_clave, p_seccion, p_capacidad default 8)
--    Crea la fila siguiente al fondo de la sección (numero = max + 1, o 1 si la sección está vacía) con
--    un único tramo público (orden 1, ocupados 0, sin etiqueta).
--    Orden de validación: clave -> sección -> capacidad (entero 1..1000; NULL explícito = inválida).
--    Devuelve {success:true, fila_id, numero} | {success:false, error:'SECCION_INVALIDA' |
--    'CAPACIDAD_INVALIDA'}. Registro 'agregar_fila': {seccion, numero, fila_id, capacidad}.
--    El lock de la sección se toma ANTES de calcular max(numero) + 1.
-- ---------------------------------------------------------------------------
create function public.agregar_fila_al_fondo(p_clave text, p_seccion text, p_capacidad integer default 8)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_numero integer;
  v_fila_id bigint;
begin
  if p_seccion is null or p_seccion not in ('izquierda', 'centro', 'derecha') then
    return jsonb_build_object('success', false, 'error', 'SECCION_INVALIDA');
  end if;
  if p_capacidad is null or p_capacidad < 1 or p_capacidad > 1000 then
    return jsonb_build_object('success', false, 'error', 'CAPACIDAD_INVALIDA');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || p_seccion, 0));

  select coalesce(max(f.numero), 0) + 1 into v_numero
    from public.fila f
   where f.evento_id = v_evento and f.seccion = p_seccion;

  insert into public.fila (evento_id, seccion, numero)
  values (v_evento, p_seccion, v_numero)
  returning id into v_fila_id;

  insert into public.tramo (fila_id, orden, tipo, capacidad, ocupados, etiqueta)
  values (v_fila_id, 1, 'publico', p_capacidad, 0, null);

  insert into public.registro (evento_id, tipo, detalle)
  values (v_evento, 'agregar_fila', jsonb_build_object(
    'seccion', p_seccion,
    'numero', v_numero,
    'fila_id', v_fila_id,
    'capacidad', p_capacidad));

  return jsonb_build_object('success', true, 'fila_id', v_fila_id, 'numero', v_numero);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privilegios: API pública de la app (la clave es la credencial).
-- ---------------------------------------------------------------------------
revoke execute on function public.se_levanto(text, bigint) from public, anon, authenticated;
revoke execute on function public.corregir_conteo(text, bigint, integer) from public, anon, authenticated;
revoke execute on function public.juntar_fila(text, bigint) from public, anon, authenticated;
revoke execute on function public.verificar_fila(text, bigint) from public, anon, authenticated;
revoke execute on function public.agregar_fila_al_fondo(text, text, integer) from public, anon, authenticated;

grant execute on function public.se_levanto(text, bigint) to anon, authenticated;
grant execute on function public.corregir_conteo(text, bigint, integer) to anon, authenticated;
grant execute on function public.juntar_fila(text, bigint) to anon, authenticated;
grant execute on function public.verificar_fila(text, bigint) to anon, authenticated;
grant execute on function public.agregar_fila_al_fondo(text, text, integer) to anon, authenticated;

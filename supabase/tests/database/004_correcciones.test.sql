-- Task 8 (Etapa 1): RPC de correcciones (se_levanto, corregir_conteo, juntar_fila, verificar_fila,
-- agregar_fila_al_fondo).
-- Orden de validación (documentado y probado):
--   se_levanto:            clave -> tramo existe (de este evento) -> reservado -> vacío
--   corregir_conteo:       clave -> tramo existe (de este evento) -> reservado -> rango
--   juntar_fila:           clave -> fila existe (de este evento)
--   verificar_fila:        clave -> fila existe (de este evento)
--   agregar_fila_al_fondo: clave -> sección -> capacidad
begin;
select plan(164);

-- ---------------------------------------------------------------------------
-- Estructura y privilegios
-- ---------------------------------------------------------------------------
select has_function('public', 'se_levanto', array['text', 'bigint'], 'existe public.se_levanto(text, bigint)');
select has_function('public', 'corregir_conteo', array['text', 'bigint', 'integer'], 'existe public.corregir_conteo(text, bigint, integer)');
select has_function('public', 'juntar_fila', array['text', 'bigint'], 'existe public.juntar_fila(text, bigint)');
select has_function('public', 'verificar_fila', array['text', 'bigint'], 'existe public.verificar_fila(text, bigint)');
select has_function('public', 'agregar_fila_al_fondo', array['text', 'text', 'integer'], 'existe public.agregar_fila_al_fondo(text, text, integer)');

select is_definer('public', 'se_levanto', array['text', 'bigint'], 'se_levanto es SECURITY DEFINER');
select is_definer('public', 'corregir_conteo', array['text', 'bigint', 'integer'], 'corregir_conteo es SECURITY DEFINER');
select is_definer('public', 'juntar_fila', array['text', 'bigint'], 'juntar_fila es SECURITY DEFINER');
select is_definer('public', 'verificar_fila', array['text', 'bigint'], 'verificar_fila es SECURITY DEFINER');
select is_definer('public', 'agregar_fila_al_fondo', array['text', 'text', 'integer'], 'agregar_fila_al_fondo es SECURITY DEFINER');

select function_returns('public', 'se_levanto', array['text', 'bigint'], 'jsonb', 'se_levanto devuelve jsonb');
select function_returns('public', 'corregir_conteo', array['text', 'bigint', 'integer'], 'jsonb', 'corregir_conteo devuelve jsonb');
select function_returns('public', 'juntar_fila', array['text', 'bigint'], 'jsonb', 'juntar_fila devuelve jsonb');
select function_returns('public', 'verificar_fila', array['text', 'bigint'], 'jsonb', 'verificar_fila devuelve jsonb');
select function_returns('public', 'agregar_fila_al_fondo', array['text', 'text', 'integer'], 'jsonb', 'agregar_fila_al_fondo devuelve jsonb');

select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.se_levanto(text,bigint)'::regprocedure,
                    'public.corregir_conteo(text,bigint,integer)'::regprocedure,
                    'public.juntar_fila(text,bigint)'::regprocedure,
                    'public.verificar_fila(text,bigint)'::regprocedure,
                    'public.agregar_fila_al_fondo(text,text,integer)'::regprocedure)
      and p.proconfig = array['search_path=""']),
  5,
  'las cinco funciones fijan search_path = ''''');

select ok(has_function_privilege('anon', 'public.se_levanto(text,bigint)', 'EXECUTE'), 'anon puede ejecutar se_levanto');
select ok(has_function_privilege('anon', 'public.corregir_conteo(text,bigint,integer)', 'EXECUTE'), 'anon puede ejecutar corregir_conteo');
select ok(has_function_privilege('anon', 'public.juntar_fila(text,bigint)', 'EXECUTE'), 'anon puede ejecutar juntar_fila');
select ok(has_function_privilege('anon', 'public.verificar_fila(text,bigint)', 'EXECUTE'), 'anon puede ejecutar verificar_fila');
select ok(has_function_privilege('anon', 'public.agregar_fila_al_fondo(text,text,integer)', 'EXECUTE'), 'anon puede ejecutar agregar_fila_al_fondo');
select ok(has_function_privilege('authenticated', 'public.se_levanto(text,bigint)', 'EXECUTE'), 'authenticated puede ejecutar se_levanto');
select ok(has_function_privilege('authenticated', 'public.corregir_conteo(text,bigint,integer)', 'EXECUTE'), 'authenticated puede ejecutar corregir_conteo');
select ok(has_function_privilege('authenticated', 'public.juntar_fila(text,bigint)', 'EXECUTE'), 'authenticated puede ejecutar juntar_fila');
select ok(has_function_privilege('authenticated', 'public.verificar_fila(text,bigint)', 'EXECUTE'), 'authenticated puede ejecutar verificar_fila');
select ok(has_function_privilege('authenticated', 'public.agregar_fila_al_fondo(text,text,integer)', 'EXECUTE'), 'authenticated puede ejecutar agregar_fila_al_fondo');
select ok(
  not exists (
    select 1
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid in ('public.se_levanto(text,bigint)'::regprocedure,
                     'public.corregir_conteo(text,bigint,integer)'::regprocedure,
                     'public.juntar_fila(text,bigint)'::regprocedure,
                     'public.verificar_fila(text,bigint)'::regprocedure,
                     'public.agregar_fila_al_fondo(text,text,integer)'::regprocedure)
       and a.grantee = 0),
  'PUBLIC no tiene EXECUTE sobre ninguna de las cinco funciones');

-- ---------------------------------------------------------------------------
-- Datos de prueba
--   Evento A  centro    fila 1: [pub 3][res 2 "Mamás"][pub 3]   (ta, tr, tc)  ocupados 2 + 2 = 4 en DOS tramos públicos
--                       fila 2: [pub 8] (td) ocupados 4
--                       fila 3: [pub 8] (te) ocupados 3
--                       fila 4: [pub 8] (tf) ocupados 4
--                       fila 5: [pub 4] (tg) ocupados 2   (bloque de la clave de supervisor)
--             izquierda fila 1: [pub 2] (ti) ocupados 2   (integración con mandar_grupo / sentar_pendiente)
--             derecha   filas 1..15: [pub 8] cada una (d1 = tramo de la fila 1, ocupados 0)
--   Evento B  centro    fila 1: [pub 4] (tb) ocupados 2; izquierda y derecha vacías
-- ---------------------------------------------------------------------------
create temp table _r as
  select public.crear_evento('Correcciones A') as a, public.crear_evento('Correcciones B') as b;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ka, a->>'clave_supervisor' as sa,
         (b->>'evento_id')::uuid as eb, b->>'clave_ujier' as kb
    from _r;
grant select on _k to anon, authenticated;

select private.aplicar_plantilla(
  (select ea from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":3}]},
              {"numero":2,"tramos":[{"tipo":"publico","capacidad":8}]},
              {"numero":3,"tramos":[{"tipo":"publico","capacidad":8}]},
              {"numero":4,"tramos":[{"tipo":"publico","capacidad":8}]},
              {"numero":5,"tramos":[{"tipo":"publico","capacidad":4}]}],
    "izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":2}]}]}'::jsonb
  || jsonb_build_object('derecha', (
       select jsonb_agg(jsonb_build_object('numero', n, 'tramos',
                jsonb_build_array(jsonb_build_object('tipo', 'publico', 'capacidad', 8))) order by n)
         from generate_series(1, 15) n)));
select private.aplicar_plantilla(
  (select eb from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}]}'::jsonb);

create temp table _t as
  select
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 1 and t.orden = 1) as ta,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 1 and t.orden = 2) as tr,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 1 and t.orden = 3) as tc,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 2) as td,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 3) as te,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 4) as tf,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 5) as tg,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'izquierda' and f.numero = 1) as ti,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.ea and f.seccion = 'derecha' and f.numero = 1) as td1,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = _k.eb and f.seccion = 'centro' and f.numero = 1) as tb,
    (select f.id from public.fila f where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 1) as f1,
    (select f.id from public.fila f where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 2) as f2,
    (select f.id from public.fila f where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 3) as f3,
    (select f.id from public.fila f where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 4) as f4,
    (select f.id from public.fila f where f.evento_id = _k.ea and f.seccion = 'centro' and f.numero = 5) as f5,
    (select f.id from public.fila f where f.evento_id = _k.ea and f.seccion = 'derecha' and f.numero = 1) as fd1,
    (select f.id from public.fila f where f.evento_id = _k.eb and f.seccion = 'centro' and f.numero = 1) as fb
  from _k;
grant select on _t to anon, authenticated;

create temp table _p (n text primary key, r jsonb);
grant select on _p to anon, authenticated;
create temp table _v (n text primary key, v timestamptz, c integer);

-- Estados iniciales (se escriben como superusuario, directo en las tablas)
update public.tramo set ocupados = 2 where id in ((select ta from _t), (select tc from _t));
update public.tramo set ocupados = 4 where id in ((select td from _t), (select tf from _t));
update public.tramo set ocupados = 3 where id = (select te from _t);
update public.tramo set ocupados = 2 where id in ((select tg from _t), (select ti from _t), (select tb from _t));

select is(
  (select sum(t.ocupados)::int from public.tramo t where t.fila_id = (select f1 from _t)),
  4, 'preparación: la fila 1 (con tramo reservado en el medio) tiene 4 ocupados repartidos en DOS tramos públicos');

-- ---------------------------------------------------------------------------
-- Claves inválidas: se LANZA CLAVE_INVALIDA (se valida antes que los argumentos)
-- ---------------------------------------------------------------------------
select throws_ok($$select public.se_levanto('clave-mala', 1)$$, null, 'CLAVE_INVALIDA', 'se_levanto con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.se_levanto(null, null)$$, null, 'CLAVE_INVALIDA', 'se_levanto con todo NULL lanza CLAVE_INVALIDA');
select throws_ok($$select public.corregir_conteo('clave-mala', 1, 0)$$, null, 'CLAVE_INVALIDA', 'corregir_conteo con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.corregir_conteo('', null, null)$$, null, 'CLAVE_INVALIDA', 'corregir_conteo con clave vacía lanza CLAVE_INVALIDA');
select throws_ok($$select public.juntar_fila('clave-mala', 1)$$, null, 'CLAVE_INVALIDA', 'juntar_fila con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.juntar_fila(null, null)$$, null, 'CLAVE_INVALIDA', 'juntar_fila con todo NULL lanza CLAVE_INVALIDA');
select throws_ok($$select public.verificar_fila('clave-mala', 1)$$, null, 'CLAVE_INVALIDA', 'verificar_fila con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.verificar_fila('', null)$$, null, 'CLAVE_INVALIDA', 'verificar_fila con clave vacía lanza CLAVE_INVALIDA');
select throws_ok($$select public.agregar_fila_al_fondo('clave-mala', 'centro', 8)$$, null, 'CLAVE_INVALIDA', 'agregar_fila_al_fondo con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.agregar_fila_al_fondo('clave-mala', 'fondo', 0)$$, null, 'CLAVE_INVALIDA', 'agregar_fila_al_fondo: la clave se valida antes que los argumentos');

-- ---------------------------------------------------------------------------
-- se_levanto: fragmentación (se cuenta ANTES de restar)
-- ---------------------------------------------------------------------------
-- Fila 2: un solo tramo de 8 con 4 ocupados -> al levantarse queda fragmentada
select is(public.se_levanto((select ka from _k), (select td from _t)), '{"success":true,"ocupados":3,"fragmentada":true}'::jsonb, 'fila con 4 ocupados + se_levanto -> success, ocupados 3, fragmentada true');
select is((select ocupados from public.tramo where id = (select td from _t)), 3, 'se_levanto resta 1 al tramo');
select is((select fragmentada from public.fila where id = (select f2 from _t)), true, 'fila con 4 ocupados antes de restar queda fragmentada');
select is((select verificada_en is null from public.fila where id = (select f2 from _t)), true, 'se_levanto no marca la fila como verificada');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'se_levanto'), 1, 'se_levanto escribe un registro se_levanto');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'se_levanto')) k),
  array['fila_id', 'fragmenta', 'ocupados_antes', 'ocupados_despues', 'tramo_id'], 'el registro se_levanto tiene tramo_id, fila_id, ocupados_antes, ocupados_despues y fragmenta');
select results_eq(
  $$select (detalle->>'tramo_id')::bigint, (detalle->>'fila_id')::bigint, (detalle->>'ocupados_antes')::int, (detalle->>'ocupados_despues')::int, (detalle->>'fragmenta')::boolean
      from public.registro where evento_id = (select ea from _k) and tipo = 'se_levanto'$$,
  $$select td, f2, 4, 3, true from _t$$,
  'el detalle de se_levanto apunta al tramo y la fila correctos (4 -> 3, fragmenta)');

-- Segunda vez seguida: ahora hay 3 (< 4) pero la marca sigue en true hasta juntar_fila
select is(public.se_levanto((select ka from _k), (select td from _t)), '{"success":true,"ocupados":2,"fragmentada":true}'::jsonb, 'se_levanto dos veces seguidas -> ocupados 2');
select is((select fragmentada from public.fila where id = (select f2 from _t)), true, 'fragmentada sigue en true aunque ahora haya menos de 4 ocupados');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'se_levanto'), 2, 'cada se_levanto exitoso escribe su registro');
select is(
  (select (detalle->>'fragmenta')::boolean from public.registro where evento_id = (select ea from _k) and tipo = 'se_levanto' order by id desc limit 1),
  false, 'el segundo se_levanto (3 ocupados antes) registra fragmenta = false');

-- Fila 3: 3 ocupados -> NO se fragmenta
select is(public.se_levanto((select ka from _k), (select te from _t)), '{"success":true,"ocupados":2,"fragmentada":false}'::jsonb, 'fila con 3 ocupados + se_levanto -> fragmentada false');
select is((select fragmentada from public.fila where id = (select f3 from _t)), false, 'fila con 3 ocupados no se fragmenta');
select is(
  (select (detalle->>'fragmenta')::boolean from public.registro where evento_id = (select ea from _k) and tipo = 'se_levanto' order by id desc limit 1),
  false, 'el registro de la fila de 3 tiene fragmenta = false');

-- Fila 1: 4 ocupados repartidos en dos tramos públicos (reservado en el medio) -> cuenta la fila entera
select is(public.se_levanto((select ka from _k), (select ta from _t)), '{"success":true,"ocupados":1,"fragmentada":true}'::jsonb, 'fila con 4 ocupados en DOS tramos públicos + se_levanto -> fragmentada true');
select is((select ocupados from public.tramo where id = (select ta from _t)), 1, 'baja sólo el tramo indicado');
select is((select ocupados from public.tramo where id = (select tc from _t)), 2, 'el otro tramo público de la fila no cambia');
select is((select fragmentada from public.fila where id = (select f1 from _t)), true, 'la fila 1 quedó fragmentada');

-- Errores (no cambian nada)
select is(public.se_levanto((select ka from _k), (select td1 from _t)), '{"success":false,"error":"TRAMO_VACIO"}'::jsonb, 'se_levanto en tramo con 0 -> TRAMO_VACIO');
select is((select ocupados from public.tramo where id = (select td1 from _t)), 0, 'TRAMO_VACIO no deja ocupados negativos');
select is(public.se_levanto((select ka from _k), (select tr from _t)), '{"success":false,"error":"TRAMO_RESERVADO"}'::jsonb, 'se_levanto en tramo reservado (con 0) -> TRAMO_RESERVADO (gana a TRAMO_VACIO)');
select is(public.se_levanto((select ka from _k), -1), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'tramo inexistente -> TRAMO_INEXISTENTE');
select is(public.se_levanto((select ka from _k), null), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'tramo NULL -> TRAMO_INEXISTENTE');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'se_levanto'), 4, 'los errores de se_levanto no escriben registros');
select is((select fragmentada from public.fila where id = (select fd1 from _t)), false, 'TRAMO_VACIO no fragmenta la fila');

-- ---------------------------------------------------------------------------
-- Aislamiento entre eventos: la entidad de otro evento es inexistente y no se toca
-- ---------------------------------------------------------------------------
select is(public.se_levanto((select kb from _k), (select tc from _t)), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'B no puede usar se_levanto sobre un tramo de A');
select is(public.corregir_conteo((select kb from _k), (select tc from _t), 0), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'B no puede usar corregir_conteo sobre un tramo de A');
select is(public.juntar_fila((select kb from _k), (select f2 from _t)), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'B no puede usar juntar_fila sobre una fila de A');
select is(public.verificar_fila((select kb from _k), (select f1 from _t)), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'B no puede usar verificar_fila sobre una fila de A');
select is((select ocupados from public.tramo where id = (select tc from _t)), 2, 'el tramo de A no se tocó');
select is((select fragmentada from public.fila where id = (select f2 from _t)), true, 'la fila 2 de A sigue fragmentada (juntar_fila de B no la tocó)');
select is((select verificada_en is null from public.fila where id = (select f1 from _t)), true, 'la fila 1 de A sigue sin verificar');

select is(public.se_levanto((select ka from _k), (select tb from _t)), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'A no puede usar se_levanto sobre un tramo de B');
select is(public.corregir_conteo((select ka from _k), (select tb from _t), 0), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'A no puede usar corregir_conteo sobre un tramo de B');
select is(public.juntar_fila((select ka from _k), (select fb from _t)), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'A no puede usar juntar_fila sobre una fila de B');
select is(public.verificar_fila((select ka from _k), (select fb from _t)), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'A no puede usar verificar_fila sobre una fila de B');
select is((select ocupados from public.tramo where id = (select tb from _t)), 2, 'el tramo de B no se tocó');
select results_eq(
  $$select fragmentada, verificada_en is null from public.fila where id = (select fb from _t)$$,
  $$values (false, true)$$, 'la fila de B no se tocó (ni fragmentada ni verificada)');
select is((select count(*)::int from public.registro where evento_id = (select eb from _k)), 0, 'ningún intento cruzado escribió registros en B');

-- ---------------------------------------------------------------------------
-- corregir_conteo
-- ---------------------------------------------------------------------------
-- Fila 4: 4 ocupados (de 8). Ver 3 libres -> 5 ocupados. NO toca fragmentada (ni la enciende).
select is(public.corregir_conteo((select ka from _k), (select tf from _t), 3), '{"success":true,"ocupados":5}'::jsonb, 'corregir_conteo con 3 libres de 8 -> ocupados 5');
select is((select ocupados from public.tramo where id = (select tf from _t)), 5, 'ocupados = capacidad - libres vistos');
select is((select fragmentada from public.fila where id = (select f4 from _t)), false, 'corregir_conteo en una fila de 4 ocupados no cambia fragmentada');
select is((select verificada_en is not null from public.fila where id = (select f4 from _t)), true, 'corregir_conteo marca la fila como verificada');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'correccion'), 1, 'corregir_conteo escribe un registro correccion');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'correccion')) k),
  array['antes', 'despues', 'fila_id', 'libres_vistos', 'tramo_id'], 'el registro correccion tiene tramo_id, fila_id, antes, despues y libres_vistos');
select results_eq(
  $$select (detalle->>'tramo_id')::bigint, (detalle->>'fila_id')::bigint, (detalle->>'antes')::int, (detalle->>'despues')::int, (detalle->>'libres_vistos')::int
      from public.registro where evento_id = (select ea from _k) and tipo = 'correccion'$$,
  $$select tf, f4, 4, 5, 3 from _t$$, 'el detalle de correccion registra antes 4, despues 5, libres_vistos 3');

-- Fila 2 fragmentada: la corrección no la apaga
select is(public.corregir_conteo((select ka from _k), (select td from _t), 8), '{"success":true,"ocupados":0}'::jsonb, 'libres = capacidad -> ocupados 0 (límite inferior válido)');
select is((select fragmentada from public.fila where id = (select f2 from _t)), true, 'corregir_conteo no apaga fragmentada');
select is(public.corregir_conteo((select ka from _k), (select te from _t), 0), '{"success":true,"ocupados":8}'::jsonb, 'libres = 0 -> ocupados = capacidad (límite superior válido)');

-- Rango inválido (ta: capacidad 3, 1 ocupado, fila 1 sin verificar)
select is(public.corregir_conteo((select ka from _k), (select ta from _t), 4), '{"success":false,"error":"RANGO_INVALIDO"}'::jsonb, 'p_libres_vistos = capacidad + 1 -> RANGO_INVALIDO');
select is(public.corregir_conteo((select ka from _k), (select ta from _t), -1), '{"success":false,"error":"RANGO_INVALIDO"}'::jsonb, 'p_libres_vistos = -1 -> RANGO_INVALIDO');
select is(public.corregir_conteo((select ka from _k), (select ta from _t), null), '{"success":false,"error":"RANGO_INVALIDO"}'::jsonb, 'p_libres_vistos NULL -> RANGO_INVALIDO');
select is((select ocupados from public.tramo where id = (select ta from _t)), 1, 'RANGO_INVALIDO no cambia ocupados');
select is((select verificada_en is null from public.fila where id = (select f1 from _t)), true, 'RANGO_INVALIDO no marca la fila como verificada');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'correccion'), 3, 'los errores no escriben registros correccion');

-- Reservado (no se cuenta) e inexistente
select is(public.corregir_conteo((select ka from _k), (select tr from _t), 0), '{"success":false,"error":"TRAMO_RESERVADO"}'::jsonb, 'corregir_conteo en tramo reservado -> TRAMO_RESERVADO');
select is(public.corregir_conteo((select ka from _k), (select tr from _t), 99), '{"success":false,"error":"TRAMO_RESERVADO"}'::jsonb, 'precedencia: reservado gana a rango inválido');
select is((select ocupados from public.tramo where id = (select tr from _t)), 0, 'TRAMO_RESERVADO no cambia ocupados');
select is(public.corregir_conteo((select ka from _k), -1, 0), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'tramo inexistente -> TRAMO_INEXISTENTE');
select is(public.corregir_conteo((select ka from _k), null, null), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'precedencia: tramo NULL gana a libres NULL');

-- Corrección sin cambio de valor igual verifica la fila
select is(public.corregir_conteo((select ka from _k), (select ta from _t), 2), '{"success":true,"ocupados":1}'::jsonb, 'corregir al mismo valor (1 ocupado) -> success');
select is((select verificada_en is not null from public.fila where id = (select f1 from _t)), true, 'aunque el conteo no cambie, la fila queda verificada');

-- ---------------------------------------------------------------------------
-- juntar_fila
-- ---------------------------------------------------------------------------
select is(public.juntar_fila((select ka from _k), (select f2 from _t)), '{"success":true}'::jsonb, 'juntar_fila -> success');
select is((select fragmentada from public.fila where id = (select f2 from _t)), false, 'juntar_fila apaga la marca fragmentada');
select is((select fragmentada from public.fila where id = (select f1 from _t)), true, 'juntar_fila no toca otras filas');
select is((select ocupados from public.tramo where id = (select td from _t)), 0, 'juntar_fila no cambia ocupados');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'juntar'), 1, 'juntar_fila escribe un registro juntar');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'juntar')) k),
  array['fila_id'], 'el registro juntar tiene fila_id');
select is(public.juntar_fila((select ka from _k), (select f2 from _t)), '{"success":true}'::jsonb, 'juntar_fila es idempotente (ya estaba apagada) -> success');
select is((select fragmentada from public.fila where id = (select f2 from _t)), false, 'sigue apagada');
select is(public.juntar_fila((select ka from _k), -1), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'juntar_fila de fila inexistente -> FILA_INEXISTENTE');
select is(public.juntar_fila((select ka from _k), null), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'juntar_fila de fila NULL -> FILA_INEXISTENTE');

-- ---------------------------------------------------------------------------
-- verificar_fila
-- ---------------------------------------------------------------------------
insert into _v select 'reg_antes', null, (select count(*)::int from public.registro where evento_id = (select ea from _k));
select is(public.verificar_fila((select ka from _k), (select fd1 from _t)), '{"success":true}'::jsonb, 'verificar_fila -> success');
select is((select verificada_en is not null from public.fila where id = (select fd1 from _t)), true, 'verificar_fila fija verificada_en');
select results_eq(
  $$select fragmentada, (select ocupados from public.tramo where id = (select td1 from _t)) from public.fila where id = (select fd1 from _t)$$,
  $$values (false, 0)$$, 'verificar_fila no toca fragmentada ni ocupados');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k)), (select c from _v where n = 'reg_antes'), 'verificar_fila no escribe registro (alto volumen, poco valor)');
insert into _v select 'v1', verificada_en, null from public.fila where id = (select fd1 from _t);
select pg_sleep(0.02);
select public.verificar_fila((select ka from _k), (select fd1 from _t));
select ok((select verificada_en > (select v from _v where n = 'v1') from public.fila where id = (select fd1 from _t)), 'una segunda verificación avanza verificada_en');
select ok((select verificada_en <= clock_timestamp() from public.fila where id = (select fd1 from _t)), 'verificada_en usa el reloj real (clock_timestamp), no queda en el futuro');
select is(public.verificar_fila((select ka from _k), -1), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'verificar_fila de fila inexistente -> FILA_INEXISTENTE');
select is(public.verificar_fila((select ka from _k), null), '{"success":false,"error":"FILA_INEXISTENTE"}'::jsonb, 'verificar_fila de fila NULL -> FILA_INEXISTENTE');

-- ---------------------------------------------------------------------------
-- agregar_fila_al_fondo
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.fila where evento_id = (select ea from _k) and seccion = 'derecha'), 15, 'preparación: la sección derecha tiene las filas 1..15');
insert into _p select 'a16', public.agregar_fila_al_fondo((select ka from _k), 'derecha', 8);
select is((select r->>'success' from _p where n = 'a16'), 'true', 'agregar en sección con filas 1..15 -> success');
select is((select (r->>'numero')::int from _p where n = 'a16'), 16, 'devuelve numero 16');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select r from _p where n = 'a16')) k),
  array['fila_id', 'numero', 'success'], 'el éxito tiene success, fila_id y numero');
select results_eq(
  $$select f.evento_id = (select ea from _k), f.seccion, f.numero, f.fragmentada, f.verificada_en is null
      from public.fila f where f.id = (select (r->>'fila_id')::bigint from _p where n = 'a16')$$,
  $$values (true, 'derecha'::text, 16, false, true)$$, 'fila_id apunta a la fila 16 de derecha del evento A, sin fragmentar ni verificar');
select results_eq(
  $$select t.orden, t.tipo, t.capacidad, t.ocupados, t.etiqueta from public.tramo t where t.fila_id = (select (r->>'fila_id')::bigint from _p where n = 'a16')$$,
  $$values (1, 'publico'::text, 8, 0, null::text)$$, 'la fila nueva tiene un único tramo público (orden 1, capacidad 8, 0 ocupados, sin etiqueta)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'agregar_fila')) k),
  array['capacidad', 'fila_id', 'numero', 'seccion'], 'el registro agregar_fila tiene seccion, numero, fila_id y capacidad');

insert into _p select 'a17', public.agregar_fila_al_fondo((select ka from _k), 'derecha', 5);
select is((select (r->>'numero')::int from _p where n = 'a17'), 17, 'la siguiente es la 17');
select is((select t.capacidad from public.tramo t where t.fila_id = (select (r->>'fila_id')::bigint from _p where n = 'a17')), 5, 'respeta la capacidad pedida (5)');
insert into _p select 'a18', public.agregar_fila_al_fondo((select ka from _k), 'derecha');
select is((select (r->>'numero')::int from _p where n = 'a18'), 18, 'sin capacidad -> usa el valor por defecto y numero 18');
select is((select t.capacidad from public.tramo t where t.fila_id = (select (r->>'fila_id')::bigint from _p where n = 'a18')), 8, 'la capacidad por defecto es 8');

-- Sección vacía -> numero 1 (B no tiene filas ni en izquierda ni en derecha)
select is(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
      and ((classid::bigint << 32) | objid::bigint) = hashtextextended((select eb from _k)::text || 'derecha', 0)),
  0, 'antes de agregar en B/derecha no se tomó su advisory lock');
insert into _p select 'b1', public.agregar_fila_al_fondo((select kb from _k), 'izquierda', 8);
insert into _p select 'b2', public.agregar_fila_al_fondo((select kb from _k), 'derecha', 1000);
insert into _p select 'b3', public.agregar_fila_al_fondo((select kb from _k), 'derecha', 1);
select is((select (r->>'numero')::int from _p where n = 'b1'), 1, 'en una sección vacía crea la fila 1');
select is((select (r->>'numero')::int from _p where n = 'b2'), 1, 'B/derecha vacía: capacidad 1000 (límite superior) crea la fila 1');
select is((select (r->>'numero')::int from _p where n = 'b3'), 2, 'capacidad 1 (límite inferior) crea la fila 2');
select is(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
      and ((classid::bigint << 32) | objid::bigint) = hashtextextended((select eb from _k)::text || 'derecha', 0)),
  1, 'agregar_fila_al_fondo tomó el advisory lock de la sección (evento || sección)');
select is((select count(*)::int from public.fila where evento_id = (select ea from _k) and seccion = 'izquierda'), 1, 'agregar en B no crea filas en A');

-- Validaciones (no crean filas)
select is((select count(*)::int from public.fila where evento_id = (select ea from _k)), 1 + 5 + 18, 'preparación: A tiene 24 filas (1 izquierda + 5 centro + 18 derecha)');
select is(public.agregar_fila_al_fondo((select ka from _k), 'fondo', 8), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección desconocida -> SECCION_INVALIDA');
select is(public.agregar_fila_al_fondo((select ka from _k), null, 8), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección NULL -> SECCION_INVALIDA');
select is(public.agregar_fila_al_fondo((select ka from _k), 'fondo', 0), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección y capacidad inválidas: gana SECCION_INVALIDA');
select is(public.agregar_fila_al_fondo((select ka from _k), 'centro', 0), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad 0 -> CAPACIDAD_INVALIDA');
select is(public.agregar_fila_al_fondo((select ka from _k), 'centro', -5), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad negativa -> CAPACIDAD_INVALIDA');
select is(public.agregar_fila_al_fondo((select ka from _k), 'centro', 1001), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad 1001 -> CAPACIDAD_INVALIDA');
select is(public.agregar_fila_al_fondo((select ka from _k), 'centro', null), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad NULL explícita -> CAPACIDAD_INVALIDA');
select is((select count(*)::int from public.fila where evento_id = (select ea from _k)), 24, 'los argumentos inválidos no crean filas');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'agregar_fila'), 3, 'sólo los tres agregados exitosos de A escribieron registro');

-- ---------------------------------------------------------------------------
-- Clave de supervisor aceptada en las cinco funciones (fila 5: [pub 4], 2 ocupados)
-- ---------------------------------------------------------------------------
select is(public.se_levanto((select sa from _k), (select tg from _t)), '{"success":true,"ocupados":1,"fragmentada":false}'::jsonb, 'supervisor: se_levanto');
select is(public.corregir_conteo((select sa from _k), (select tg from _t), 1), '{"success":true,"ocupados":3}'::jsonb, 'supervisor: corregir_conteo');
select is(public.verificar_fila((select sa from _k), (select f5 from _t)), '{"success":true}'::jsonb, 'supervisor: verificar_fila');
select is(public.juntar_fila((select sa from _k), (select f5 from _t)), '{"success":true}'::jsonb, 'supervisor: juntar_fila');
select is((public.agregar_fila_al_fondo((select sa from _k), 'derecha', 2))->>'numero', '19', 'supervisor: agregar_fila_al_fondo (numero 19)');

-- ---------------------------------------------------------------------------
-- Integración con mandar_grupo / sentar_pendiente (izquierda de A: [pub 2] con 2 ocupados)
-- ---------------------------------------------------------------------------
select is(public.mandar_grupo((select ka from _k), 'izquierda', 1), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'sección izquierda llena: libres 0');
select is(public.se_levanto((select ka from _k), (select ti from _t)), '{"success":true,"ocupados":1,"fragmentada":false}'::jsonb, 'alguien se levanta en la izquierda');
select is(public.mandar_grupo((select ka from _k), 'izquierda', 20), '{"success":false,"error":"SECCION_SIN_CUPO","libres":1}'::jsonb, 'tras se_levanto, libres sube en 1');
insert into _p select 'g', public.mandar_grupo((select ka from _k), 'izquierda', 1);
select is((select r->>'success' from _p where n = 'g'), 'true', 'el asiento liberado se puede mandar');
select is(public.mandar_grupo((select ka from _k), 'izquierda', 1), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'y no se puede mandar dos veces el mismo asiento');
select is(public.sentar_pendiente((select ka from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'g'), (select ti from _t)), '{"success":true}'::jsonb, 'el grupo se sienta en el tramo liberado');
select is((select ocupados from public.tramo where id = (select ti from _t)), 2, 'el tramo vuelve a estar lleno (2/2)');
select is(public.corregir_conteo((select ka from _k), (select ti from _t), 2), '{"success":true,"ocupados":0}'::jsonb, 'el ujier ve el tramo vacío y corrige');
select is(public.mandar_grupo((select ka from _k), 'izquierda', 20), '{"success":false,"error":"SECCION_SIN_CUPO","libres":2}'::jsonb, 'tras corregir_conteo, libres refleja los 2 asientos');
select is((public.agregar_fila_al_fondo((select ka from _k), 'izquierda', 3))->>'numero', '2', 'agregar fila en izquierda -> numero 2');
select is(public.mandar_grupo((select ka from _k), 'izquierda', 20), '{"success":false,"error":"SECCION_SIN_CUPO","libres":5}'::jsonb, 'la fila nueva suma sus 3 asientos a libres');

-- ---------------------------------------------------------------------------
-- Funciona como anon (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
set local role anon;
select is(public.verificar_fila((select ka from _k), (select f1 from _t)), '{"success":true}'::jsonb, 'anon puede llamar verificar_fila');
select is(public.se_levanto((select ka from _k), (select ta from _t)), '{"success":true,"ocupados":0,"fragmentada":true}'::jsonb, 'anon puede llamar se_levanto');
select throws_ok($$select public.agregar_fila_al_fondo('clave-mala', 'centro', 8)$$, null, 'CLAVE_INVALIDA', 'anon con clave inválida: CLAVE_INVALIDA');
reset role;

select * from finish();
rollback;

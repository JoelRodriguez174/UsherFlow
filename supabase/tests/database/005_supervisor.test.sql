-- Task 9 (Etapa 1): RPC de supervisor (reiniciar_salon, aplicar_plantilla, regenerar_claves,
-- modificar_capacidad_tramo, obtener_claves).
-- Todas exigen la clave de SUPERVISOR (private.evento_de_clave(p_clave, true)): una clave de ujier o
-- cualquier otra se rechaza con CLAVE_INVALIDA, antes de mirar los demás argumentos.
-- Orden de validación (documentado y probado):
--   reiniciar_salon:          clave -> sección
--   aplicar_plantilla:        clave -> plantilla vacía / no objeto (antes de borrar nada) -> plantilla inválida
--   regenerar_claves:         clave
--   obtener_claves:           clave
--   modificar_capacidad_tramo: clave -> tramo existe (de este evento) -> capacidad (entero 1..1000)
-- Nota: el literal de PLANTILLA_EJEMPLO (sección "contrato con el cliente") se generó ejecutando
-- src/config/plantilla.ts con Node (JSON.stringify) y se incrustó sin editar.
begin;
select plan(195);

-- Funciones auxiliares (sólo viven en esta sesión de prueba)
create function pg_temp.tid(p_evento uuid, p_seccion text, p_numero integer, p_orden integer default 1)
returns bigint language sql as $$
  select t.id from public.tramo t join public.fila f on f.id = t.fila_id
   where f.evento_id = p_evento and f.seccion = p_seccion and f.numero = p_numero and t.orden = p_orden
$$;
create function pg_temp.fid(p_evento uuid, p_seccion text, p_numero integer)
returns bigint language sql as $$
  select f.id from public.fila f
   where f.evento_id = p_evento and f.seccion = p_seccion and f.numero = p_numero
$$;
-- Cuántas veces ESTA sesión tiene tomado el advisory lock de (evento, sección): 0 o 1 (una fila en pg_locks).
create function pg_temp.nlocks(p_evento uuid, p_seccion text)
returns integer language sql as $$
  select count(*)::int from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid()
     and ((classid::bigint << 32) | objid::bigint) = hashtextextended(p_evento::text || p_seccion, 0)
$$;

-- ---------------------------------------------------------------------------
-- Estructura y privilegios
-- ---------------------------------------------------------------------------
select has_function('public', 'reiniciar_salon', array['text', 'text'], 'existe public.reiniciar_salon(text, text)');
select has_function('public', 'aplicar_plantilla', array['text', 'jsonb'], 'existe public.aplicar_plantilla(text, jsonb)');
select has_function('public', 'regenerar_claves', array['text'], 'existe public.regenerar_claves(text)');
select has_function('public', 'modificar_capacidad_tramo', array['text', 'bigint', 'integer'], 'existe public.modificar_capacidad_tramo(text, bigint, integer)');
select has_function('public', 'obtener_claves', array['text'], 'existe public.obtener_claves(text)');

select is_definer('public', 'reiniciar_salon', array['text', 'text'], 'reiniciar_salon es SECURITY DEFINER');
select is_definer('public', 'aplicar_plantilla', array['text', 'jsonb'], 'aplicar_plantilla es SECURITY DEFINER');
select is_definer('public', 'regenerar_claves', array['text'], 'regenerar_claves es SECURITY DEFINER');
select is_definer('public', 'modificar_capacidad_tramo', array['text', 'bigint', 'integer'], 'modificar_capacidad_tramo es SECURITY DEFINER');
select is_definer('public', 'obtener_claves', array['text'], 'obtener_claves es SECURITY DEFINER');

select function_returns('public', 'reiniciar_salon', array['text', 'text'], 'jsonb', 'reiniciar_salon devuelve jsonb');
select function_returns('public', 'aplicar_plantilla', array['text', 'jsonb'], 'jsonb', 'aplicar_plantilla devuelve jsonb');
select function_returns('public', 'regenerar_claves', array['text'], 'jsonb', 'regenerar_claves devuelve jsonb');
select function_returns('public', 'modificar_capacidad_tramo', array['text', 'bigint', 'integer'], 'jsonb', 'modificar_capacidad_tramo devuelve jsonb');
select function_returns('public', 'obtener_claves', array['text'], 'jsonb', 'obtener_claves devuelve jsonb');

select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.reiniciar_salon(text,text)'::regprocedure,
                    'public.aplicar_plantilla(text,jsonb)'::regprocedure,
                    'public.regenerar_claves(text)'::regprocedure,
                    'public.modificar_capacidad_tramo(text,bigint,integer)'::regprocedure,
                    'public.obtener_claves(text)'::regprocedure)
      and p.proconfig = array['search_path=""']),
  5,
  'las cinco funciones fijan search_path = ''''');

select ok(has_function_privilege('anon', 'public.reiniciar_salon(text,text)', 'EXECUTE'), 'anon puede ejecutar reiniciar_salon');
select ok(has_function_privilege('anon', 'public.aplicar_plantilla(text,jsonb)', 'EXECUTE'), 'anon puede ejecutar aplicar_plantilla');
select ok(has_function_privilege('anon', 'public.regenerar_claves(text)', 'EXECUTE'), 'anon puede ejecutar regenerar_claves');
select ok(has_function_privilege('anon', 'public.modificar_capacidad_tramo(text,bigint,integer)', 'EXECUTE'), 'anon puede ejecutar modificar_capacidad_tramo');
select ok(has_function_privilege('anon', 'public.obtener_claves(text)', 'EXECUTE'), 'anon puede ejecutar obtener_claves');
select ok(has_function_privilege('authenticated', 'public.reiniciar_salon(text,text)', 'EXECUTE'), 'authenticated puede ejecutar reiniciar_salon');
select ok(has_function_privilege('authenticated', 'public.aplicar_plantilla(text,jsonb)', 'EXECUTE'), 'authenticated puede ejecutar aplicar_plantilla');
select ok(has_function_privilege('authenticated', 'public.regenerar_claves(text)', 'EXECUTE'), 'authenticated puede ejecutar regenerar_claves');
select ok(has_function_privilege('authenticated', 'public.modificar_capacidad_tramo(text,bigint,integer)', 'EXECUTE'), 'authenticated puede ejecutar modificar_capacidad_tramo');
select ok(has_function_privilege('authenticated', 'public.obtener_claves(text)', 'EXECUTE'), 'authenticated puede ejecutar obtener_claves');
select ok(
  not exists (
    select 1
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid in ('public.reiniciar_salon(text,text)'::regprocedure,
                     'public.aplicar_plantilla(text,jsonb)'::regprocedure,
                     'public.regenerar_claves(text)'::regprocedure,
                     'public.modificar_capacidad_tramo(text,bigint,integer)'::regprocedure,
                     'public.obtener_claves(text)'::regprocedure)
       and a.grantee = 0),
  'PUBLIC no tiene EXECUTE sobre ninguna de las cinco funciones');

-- ---------------------------------------------------------------------------
-- Datos de prueba
--   Evento A  izquierda fila 1: [pub 4 (ia) ocup 3][res 2 "Mamás" (ir)][pub 4 (ic) ocup 2]
--                       fila 2: [pub 8 (i2) ocup 8]
--             centro    fila 1: [res 8 "Pastores" (cr)]
--                       fila 2: [pub 8 (c2) ocup 8]
--                       fila 3: [pub 6 (c3) ocup 4]
--             derecha   fila 1: [pub 5 (d1) ocup 2]
--             marcas: fragmentada+verificada en izq 1, der 1; fragmentada en centro 2;
--                     verificada en izq 2 y centro 3
--             pendientes: a1 izq(2) a2 centro(1) a3 derecha(3) 'pendiente'; a4 centro 'sentado'; a5 derecha 'cancelado'
--   Evento B  centro fila 1: [pub 4 (tb) ocup 2]  derecha fila 1: [pub 3 (tbd) ocup 1]; un pendiente
--   Evento R  izquierda fila 1: [pub 4]  centro fila 1: [pub 4]   (para regenerar_claves)
-- ---------------------------------------------------------------------------
create temp table _r as
  select public.crear_evento('Supervisor A') as a, public.crear_evento('Supervisor B') as b, public.crear_evento('Supervisor R') as r;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ka, a->>'clave_supervisor' as sa,
         (b->>'evento_id')::uuid as eb, b->>'clave_ujier' as kb, b->>'clave_supervisor' as sb,
         (r->>'evento_id')::uuid as er, r->>'clave_ujier' as kr, r->>'clave_supervisor' as sr
    from _r;
grant select on _k to anon, authenticated;

select private.aplicar_plantilla(
  (select ea from _k),
  $j${"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":4}]},
                   {"numero":2,"tramos":[{"tipo":"publico","capacidad":8}]}],
      "centro":[{"numero":1,"tramos":[{"tipo":"reservado","capacidad":8,"etiqueta":"Pastores"}]},
                {"numero":2,"tramos":[{"tipo":"publico","capacidad":8}]},
                {"numero":3,"tramos":[{"tipo":"publico","capacidad":6}]}],
      "derecha":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":5}]}]}$j$::jsonb);
select private.aplicar_plantilla(
  (select eb from _k),
  $j${"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}],
      "derecha":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":3}]}]}$j$::jsonb);
select private.aplicar_plantilla(
  (select er from _k),
  $j${"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}],
      "centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}]}$j$::jsonb);

create temp table _t as
  select
    pg_temp.tid(ea, 'izquierda', 1, 1) as ia,
    pg_temp.tid(ea, 'izquierda', 1, 2) as ir,
    pg_temp.tid(ea, 'izquierda', 1, 3) as ic,
    pg_temp.tid(ea, 'izquierda', 2) as i2,
    pg_temp.tid(ea, 'centro', 1) as cr,
    pg_temp.tid(ea, 'centro', 2) as c2,
    pg_temp.tid(ea, 'centro', 3) as c3,
    pg_temp.tid(ea, 'derecha', 1) as d1,
    pg_temp.tid(eb, 'centro', 1) as tb,
    pg_temp.tid(eb, 'derecha', 1) as tbd,
    pg_temp.tid(er, 'centro', 1) as tr
  from _k;

update public.tramo set ocupados = 3 where id = (select ia from _t);
update public.tramo set ocupados = 2 where id = (select ic from _t);
update public.tramo set ocupados = 8 where id in ((select i2 from _t), (select c2 from _t));
update public.tramo set ocupados = 4 where id = (select c3 from _t);
update public.tramo set ocupados = 2 where id = (select d1 from _t);
update public.tramo set ocupados = 2 where id = (select tb from _t);
update public.tramo set ocupados = 1 where id = (select tbd from _t);

update public.fila set fragmentada = true, verificada_en = clock_timestamp()
 where id in (pg_temp.fid((select ea from _k), 'izquierda', 1), pg_temp.fid((select ea from _k), 'derecha', 1),
              pg_temp.fid((select eb from _k), 'centro', 1));
update public.fila set fragmentada = true where id = pg_temp.fid((select ea from _k), 'centro', 2);
update public.fila set verificada_en = clock_timestamp()
 where id in (pg_temp.fid((select ea from _k), 'izquierda', 2), pg_temp.fid((select ea from _k), 'centro', 3));

insert into public.pendiente (id, evento_id, seccion, cantidad, estado, resuelto_en) values
  ('00000000-0000-4000-8000-0000000000a1', (select ea from _k), 'izquierda', 2, 'pendiente', null),
  ('00000000-0000-4000-8000-0000000000a2', (select ea from _k), 'centro', 1, 'pendiente', null),
  ('00000000-0000-4000-8000-0000000000a3', (select ea from _k), 'derecha', 3, 'pendiente', null),
  ('00000000-0000-4000-8000-0000000000a4', (select ea from _k), 'centro', 2, 'sentado', '2026-01-01 10:00:00+00'),
  ('00000000-0000-4000-8000-0000000000a5', (select ea from _k), 'derecha', 1, 'cancelado', '2026-01-02 10:00:00+00'),
  ('00000000-0000-4000-8000-0000000000b1', (select eb from _k), 'centro', 1, 'pendiente', null);

-- Fotos del estado de A y B (sin server_now) para comprobar "no cambió nada"
create temp table _est (n text primary key, e jsonb);
insert into _est values
  ('a0', public.obtener_estado_salon((select ka from _k)) - 'server_now'),
  ('b0', public.obtener_estado_salon((select kb from _k)) - 'server_now');

select is(jsonb_array_length((select e->'filas' from _est where n = 'a0')), 6, 'preparación: A tiene 6 filas');
select is(jsonb_array_length((select e->'pendientes' from _est where n = 'a0')), 3, 'preparación: A tiene 3 pendientes');

-- ---------------------------------------------------------------------------
-- Una clave de ujier (o cualquier otra) se rechaza en las CINCO funciones
-- ---------------------------------------------------------------------------
select throws_ok(format($f$select public.reiniciar_salon(%L)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'reiniciar_salon con clave de ujier lanza CLAVE_INVALIDA');
select throws_ok(format($f$select public.reiniciar_salon(%L, 'centro')$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'reiniciar_salon(sección) con clave de ujier lanza CLAVE_INVALIDA');
select throws_ok(format($f$select public.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":8}]}]}'::jsonb)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'aplicar_plantilla con clave de ujier lanza CLAVE_INVALIDA');
select throws_ok(format($f$select public.regenerar_claves(%L)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'regenerar_claves con clave de ujier lanza CLAVE_INVALIDA');
select throws_ok(format($f$select public.modificar_capacidad_tramo(%L, %s, 5)$f$, (select ka from _k), (select c2 from _t)), null, 'CLAVE_INVALIDA', 'modificar_capacidad_tramo con clave de ujier lanza CLAVE_INVALIDA');
select throws_ok(format($f$select public.obtener_claves(%L)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'obtener_claves con clave de ujier lanza CLAVE_INVALIDA');

select throws_ok($$select public.reiniciar_salon('clave-mala')$$, null, 'CLAVE_INVALIDA', 'reiniciar_salon con clave inexistente lanza CLAVE_INVALIDA');
select throws_ok($$select public.reiniciar_salon('clave-mala', 'fondo')$$, null, 'CLAVE_INVALIDA', 'reiniciar_salon: la clave se valida antes que la sección');
select throws_ok($$select public.aplicar_plantilla('clave-mala', '{}'::jsonb)$$, null, 'CLAVE_INVALIDA', 'aplicar_plantilla: la clave se valida antes que la plantilla');
select throws_ok($$select public.regenerar_claves('clave-mala')$$, null, 'CLAVE_INVALIDA', 'regenerar_claves con clave inexistente lanza CLAVE_INVALIDA');
select throws_ok($$select public.modificar_capacidad_tramo('clave-mala', -1, 0)$$, null, 'CLAVE_INVALIDA', 'modificar_capacidad_tramo: la clave se valida antes que los argumentos');
select throws_ok($$select public.obtener_claves('clave-mala')$$, null, 'CLAVE_INVALIDA', 'obtener_claves con clave inexistente lanza CLAVE_INVALIDA');

select throws_ok($$select public.reiniciar_salon(null)$$, null, 'CLAVE_INVALIDA', 'reiniciar_salon con clave NULL lanza CLAVE_INVALIDA');
select throws_ok($$select public.aplicar_plantilla(null, null)$$, null, 'CLAVE_INVALIDA', 'aplicar_plantilla con todo NULL lanza CLAVE_INVALIDA');
select throws_ok($$select public.regenerar_claves(null)$$, null, 'CLAVE_INVALIDA', 'regenerar_claves con clave NULL lanza CLAVE_INVALIDA');
select throws_ok($$select public.modificar_capacidad_tramo(null, null, null)$$, null, 'CLAVE_INVALIDA', 'modificar_capacidad_tramo con todo NULL lanza CLAVE_INVALIDA');
select throws_ok($$select public.obtener_claves('')$$, null, 'CLAVE_INVALIDA', 'obtener_claves con clave vacía lanza CLAVE_INVALIDA');

select throws_ok(format($f$select public.reiniciar_salon(%L)$f$, (select kb from _k)), null, 'CLAVE_INVALIDA', 'la clave de ujier de B tampoco sirve en reiniciar_salon');

select is(public.obtener_estado_salon((select ka from _k)) - 'server_now', (select e from _est where n = 'a0'), 'los rechazos por clave no cambiaron nada en A');
select is(
  (select array[clave_ujier, clave_supervisor] from public.acceso where evento_id = (select ea from _k)),
  (select array[ka, sa] from _k), 'los rechazos no rotaron las claves de A');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k)), 0, 'los rechazos no escribieron registros');

-- ---------------------------------------------------------------------------
-- obtener_claves
-- ---------------------------------------------------------------------------
select is(public.obtener_claves((select sa from _k)),
  (select jsonb_build_object('success', true, 'clave_ujier', ka, 'clave_supervisor', sa) from _k),
  'obtener_claves devuelve las claves vigentes de ujier y supervisor');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.obtener_claves((select sa from _k))) k),
  array['clave_supervisor', 'clave_ujier', 'success'], 'obtener_claves devuelve exactamente success, clave_ujier y clave_supervisor');
select is(public.obtener_claves((select sb from _k))->>'clave_ujier', (select kb from _k), 'obtener_claves devuelve las claves del evento de la clave usada (B)');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k)), 0, 'obtener_claves no escribe registro');

-- ---------------------------------------------------------------------------
-- modificar_capacidad_tramo
-- ---------------------------------------------------------------------------
select is(public.modificar_capacidad_tramo((select sa from _k), (select c2 from _t), 7),
  '{"success":true,"capacidad":7,"ocupados":7}'::jsonb, 'capacidad 8 -> 7 con 8 ocupados: success, ocupados 7');
select results_eq(
  $$select capacidad, ocupados from public.tramo where id = (select c2 from _t)$$,
  $$values (7, 7)$$, 'el tramo quedó con capacidad 7 y ocupados 7 (ocupados = least(ocupados, capacidad))');
select is(
  (select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'capacidad' order by id limit 1),
  (select jsonb_build_object('tramo_id', c2, 'antes', 8, 'despues', 7, 'ocupados_antes', 8, 'ocupados_despues', 7) from _t),
  'el registro capacidad tiene tramo_id, antes, despues, ocupados_antes y ocupados_despues');
select results_eq(
  $$select fragmentada, verificada_en is not null from public.fila where id = pg_temp.fid((select ea from _k), 'centro', 2)$$,
  $$values (true, false)$$, 'modificar_capacidad_tramo no toca fragmentada ni verificada_en de la fila');

select is(public.modificar_capacidad_tramo((select sa from _k), (select c2 from _t), 10),
  '{"success":true,"capacidad":10,"ocupados":7}'::jsonb, 'subir la capacidad no cambia ocupados');
select is(public.modificar_capacidad_tramo((select sa from _k), (select cr from _t), 6),
  '{"success":true,"capacidad":6,"ocupados":0}'::jsonb, 'también se puede cambiar la capacidad de un tramo reservado');
select results_eq(
  $$select tipo, capacidad, etiqueta from public.tramo where id = (select cr from _t)$$,
  $$values ('reservado'::text, 6, 'Pastores'::text)$$, 'el tramo reservado conserva tipo y etiqueta');
select is(public.modificar_capacidad_tramo((select sa from _k), (select d1 from _t), 1000),
  '{"success":true,"capacidad":1000,"ocupados":2}'::jsonb, 'capacidad 1000 (límite superior) es válida');
select is(public.modificar_capacidad_tramo((select sa from _k), (select d1 from _t), 1),
  '{"success":true,"capacidad":1,"ocupados":1}'::jsonb, 'capacidad 1 (límite inferior) es válida y recorta ocupados a 1');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'capacidad'), 5, 'cada cambio de capacidad exitoso escribe su registro');

select is(public.modificar_capacidad_tramo((select sa from _k), (select c3 from _t), 0), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad 0 -> CAPACIDAD_INVALIDA');
select is(public.modificar_capacidad_tramo((select sa from _k), (select c3 from _t), -3), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad negativa -> CAPACIDAD_INVALIDA');
select is(public.modificar_capacidad_tramo((select sa from _k), (select c3 from _t), 1001), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad 1001 -> CAPACIDAD_INVALIDA');
select is(public.modificar_capacidad_tramo((select sa from _k), (select c3 from _t), null), '{"success":false,"error":"CAPACIDAD_INVALIDA"}'::jsonb, 'capacidad NULL -> CAPACIDAD_INVALIDA');
select results_eq(
  $$select capacidad, ocupados from public.tramo where id = (select c3 from _t)$$,
  $$values (6, 4)$$, 'las capacidades inválidas no cambian el tramo');
select is(public.modificar_capacidad_tramo((select sa from _k), -1, 5), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'tramo inexistente -> TRAMO_INEXISTENTE');
select is(public.modificar_capacidad_tramo((select sa from _k), null, 5), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'tramo NULL -> TRAMO_INEXISTENTE');
select is(public.modificar_capacidad_tramo((select sa from _k), -1, 0), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'precedencia: tramo inexistente gana a capacidad inválida');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'capacidad'), 5, 'los errores no escriben registros');

-- Aislamiento entre eventos: el tramo de otro evento es inexistente y no se toca
select is(public.modificar_capacidad_tramo((select sb from _k), (select c3 from _t), 1), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'B no puede modificar la capacidad de un tramo de A');
select is(public.modificar_capacidad_tramo((select sa from _k), (select tb from _t), 1), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'A no puede modificar la capacidad de un tramo de B');
select results_eq(
  $$select capacidad, ocupados from public.tramo where id = (select tb from _t)$$,
  $$values (4, 2)$$, 'el tramo de B no se tocó');
select is(public.obtener_estado_salon((select kb from _k)) - 'server_now', (select e from _est where n = 'b0'), 'B no cambió');

-- ---------------------------------------------------------------------------
-- reiniciar_salon: por sección
--   Antes: centro tiene c2 ocup 7/10, c3 ocup 4/6 (cr reservado 6, ocup 0); 1 pendiente 'pendiente' (a2),
--   1 'sentado' (a4); fila 2 fragmentada, fila 3 verificada.
-- ---------------------------------------------------------------------------
create temp table _snap as
  select t.id, t.fila_id, t.orden, t.tipo, t.capacidad, t.etiqueta
    from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (select ea from _k);
create temp table _snapf as
  select f.id, f.seccion, f.numero from public.fila f where f.evento_id = (select ea from _k);
insert into _est values ('a1', public.obtener_estado_salon((select ka from _k)) - 'server_now');

select is(public.reiniciar_salon((select sa from _k), 'centro'),
  '{"success":true,"tramos_reiniciados":2,"pendientes_cancelados":1}'::jsonb, 'reiniciar_salon(centro) -> success con 2 tramos y 1 pendiente');
select results_eq(
  $$select t.id, t.capacidad, t.ocupados from public.tramo t join public.fila f on f.id = t.fila_id
     where f.evento_id = (select ea from _k) and f.seccion = 'centro' order by t.id$$,
  $$select id, capacidad, 0 from public.tramo where id in ((select cr from _t), (select c2 from _t), (select c3 from _t)) order by id$$,
  'centro: todos los ocupados en 0');
select results_eq(
  $$select t.id, t.capacidad from public.tramo t where t.id in ((select cr from _t), (select c2 from _t), (select c3 from _t)) order by t.id$$,
  $$select id, capacidad from _snap where id in ((select cr from _t), (select c2 from _t), (select c3 from _t)) order by id$$,
  'centro: las capacidades quedaron intactas');
select results_eq(
  $$select tipo, capacidad, etiqueta from public.tramo where id = (select cr from _t)$$,
  $$values ('reservado'::text, 6, 'Pastores'::text)$$, 'centro: el tramo reservado conserva tipo, capacidad y etiqueta');
select is(
  (select count(*)::int from public.fila where evento_id = (select ea from _k) and seccion = 'centro' and (fragmentada or verificada_en is not null)),
  0, 'centro: ninguna fila queda fragmentada ni verificada (reiniciar deja verificada_en en NULL)');
select results_eq(
  $$select estado, resuelto_en is not null from public.pendiente where id = '00000000-0000-4000-8000-0000000000a2'$$,
  $$values ('cancelado'::text, true)$$, 'centro: el pendiente quedó cancelado con resuelto_en');
select results_eq(
  $$select estado, resuelto_en from public.pendiente where id = '00000000-0000-4000-8000-0000000000a4'$$,
  $$values ('sentado'::text, '2026-01-01 10:00:00+00'::timestamptz)$$, 'centro: un pendiente ya sentado no se toca');
-- Las otras secciones no se tocaron
select results_eq(
  $$select t.ocupados from public.tramo t where t.id in ((select ia from _t), (select ic from _t), (select i2 from _t), (select d1 from _t)) order by t.ocupados desc$$,
  $$values (8), (3), (2), (1)$$, 'izquierda y derecha conservan sus ocupados');
select is(
  (select count(*)::int from public.fila where evento_id = (select ea from _k) and seccion = 'izquierda' and (fragmentada or verificada_en is not null)),
  2, 'izquierda conserva sus marcas de fila');
select is(
  (select count(*)::int from public.fila where evento_id = (select ea from _k) and seccion = 'derecha' and (fragmentada or verificada_en is not null)),
  1, 'derecha conserva sus marcas de fila');
select is(
  (select count(*)::int from public.pendiente where evento_id = (select ea from _k) and estado = 'pendiente'),
  2, 'los pendientes de izquierda y derecha siguen pendientes');
select is(
  (select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'reinicio' order by id limit 1),
  '{"seccion":"centro","tramos_reiniciados":2,"pendientes_cancelados":1}'::jsonb, 'registro reinicio: seccion, tramos_reiniciados y pendientes_cancelados');

-- Sección inválida: no cambia nada
insert into _est values ('a2', public.obtener_estado_salon((select ka from _k)) - 'server_now');
select is(public.reiniciar_salon((select sa from _k), 'fondo'), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección desconocida -> SECCION_INVALIDA');
select is(public.reiniciar_salon((select sa from _k), ''), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección vacía -> SECCION_INVALIDA');
select is(public.reiniciar_salon((select sa from _k), 'Centro'), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'la sección distingue mayúsculas -> SECCION_INVALIDA');
select is(public.obtener_estado_salon((select ka from _k)) - 'server_now', (select e from _est where n = 'a2'), 'SECCION_INVALIDA no cambió nada');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'reinicio'), 1, 'SECCION_INVALIDA no escribe registro');

-- ---------------------------------------------------------------------------
-- reiniciar_salon: todo el salón
--   Antes: ocupados > 0 en ia, ic, i2, d1 (4 tramos); pendientes 'pendiente': a1 (izq) y a3 (der).
-- ---------------------------------------------------------------------------
select is(public.reiniciar_salon((select sa from _k)),
  '{"success":true,"tramos_reiniciados":4,"pendientes_cancelados":2}'::jsonb, 'reiniciar_salon() -> success con 4 tramos y 2 pendientes');
select is(
  (select count(*)::int from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (select ea from _k) and t.ocupados <> 0),
  0, 'todos los ocupados del evento quedaron en 0');
select is(
  (select count(*)::int from ((select * from _snap except select t.id, t.fila_id, t.orden, t.tipo, t.capacidad, t.etiqueta from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (select ea from _k))
                              union all
                              (select t.id, t.fila_id, t.orden, t.tipo, t.capacidad, t.etiqueta from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (select ea from _k) except select * from _snap)) d),
  0, 'los tramos (ids, orden, tipo, capacidad y etiqueta) son exactamente los mismos: se conservan capacidades y reservas fijas');
select is(
  (select count(*)::int from ((select * from _snapf except select f.id, f.seccion, f.numero from public.fila f where f.evento_id = (select ea from _k))
                              union all
                              (select f.id, f.seccion, f.numero from public.fila f where f.evento_id = (select ea from _k) except select * from _snapf)) d),
  0, 'las filas son exactamente las mismas');
select results_eq(
  $$select tipo, capacidad, etiqueta from public.tramo where id in ((select ir from _t), (select cr from _t)) order by capacidad$$,
  $$values ('reservado'::text, 2, 'Mamás'::text), ('reservado'::text, 6, 'Pastores'::text)$$, 'los tramos reservados siguen con su etiqueta y capacidad');
select is(
  (select count(*)::int from public.fila where evento_id = (select ea from _k) and (fragmentada or verificada_en is not null)),
  0, 'ninguna fila queda fragmentada ni verificada');
select is((select count(*)::int from public.pendiente where evento_id = (select ea from _k) and estado = 'pendiente'), 0, 'no queda ningún pendiente');
select results_eq(
  $$select estado, resuelto_en is not null from public.pendiente where id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3') order by id$$,
  $$values ('cancelado'::text, true), ('cancelado'::text, true)$$, 'los pendientes quedaron cancelados con resuelto_en');
select results_eq(
  $$select id::text, estado, resuelto_en from public.pendiente where id in ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5') order by id$$,
  $$values ('00000000-0000-4000-8000-0000000000a4', 'sentado'::text, '2026-01-01 10:00:00+00'::timestamptz),
           ('00000000-0000-4000-8000-0000000000a5', 'cancelado'::text, '2026-01-02 10:00:00+00'::timestamptz)$$,
  'los pendientes ya resueltos conservan estado y resuelto_en');
select is((select count(*)::int from public.pendiente where evento_id = (select ea from _k)), 5, 'ningún pendiente se borró (queda el historial)');
select is(
  (select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'reinicio' order by id desc limit 1),
  '{"seccion":null,"tramos_reiniciados":4,"pendientes_cancelados":2}'::jsonb, 'registro reinicio (todo el salón): seccion null');
select is(public.obtener_estado_salon((select kb from _k)) - 'server_now', (select e from _est where n = 'b0'), 'reiniciar el salón de A no tocó a B');

-- Reiniciar un salón ya vacío es idempotente
select is(public.reiniciar_salon((select sa from _k)),
  '{"success":true,"tramos_reiniciados":0,"pendientes_cancelados":0}'::jsonb, 'reiniciar un salón ya reiniciado -> success con 0 y 0');

-- ---------------------------------------------------------------------------
-- aplicar_plantilla
-- ---------------------------------------------------------------------------
-- Estado previo para comprobar los rechazos y la cancelación de pendientes
update public.tramo set ocupados = 3 where id = (select c2 from _t);
update public.tramo set ocupados = 2 where id = (select ia from _t);
update public.fila set fragmentada = true, verificada_en = clock_timestamp() where id = pg_temp.fid((select ea from _k), 'centro', 2);
insert into public.pendiente (id, evento_id, seccion, cantidad) values
  ('00000000-0000-4000-8000-0000000000a6', (select ea from _k), 'izquierda', 2),
  ('00000000-0000-4000-8000-0000000000a7', (select ea from _k), 'centro', 1),
  ('00000000-0000-4000-8000-0000000000a8', (select ea from _k), 'derecha', 1);
insert into _est values ('g0', public.obtener_estado_salon((select ka from _k)) - 'server_now');

-- Plantilla vacía o que no es un objeto: se rechaza ANTES de borrar nada
select is(public.aplicar_plantilla((select sa from _k), '{}'::jsonb), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'plantilla {} (vacía) -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k), '{"centro":[]}'::jsonb), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'plantilla {"centro":[]} (cero filas) -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k), '{"izquierda":[],"centro":[],"derecha":[]}'::jsonb), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'las tres secciones vacías -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k), '{"centro":"x"}'::jsonb), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'sección que no es arreglo -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k), '[]'::jsonb), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'plantilla arreglo -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k), 'null'::jsonb), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'plantilla JSON null -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k), '"x"'::jsonb), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'plantilla texto -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k), null), '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'plantilla SQL NULL -> PLANTILLA_INVALIDA');
select is(public.obtener_estado_salon((select ka from _k)) - 'server_now', (select e from _est where n = 'g0'),
  'las plantillas vacías no borraron ni cancelaron nada (filas, tramos, ocupados y pendientes intactos)');

-- Plantillas inválidas que fallan DESPUÉS de insertar algo: rollback atómico, el salón queda como estaba
select is(public.aplicar_plantilla((select sa from _k),
    '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":9}]}],"derecha":[{"numero":1,"tramos":[{"tipo":"reservado","capacidad":4}]}]}'::jsonb),
  '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'reservado sin etiqueta (detectado tras insertar el centro) -> PLANTILLA_INVALIDA');
select is(public.obtener_estado_salon((select ka from _k)) - 'server_now', (select e from _est where n = 'g0'), 'rollback atómico: filas, tramos y pendientes intactos tras el reservado sin etiqueta');
select is(public.aplicar_plantilla((select sa from _k),
    '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":9}]},{"numero":1,"tramos":[{"tipo":"publico","capacidad":9}]}]}'::jsonb),
  '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'número de fila repetido -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k),
    '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":9}]}],"fondo":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":9}]}]}'::jsonb),
  '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'sección desconocida -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k),
    '{"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":0}]}]}'::jsonb),
  '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'capacidad 0 -> PLANTILLA_INVALIDA');
select is(public.aplicar_plantilla((select sa from _k),
    '{"izquierda":[{"numero":1,"tramos":[]}]}'::jsonb),
  '{"success":false,"error":"PLANTILLA_INVALIDA"}'::jsonb, 'fila sin tramos -> PLANTILLA_INVALIDA');
select is(public.obtener_estado_salon((select ka from _k)) - 'server_now', (select e from _est where n = 'g0'), 'ninguna plantilla inválida cambió el salón');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'plantilla'), 0, 'los rechazos no escriben registro plantilla');
select is(
  (select count(*)::int from ((select * from _snapf except select f.id, f.seccion, f.numero from public.fila f where f.evento_id = (select ea from _k))
                              union all
                              (select f.id, f.seccion, f.numero from public.fila f where f.evento_id = (select ea from _k) except select * from _snapf)) d),
  0, 'los ids de las filas son los mismos (no se borró y recreó nada)');

-- Plantilla válida: reemplaza TODO
select is(public.aplicar_plantilla((select sa from _k),
    $j${"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":6}]},
                     {"numero":2,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Madres"}]}],
        "centro":[{"numero":5,"tramos":[{"tipo":"publico","capacidad":8}]}]}$j$::jsonb),
  '{"success":true,"filas":3}'::jsonb, 'plantilla válida -> success con 3 filas');
select results_eq(
  $$select f.seccion, f.numero, t.orden, t.tipo, t.capacidad, t.ocupados, t.etiqueta
      from public.fila f join public.tramo t on t.fila_id = f.id
     where f.evento_id = (select ea from _k) order by f.seccion, f.numero, t.orden$$,
  $$values ('centro'::text, 5, 1, 'publico'::text, 8, 0, null::text),
           ('izquierda'::text, 1, 1, 'publico'::text, 6, 0, null::text),
           ('izquierda'::text, 2, 1, 'publico'::text, 3, 0, null::text),
           ('izquierda'::text, 2, 2, 'reservado'::text, 2, 0, 'Madres'::text)$$,
  'quedan exactamente las filas y tramos de la plantilla (y ninguna otra, derecha vacía)');
select is(
  (select count(*)::int from public.fila f join _snapf s on s.id = f.id),
  0, 'ninguna fila vieja sobrevive');
select is(
  (select count(*)::int from public.fila where evento_id = (select ea from _k) and (fragmentada or verificada_en is not null)),
  0, 'las filas nuevas nacen sin fragmentar ni verificar');
select is((select count(*)::int from public.pendiente where evento_id = (select ea from _k) and estado = 'pendiente'), 0, 'los pendientes quedaron cancelados');
select results_eq(
  $$select id::text, estado, resuelto_en is not null from public.pendiente
     where id in ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000a8') order by id$$,
  $$values ('00000000-0000-4000-8000-0000000000a6', 'cancelado'::text, true),
           ('00000000-0000-4000-8000-0000000000a7', 'cancelado'::text, true),
           ('00000000-0000-4000-8000-0000000000a8', 'cancelado'::text, true)$$,
  'los pendientes cancelados tienen resuelto_en');
select results_eq(
  $$select id::text, estado, resuelto_en from public.pendiente where id in ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5') order by id$$,
  $$values ('00000000-0000-4000-8000-0000000000a4', 'sentado'::text, '2026-01-01 10:00:00+00'::timestamptz),
           ('00000000-0000-4000-8000-0000000000a5', 'cancelado'::text, '2026-01-02 10:00:00+00'::timestamptz)$$,
  'los pendientes ya resueltos conservan estado y resuelto_en');
select is((select count(*)::int from public.pendiente where evento_id = (select ea from _k)), 8, 'ningún pendiente se borró');
select is(
  (select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'plantilla' order by id desc limit 1),
  '{"filas":3,"tramos":4}'::jsonb, 'registro plantilla: filas y tramos');
select is(jsonb_array_length(public.obtener_estado_salon((select ka from _k))->'filas'), 3, 'obtener_estado_salon ve las 3 filas nuevas');
select is(public.obtener_estado_salon((select kb from _k)) - 'server_now', (select e from _est where n = 'b0'), 'aplicar_plantilla en A no tocó a B');

-- Aplicar otra vez la misma plantilla (mismos seccion+numero) funciona: se borra antes de insertar
select is(public.aplicar_plantilla((select sa from _k),
    $j${"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":6}]},
                     {"numero":2,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Madres"}]}],
        "centro":[{"numero":5,"tramos":[{"tipo":"publico","capacidad":8}]}]}$j$::jsonb),
  '{"success":true,"filas":3}'::jsonb, 'aplicar la misma plantilla dos veces -> success (sin choque de unique)');

-- Contrato con el cliente: PLANTILLA_EJEMPLO de src/config/plantilla.ts (generada con Node, ver cabecera)
create temp table _pe (j jsonb);
insert into _pe values ($j${"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":2,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":3,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":3}]},{"numero":4,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":3}]},{"numero":5,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":3}]},{"numero":6,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":3}]},{"numero":7,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":8,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":9,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":10,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":11,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":12,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":13,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":14,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":15,"tramos":[{"tipo":"publico","capacidad":8}]}],"centro":[{"numero":1,"tramos":[{"tipo":"reservado","capacidad":8,"etiqueta":"Pastores"}]},{"numero":2,"tramos":[{"tipo":"reservado","capacidad":8,"etiqueta":"Pastores"}]},{"numero":3,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":4,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":5,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":6,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":7,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":8,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":9,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":10,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":11,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":12,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":13,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":14,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":15,"tramos":[{"tipo":"publico","capacidad":8}]}],"derecha":[{"numero":1,"tramos":[{"tipo":"reservado","capacidad":4,"etiqueta":"Alabanza"},{"tipo":"publico","capacidad":4}]},{"numero":2,"tramos":[{"tipo":"reservado","capacidad":4,"etiqueta":"Alabanza"},{"tipo":"publico","capacidad":4}]},{"numero":3,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":4,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":5,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":6,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":7,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":8,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":9,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":10,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":11,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":12,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":13,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":14,"tramos":[{"tipo":"publico","capacidad":8}]},{"numero":15,"tramos":[{"tipo":"publico","capacidad":8}]}]}$j$::jsonb);
select is(public.aplicar_plantilla((select sa from _k), (select j from _pe)), '{"success":true,"filas":45}'::jsonb, 'PLANTILLA_EJEMPLO del cliente es aceptada: 45 filas');
select results_eq(
  $$select f.seccion, count(distinct f.id)::int, count(t.id)::int,
           count(t.id) filter (where t.tipo = 'publico')::int, count(t.id) filter (where t.tipo = 'reservado')::int
      from public.fila f join public.tramo t on t.fila_id = f.id
     where f.evento_id = (select ea from _k) group by f.seccion order by f.seccion$$,
  $$values ('centro'::text, 15, 15, 13, 2), ('derecha'::text, 15, 17, 15, 2), ('izquierda'::text, 15, 23, 19, 4)$$,
  'PLANTILLA_EJEMPLO: 15 filas por sección y los tramos públicos/reservados esperados (55 tramos)');
select is(
  (select jsonb_object_agg(s.seccion, s.filas) from (
     select f.seccion,
            jsonb_agg(jsonb_build_object('numero', f.numero, 'tramos', (
              select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('tipo', t.tipo, 'capacidad', t.capacidad, 'etiqueta', t.etiqueta)) order by t.orden)
                from public.tramo t where t.fila_id = f.id)) order by f.numero) as filas
       from public.fila f where f.evento_id = (select ea from _k) group by f.seccion) s),
  (select j from _pe), 'el salón quedó idéntico a PLANTILLA_EJEMPLO (secciones, filas, tramos, tipos, capacidades y etiquetas)');
select is(
  (select array_agg(e order by e) from (select distinct etiqueta e from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (select ea from _k) and etiqueta is not null) x),
  array['Alabanza', 'Mamás', 'Pastores'], 'las etiquetas del ejemplo (Alabanza, Mamás, Pastores) llegaron intactas');
select is(
  (select detalle from public.registro where evento_id = (select ea from _k) and tipo = 'plantilla' order by id desc limit 1),
  '{"filas":45,"tramos":55}'::jsonb, 'registro plantilla de PLANTILLA_EJEMPLO: 45 filas y 55 tramos');

-- ---------------------------------------------------------------------------
-- regenerar_claves (evento R)
-- ---------------------------------------------------------------------------
create temp table _keys (v text);
insert into _keys select kr from _k union all select sr from _k;
create temp table _rot (n integer primary key, r jsonb);

select is((select rotada_en is null from public.acceso where evento_id = (select er from _k)), true, 'preparación: R nunca rotó sus claves');
insert into _rot select 1, public.regenerar_claves((select sr from _k));
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select r from _rot where n = 1)) k),
  array['clave_supervisor', 'clave_ujier', 'success'], 'regenerar_claves devuelve exactamente success, clave_ujier y clave_supervisor');
select is((select r->'success' from _rot where n = 1), 'true'::jsonb, 'regenerar_claves devuelve success true');
insert into _keys select r->>'clave_ujier' from _rot where n = 1 union all select r->>'clave_supervisor' from _rot where n = 1;
select ok((select r->>'clave_ujier' ~ '^[0-9a-f]{64}$' and r->>'clave_supervisor' ~ '^[0-9a-f]{64}$' from _rot where n = 1), 'las claves nuevas tienen el mismo formato que las de crear_evento (64 hex)');
select ok((select r->>'clave_ujier' <> r->>'clave_supervisor' from _rot where n = 1), 'las dos claves nuevas son distintas entre sí');
select ok((select r->>'clave_ujier' not in (kr, sr) and r->>'clave_supervisor' not in (kr, sr) from _rot, _k where n = 1), 'las dos claves nuevas son distintas de las anteriores');
select results_eq(
  $$select clave_ujier, clave_supervisor from public.acceso where evento_id = (select er from _k)$$,
  $$select r->>'clave_ujier', r->>'clave_supervisor' from _rot where n = 1$$, 'acceso guarda las claves nuevas');
select ok((select rotada_en is not null and rotada_en > now() and rotada_en <= clock_timestamp() from public.acceso where evento_id = (select er from _k)), 'rotada_en queda fijada con el reloj real');
select is((select detalle from public.registro where evento_id = (select er from _k) and tipo = 'regenerar_claves'), '{}'::jsonb, 'registro regenerar_claves con detalle vacío (nunca claves)');

select throws_ok(format($f$select public.obtener_estado_salon(%L)$f$, (select kr from _k)), null, 'CLAVE_INVALIDA', 'la clave de ujier vieja da CLAVE_INVALIDA en obtener_estado_salon');
select throws_ok(format($f$select public.obtener_estado_salon(%L)$f$, (select sr from _k)), null, 'CLAVE_INVALIDA', 'la clave de supervisor vieja da CLAVE_INVALIDA en obtener_estado_salon');
select throws_ok(format($f$select public.mandar_grupo(%L, 'centro', 1)$f$, (select kr from _k)), null, 'CLAVE_INVALIDA', 'la clave de ujier vieja da CLAVE_INVALIDA en mandar_grupo');
select throws_ok(format($f$select public.regenerar_claves(%L)$f$, (select sr from _k)), null, 'CLAVE_INVALIDA', 'la clave de supervisor vieja no puede volver a regenerar');
select throws_ok(format($f$select public.obtener_claves(%L)$f$, (select sr from _k)), null, 'CLAVE_INVALIDA', 'la clave de supervisor vieja no sirve en obtener_claves');
select throws_ok(format($f$select public.reiniciar_salon(%L)$f$, (select sr from _k)), null, 'CLAVE_INVALIDA', 'la clave de supervisor vieja no sirve en reiniciar_salon');
select throws_ok(format($f$select public.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":8}]}]}'::jsonb)$f$, (select sr from _k)), null, 'CLAVE_INVALIDA', 'la clave de supervisor vieja no sirve en aplicar_plantilla');
select throws_ok(format($f$select public.modificar_capacidad_tramo(%L, %s, 5)$f$, (select sr from _k), (select tr from _t)), null, 'CLAVE_INVALIDA', 'la clave de supervisor vieja no sirve en modificar_capacidad_tramo');

select is(jsonb_typeof(public.obtener_estado_salon((select r->>'clave_ujier' from _rot where n = 1))), 'object', 'la clave de ujier nueva funciona en obtener_estado_salon');
select is(jsonb_typeof(public.obtener_estado_salon((select r->>'clave_supervisor' from _rot where n = 1))), 'object', 'la clave de supervisor nueva funciona en obtener_estado_salon');
select is(public.obtener_claves((select r->>'clave_supervisor' from _rot where n = 1)), (select r from _rot where n = 1), 'obtener_claves con la clave nueva devuelve exactamente lo que devolvió regenerar_claves');
select throws_ok(format($f$select public.regenerar_claves(%L)$f$, (select r->>'clave_ujier' from _rot where n = 1)), null, 'CLAVE_INVALIDA', 'la clave de ujier nueva tampoco puede regenerar');
select is(
  (select array[clave_ujier, clave_supervisor] from public.acceso where evento_id = (select er from _k)),
  (select array[r->>'clave_ujier', r->>'clave_supervisor'] from _rot where n = 1), 'los rechazos no rotaron nada');
select is(jsonb_array_length(public.obtener_estado_salon((select r->>'clave_supervisor' from _rot where n = 1))->'filas'), 2, 'regenerar_claves no toca el salón');

-- Segunda rotación: las claves de la primera también dejan de servir
insert into _rot select 2, public.regenerar_claves((select r->>'clave_supervisor' from _rot where n = 1));
insert into _keys select r->>'clave_ujier' from _rot where n = 2 union all select r->>'clave_supervisor' from _rot where n = 2;
select ok((select count(distinct v) = 6 from _keys), 'tras dos rotaciones hay 6 claves distintas en total para R (2 originales + 2 + 2)');
select throws_ok(format($f$select public.obtener_estado_salon(%L)$f$, (select r->>'clave_supervisor' from _rot where n = 1)), null, 'CLAVE_INVALIDA', 'la clave de la primera rotación ya no sirve tras la segunda');
select is(jsonb_typeof(public.obtener_estado_salon((select r->>'clave_ujier' from _rot where n = 2))), 'object', 'la clave de ujier de la segunda rotación funciona');
select is((select count(*)::int from public.registro where evento_id = (select er from _k) and tipo = 'regenerar_claves'), 2, 'cada rotación escribe un registro');

-- Las claves de otros eventos no se tocan
select is(jsonb_typeof(public.obtener_estado_salon((select ka from _k))), 'object', 'las claves de A siguen sirviendo tras rotar las de R');
select is(public.obtener_claves((select sb from _k))->>'clave_supervisor', (select sb from _k), 'las claves de B siguen siendo las mismas');

-- ---------------------------------------------------------------------------
-- Ningún registro contiene claves
-- ---------------------------------------------------------------------------
insert into _keys select clave_ujier from public.acceso union all select clave_supervisor from public.acceso;
select is(
  (select count(*)::int from public.registro r join _keys k on position(k.v in r.detalle::text) > 0 or position(k.v in r.tipo) > 0),
  0, 'ningún registro (tipo ni detalle) contiene una clave, vieja o vigente');

-- ---------------------------------------------------------------------------
-- Locks: cada función toma los advisory locks de las secciones que toca (y sólo esos)
-- ---------------------------------------------------------------------------
create temp table _x (n text primary key, e uuid, ku text, ks text);
insert into _x
  select n, (r->>'evento_id')::uuid, r->>'clave_ujier', r->>'clave_supervisor'
    from (select 'x' as n, public.crear_evento('Locks X') as r
          union all select 'y', public.crear_evento('Locks Y')
          union all select 'w', public.crear_evento('Locks W')
          union all select 'z', public.crear_evento('Locks Z')) q;
select private.aplicar_plantilla(e, $j${"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}],
    "centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}],
    "derecha":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}]}$j$::jsonb) from _x;
insert into _keys select ku from _x union all select ks from _x;

-- X: obtener_claves y regenerar_claves no toman locks de sección
select is(
  (select pg_temp.nlocks(e, 'izquierda') + pg_temp.nlocks(e, 'centro') + pg_temp.nlocks(e, 'derecha') from _x where n = 'x'),
  0, 'preparación: X no tiene locks tomados');
select ok((public.obtener_claves((select ks from _x where n = 'x')))->>'success' = 'true', 'obtener_claves de X');
select is((select pg_temp.nlocks(e, 'izquierda') + pg_temp.nlocks(e, 'centro') + pg_temp.nlocks(e, 'derecha') from _x where n = 'x'),
  0, 'obtener_claves no toma ningún lock de sección');
create temp table _xr as select public.regenerar_claves((select ks from _x where n = 'x')) as r;
select is((select pg_temp.nlocks(e, 'izquierda') + pg_temp.nlocks(e, 'centro') + pg_temp.nlocks(e, 'derecha') from _x where n = 'x'),
  0, 'regenerar_claves no toma ningún lock de sección');
-- X: modificar_capacidad_tramo toma sólo el lock de la sección del tramo (centro)
select is(public.modificar_capacidad_tramo((select r->>'clave_supervisor' from _xr), pg_temp.tid((select e from _x where n = 'x'), 'centro', 1), 3)->>'success', 'true', 'modificar_capacidad_tramo en el centro de X');
select results_eq(
  $$select pg_temp.nlocks(e, 'izquierda'), pg_temp.nlocks(e, 'centro'), pg_temp.nlocks(e, 'derecha') from _x where n = 'x'$$,
  $$values (0, 1, 0)$$, 'modificar_capacidad_tramo toma sólo el lock de la sección del tramo');
-- X: reiniciar_salon con sección toma sólo ese lock
select is(public.reiniciar_salon((select r->>'clave_supervisor' from _xr), 'izquierda')->>'success', 'true', 'reiniciar_salon(izquierda) en X');
select results_eq(
  $$select pg_temp.nlocks(e, 'izquierda'), pg_temp.nlocks(e, 'centro'), pg_temp.nlocks(e, 'derecha') from _x where n = 'x'$$,
  $$values (1, 1, 0)$$, 'reiniciar_salon(izquierda) toma sólo el lock de izquierda (derecha sigue sin tomar)');
select is(public.reiniciar_salon((select r->>'clave_supervisor' from _xr), 'fondo')->>'error', 'SECCION_INVALIDA', 'reiniciar_salon(fondo) en X');
select is((select pg_temp.nlocks(e, 'derecha') from _x where n = 'x'), 0, 'una sección inválida no toma ningún lock');
-- W: reiniciar_salon sin sección toma las tres
select is((select pg_temp.nlocks(e, 'izquierda') + pg_temp.nlocks(e, 'centro') + pg_temp.nlocks(e, 'derecha') from _x where n = 'w'), 0, 'preparación: W no tiene locks tomados');
select is(public.reiniciar_salon((select ks from _x where n = 'w'))->>'success', 'true', 'reiniciar_salon() en W');
select results_eq(
  $$select pg_temp.nlocks(e, 'izquierda'), pg_temp.nlocks(e, 'centro'), pg_temp.nlocks(e, 'derecha') from _x where n = 'w'$$,
  $$values (1, 1, 1)$$, 'reiniciar_salon() toma los tres locks de sección');
-- Y: aplicar_plantilla toma las tres aunque la plantilla sólo toque una sección
select is(public.aplicar_plantilla((select ks from _x where n = 'y'), '{}'::jsonb)->>'error', 'PLANTILLA_INVALIDA', 'plantilla vacía en Y');
select is((select pg_temp.nlocks(e, 'izquierda') + pg_temp.nlocks(e, 'centro') + pg_temp.nlocks(e, 'derecha') from _x where n = 'y'), 0, 'la plantilla vacía se rechaza sin tomar locks');
select is(public.aplicar_plantilla((select ks from _x where n = 'y'), '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}]}'::jsonb)->>'success', 'true', 'aplicar_plantilla en Y');
select results_eq(
  $$select pg_temp.nlocks(e, 'izquierda'), pg_temp.nlocks(e, 'centro'), pg_temp.nlocks(e, 'derecha') from _x where n = 'y'$$,
  $$values (1, 1, 1)$$, 'aplicar_plantilla toma los tres locks de sección');
-- Z: una clave de ujier en las funciones de supervisor no toma ningún lock
select throws_ok(format($f$select public.reiniciar_salon(%L)$f$, (select ku from _x where n = 'z')), null, 'CLAVE_INVALIDA', 'reiniciar_salon con clave de ujier en Z');
select throws_ok(format($f$select public.modificar_capacidad_tramo(%L, %s, 3)$f$, (select ku from _x where n = 'z'), pg_temp.tid((select e from _x where n = 'z'), 'centro', 1)), null, 'CLAVE_INVALIDA', 'modificar_capacidad_tramo con clave de ujier en Z');
select is((select pg_temp.nlocks(e, 'izquierda') + pg_temp.nlocks(e, 'centro') + pg_temp.nlocks(e, 'derecha') from _x where n = 'z'), 0, 'rechazar por clave no toma locks');

-- ---------------------------------------------------------------------------
-- Funciona como anon (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
set local role anon;
select is(public.obtener_claves((select sb from _k))->>'clave_ujier', (select kb from _k), 'anon puede llamar obtener_claves');
select throws_ok($$select public.reiniciar_salon('clave-mala')$$, null, 'CLAVE_INVALIDA', 'anon con clave inválida: CLAVE_INVALIDA');
select throws_ok($$select * from public.acceso$$, '42501', null, 'anon sigue sin poder leer acceso directamente');
reset role;

select * from finish();
rollback;

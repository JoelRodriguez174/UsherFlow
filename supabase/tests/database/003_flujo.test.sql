-- Task 7 (Etapa 1): RPC del flujo Puerta -> Sección (mandar_grupo, sentar_pendiente, cancelar_pendiente).
-- Orden de validación (documentado y probado):
--   mandar_grupo:       clave -> sección -> cantidad -> cupo
--   sentar_pendiente:   clave -> pendiente -> tramo existe -> reservado -> sección -> capacidad
--   cancelar_pendiente: clave -> pendiente
begin;
select plan(117);

-- ---------------------------------------------------------------------------
-- Estructura y privilegios
-- ---------------------------------------------------------------------------
select has_function('public', 'mandar_grupo', array['text', 'text', 'integer', 'uuid'], 'existe public.mandar_grupo(text, text, integer, uuid)');
select has_function('public', 'sentar_pendiente', array['text', 'uuid', 'bigint'], 'existe public.sentar_pendiente(text, uuid, bigint)');
select has_function('public', 'cancelar_pendiente', array['text', 'uuid'], 'existe public.cancelar_pendiente(text, uuid)');

select is_definer('public', 'mandar_grupo', array['text', 'text', 'integer', 'uuid'], 'mandar_grupo es SECURITY DEFINER');
select is_definer('public', 'sentar_pendiente', array['text', 'uuid', 'bigint'], 'sentar_pendiente es SECURITY DEFINER');
select is_definer('public', 'cancelar_pendiente', array['text', 'uuid'], 'cancelar_pendiente es SECURITY DEFINER');

select function_returns('public', 'mandar_grupo', array['text', 'text', 'integer', 'uuid'], 'jsonb', 'mandar_grupo devuelve jsonb');
select function_returns('public', 'sentar_pendiente', array['text', 'uuid', 'bigint'], 'jsonb', 'sentar_pendiente devuelve jsonb');
select function_returns('public', 'cancelar_pendiente', array['text', 'uuid'], 'jsonb', 'cancelar_pendiente devuelve jsonb');

select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.mandar_grupo(text,text,integer,uuid)'::regprocedure,
                    'public.sentar_pendiente(text,uuid,bigint)'::regprocedure,
                    'public.cancelar_pendiente(text,uuid)'::regprocedure)
      and p.proconfig = array['search_path=""']),
  3,
  'las tres funciones fijan search_path = ''''');

select ok(has_function_privilege('anon', 'public.mandar_grupo(text,text,integer,uuid)', 'EXECUTE'), 'anon puede ejecutar mandar_grupo');
select ok(has_function_privilege('anon', 'public.sentar_pendiente(text,uuid,bigint)', 'EXECUTE'), 'anon puede ejecutar sentar_pendiente');
select ok(has_function_privilege('anon', 'public.cancelar_pendiente(text,uuid)', 'EXECUTE'), 'anon puede ejecutar cancelar_pendiente');
select ok(has_function_privilege('authenticated', 'public.mandar_grupo(text,text,integer,uuid)', 'EXECUTE'), 'authenticated puede ejecutar mandar_grupo');
select ok(has_function_privilege('authenticated', 'public.sentar_pendiente(text,uuid,bigint)', 'EXECUTE'), 'authenticated puede ejecutar sentar_pendiente');
select ok(has_function_privilege('authenticated', 'public.cancelar_pendiente(text,uuid)', 'EXECUTE'), 'authenticated puede ejecutar cancelar_pendiente');
select ok(
  not exists (
    select 1
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid in ('public.mandar_grupo(text,text,integer,uuid)'::regprocedure,
                     'public.sentar_pendiente(text,uuid,bigint)'::regprocedure,
                     'public.cancelar_pendiente(text,uuid)'::regprocedure)
       and a.grantee = 0),
  'PUBLIC no tiene EXECUTE sobre ninguna de las tres funciones');

-- ---------------------------------------------------------------------------
-- Datos de prueba
--   Evento A  centro   fila 1: [pub 4][res 2 "Mamás"][pub 2]   fila 2: [pub 2]   => 8 libres públicos
--             izquierda fila 1: [pub 3][res 1 "VIP"]           fila 2: [pub 2]
--   Evento B  centro   fila 1: [pub 3]
-- ---------------------------------------------------------------------------
create temp table _k as
  select public.crear_evento('Flujo A') as a, public.crear_evento('Flujo B') as b;
grant select on _k to anon, authenticated;

select private.aplicar_plantilla(
  (select (a->>'evento_id')::uuid from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":2}]},
              {"numero":2,"tramos":[{"tipo":"publico","capacidad":2}]}],
    "izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":1,"etiqueta":"VIP"}]},
                 {"numero":2,"tramos":[{"tipo":"publico","capacidad":2}]}]}'::jsonb);
select private.aplicar_plantilla(
  (select (b->>'evento_id')::uuid from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":3}]}]}'::jsonb);

-- ids de tramos/filas: tA=pub4, tR=reservado, tC=pub2 (fila 1), tD=pub2 (fila 2); iP=izq pub3, iR=izq reservado, iQ=izq fila 2 pub2
create temp table _t as
  select
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'centro' and f.numero = 1 and t.orden = 1) as ta,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'centro' and f.numero = 1 and t.orden = 2) as tr,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'centro' and f.numero = 1 and t.orden = 3) as tc,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'centro' and f.numero = 2 and t.orden = 1) as td,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'izquierda' and f.numero = 1 and t.orden = 1) as ip,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'izquierda' and f.numero = 1 and t.orden = 2) as ir,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'izquierda' and f.numero = 2 and t.orden = 1) as iq,
    (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (_k.b->>'evento_id')::uuid and f.seccion = 'centro' and f.numero = 1 and t.orden = 1) as tb,
    (select f.id from public.fila f where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'centro' and f.numero = 1) as f1,
    (select f.id from public.fila f where f.evento_id = (_k.a->>'evento_id')::uuid and f.seccion = 'centro' and f.numero = 2) as f2
  from _k;
grant select on _t to anon, authenticated;

create temp table _p (n text primary key, r jsonb);
grant select on _p to anon, authenticated;

select is(
  (select sum(greatest(t.capacidad - t.ocupados, 0))::int
     from public.tramo t join public.fila f on f.id = t.fila_id
    where f.evento_id = (select (a->>'evento_id')::uuid from _k) and f.seccion = 'centro' and t.tipo = 'publico'),
  8, 'preparación: la sección centro del evento A tiene exactamente 8 asientos públicos libres');

-- ---------------------------------------------------------------------------
-- Claves inválidas: se LANZA CLAVE_INVALIDA (no se devuelve)
-- ---------------------------------------------------------------------------
select throws_ok($$select public.mandar_grupo('clave-mala', 'centro', 1)$$, null, 'CLAVE_INVALIDA', 'mandar_grupo con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.mandar_grupo(null, 'centro', 1)$$, null, 'CLAVE_INVALIDA', 'mandar_grupo con clave NULL lanza CLAVE_INVALIDA');
select throws_ok($$select public.mandar_grupo('clave-mala', 'fondo', 0)$$, null, 'CLAVE_INVALIDA', 'la clave se valida antes que los argumentos');
select throws_ok(format($f$select public.sentar_pendiente('clave-mala', %L, 1)$f$, gen_random_uuid()), null, 'CLAVE_INVALIDA', 'sentar_pendiente con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.sentar_pendiente(null, null, null)$$, null, 'CLAVE_INVALIDA', 'sentar_pendiente con todo NULL lanza CLAVE_INVALIDA');
select throws_ok(format($f$select public.cancelar_pendiente('clave-mala', %L)$f$, gen_random_uuid()), null, 'CLAVE_INVALIDA', 'cancelar_pendiente con clave inválida lanza CLAVE_INVALIDA');
select throws_ok($$select public.cancelar_pendiente('', null)$$, null, 'CLAVE_INVALIDA', 'cancelar_pendiente con clave vacía lanza CLAVE_INVALIDA');

-- ---------------------------------------------------------------------------
-- Validación de argumentos (no crea pendientes)
-- ---------------------------------------------------------------------------
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 0), '{"success":false,"error":"CANTIDAD_INVALIDA"}'::jsonb, 'cantidad 0 -> CANTIDAD_INVALIDA');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 21), '{"success":false,"error":"CANTIDAD_INVALIDA"}'::jsonb, 'cantidad 21 -> CANTIDAD_INVALIDA');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', -3), '{"success":false,"error":"CANTIDAD_INVALIDA"}'::jsonb, 'cantidad negativa -> CANTIDAD_INVALIDA');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', null), '{"success":false,"error":"CANTIDAD_INVALIDA"}'::jsonb, 'cantidad NULL -> CANTIDAD_INVALIDA');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'fondo', 2), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección desconocida -> SECCION_INVALIDA');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), null, 2), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección NULL -> SECCION_INVALIDA');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'fondo', 0), '{"success":false,"error":"SECCION_INVALIDA"}'::jsonb, 'sección y cantidad inválidas: gana SECCION_INVALIDA (se valida primero)');
select is(
  (select count(*)::int from public.pendiente where evento_id = (select (a->>'evento_id')::uuid from _k)),
  0, 'los argumentos inválidos no crean pendientes');

-- cantidad 20 es válida (límite superior): sin cupo, pero no CANTIDAD_INVALIDA
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 20), '{"success":false,"error":"SECCION_SIN_CUPO","libres":8}'::jsonb, 'cantidad 20 es válida (límite) y devuelve SECCION_SIN_CUPO con libres = 8');

-- ---------------------------------------------------------------------------
-- Evento B primero: clave de supervisor aceptada y aislamiento entre eventos
-- ---------------------------------------------------------------------------
insert into _p select 'b1', public.mandar_grupo((select b->>'clave_ujier' from _k), 'centro', 2);
insert into _p select 'b2', public.mandar_grupo((select b->>'clave_supervisor' from _k), 'centro', 1);
select is((select r->>'success' from _p where n = 'b1'), 'true', 'B: clave de ujier manda un grupo de 2');
select is((select r->>'success' from _p where n = 'b2'), 'true', 'B: la clave de supervisor también manda grupos');
select is(public.mandar_grupo((select b->>'clave_ujier' from _k), 'centro', 1), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'B: sección agotada -> SECCION_SIN_CUPO libres 0');

-- ---------------------------------------------------------------------------
-- mandar_grupo en A (8 libres): 5 ok, 5 sin cupo, 3 ok  (los pendientes de B no cuentan)
-- ---------------------------------------------------------------------------
insert into _p select 'p1', public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 5);
select is((select r->>'success' from _p where n = 'p1'), 'true', 'A: mandar 5 de 8 -> éxito');
select ok((select (r->>'pendiente_id')::uuid is not null from _p where n = 'p1'), 'A: devuelve pendiente_id (uuid)');
select is(jsonb_typeof((select r->'pendiente_id' from _p where n = 'p1')), 'string', 'A: pendiente_id viaja como texto');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select r from _p where n = 'p1')) k),
  array['pendiente_id', 'success'], 'A: el éxito de mandar_grupo tiene sólo success y pendiente_id');
select results_eq(
  format($f$select seccion, cantidad, estado, resuelto_en is null from public.pendiente where id = %L$f$, (select r->>'pendiente_id' from _p where n = 'p1')),
  $$values ('centro'::text, 5, 'pendiente'::text, true)$$,
  'A: el pendiente quedó en centro, cantidad 5, estado pendiente, sin resolver');

select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 5), '{"success":false,"error":"SECCION_SIN_CUPO","libres":3}'::jsonb, 'A: otro 5 con 3 libres -> SECCION_SIN_CUPO libres 3');
insert into _p select 'p3', public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 3);
select is((select r->>'success' from _p where n = 'p3'), 'true', 'A: luego 3 -> éxito (cupo exacto)');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 1), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'A: con 0 libres, 1 -> SECCION_SIN_CUPO libres 0');
select is(
  (select count(*)::int from public.pendiente where evento_id = (select (a->>'evento_id')::uuid from _k) and estado = 'pendiente'),
  2, 'A: los rechazos no dejan pendientes');

-- ---------------------------------------------------------------------------
-- cancelar_pendiente libera cupo
-- ---------------------------------------------------------------------------
select is(public.cancelar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p1')), '{"success":true}'::jsonb, 'cancelar el pendiente de 5 -> success');
select results_eq(
  format($f$select estado, resuelto_en is not null from public.pendiente where id = %L$f$, (select r->>'pendiente_id' from _p where n = 'p1')),
  $$values ('cancelado'::text, true)$$, 'el pendiente cancelado queda en estado cancelado con resuelto_en');
select is(
  (select count(*)::int from public.registro where evento_id = (select (a->>'evento_id')::uuid from _k) and tipo = 'no_llegaron'),
  1, 'cancelar escribe un registro no_llegaron');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select detalle from public.registro where evento_id = (select (a->>'evento_id')::uuid from _k) and tipo = 'no_llegaron')) k),
  array['cantidad', 'pendiente_id', 'seccion', 'segundos'], 'el registro no_llegaron tiene pendiente_id, seccion, cantidad y segundos');
select results_eq(
  $$select detalle->>'pendiente_id', detalle->>'seccion', (detalle->>'cantidad')::int
      from public.registro where tipo = 'no_llegaron' and evento_id = (select (a->>'evento_id')::uuid from _k)$$,
  format($f$values (%L::text, 'centro'::text, 5)$f$, (select r->>'pendiente_id' from _p where n = 'p1')),
  'el detalle de no_llegaron apunta al pendiente cancelado (centro, 5)');
select is(jsonb_typeof((select detalle->'segundos' from public.registro where tipo = 'no_llegaron' and evento_id = (select (a->>'evento_id')::uuid from _k))), 'number', 'segundos es numérico');
select is(public.cancelar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p1')), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'cancelar dos veces -> PENDIENTE_YA_RESUELTO');
select is(
  (select count(*)::int from public.registro where evento_id = (select (a->>'evento_id')::uuid from _k) and tipo = 'no_llegaron'),
  1, 'el segundo cancelar no duplica el registro');

insert into _p select 'p5', public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 5);
select is((select r->>'success' from _p where n = 'p5'), 'true', 'tras cancelar, un nuevo 5 vuelve a entrar');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 1), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'y otra vez libres 0');

-- ---------------------------------------------------------------------------
-- Un pendiente NUNCA se libera por tiempo (spec 4.1)
-- ---------------------------------------------------------------------------
update public.pendiente set creado_en = now() - interval '10 minutes'
 where id = (select (r->>'pendiente_id')::uuid from _p where n = 'p3');
update public.pendiente set creado_en = now() - interval '10 minutes'
 where id = (select (r->>'pendiente_id')::uuid from _p where n = 'p5');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 1), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'pendientes con 10 minutos de antigüedad siguen contando en libres');
select is(
  (select count(*)::int from public.pendiente where evento_id = (select (a->>'evento_id')::uuid from _k) and estado = 'pendiente'),
  2, 'ninguna función los expira: siguen en estado pendiente');

-- p5 se cancela (el grupo no llegó) para seguir con sentar: queda p3 (3 personas, creado hace 10 min)
select is(public.cancelar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p5')), '{"success":true}'::jsonb, 'se cancela p5');
select is(
  (select (detalle->>'segundos')::numeric >= 600 and (detalle->>'segundos')::numeric < 610
     from public.registro where tipo = 'no_llegaron' and detalle->>'pendiente_id' = (select r->>'pendiente_id' from _p where n = 'p5')),
  true, 'segundos del registro no_llegaron refleja los ~600 s de espera');

-- ---------------------------------------------------------------------------
-- sentar_pendiente: errores (nada cambia) y orden de validación
-- ---------------------------------------------------------------------------
-- p3 = 3 personas en centro; tramo tD (centro, fila 2) tiene 2 libres
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select td from _t)), '{"success":false,"error":"TRAMO_SIN_CUPO"}'::jsonb, 'grupo de 3 en tramo con 2 libres -> TRAMO_SIN_CUPO');
select is((select ocupados from public.tramo where id = (select td from _t)), 0, 'TRAMO_SIN_CUPO no cambia ocupados');
select is((select estado from public.pendiente where id = (select (r->>'pendiente_id')::uuid from _p where n = 'p3')), 'pendiente', 'TRAMO_SIN_CUPO deja el pendiente en pendiente');
select is((select count(*)::int from public.registro where tipo = 'confirmacion' and evento_id = (select (a->>'evento_id')::uuid from _k)), 0, 'TRAMO_SIN_CUPO no escribe registro');
select is((select verificada_en is null from public.fila where id = (select f2 from _t)), true, 'TRAMO_SIN_CUPO no toca verificada_en');

select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select tr from _t)), '{"success":false,"error":"TRAMO_RESERVADO"}'::jsonb, 'sentar en tramo reservado -> TRAMO_RESERVADO');
select is((select ocupados from public.tramo where id = (select tr from _t)), 0, 'TRAMO_RESERVADO no cambia ocupados');

select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select ip from _t)), '{"success":false,"error":"SECCION_INCORRECTA"}'::jsonb, 'pendiente de centro en fila de izquierda -> SECCION_INCORRECTA');
select is((select ocupados from public.tramo where id = (select ip from _t)), 0, 'SECCION_INCORRECTA no cambia ocupados');

-- precedencia de errores
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select ir from _t)), '{"success":false,"error":"TRAMO_RESERVADO"}'::jsonb, 'precedencia: reservado gana a sección incorrecta');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select iq from _t)), '{"success":false,"error":"SECCION_INCORRECTA"}'::jsonb, 'precedencia: sección incorrecta gana a falta de cupo (3 en tramo de 2)');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), -1), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'tramo inexistente -> TRAMO_INEXISTENTE');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), null), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'tramo NULL -> TRAMO_INEXISTENTE');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), gen_random_uuid(), -1), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'precedencia: pendiente inexistente gana a tramo inexistente');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), null, (select ta from _t)), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'pendiente NULL -> PENDIENTE_YA_RESUELTO');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p5'), (select ta from _t)), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'sentar un pendiente cancelado -> PENDIENTE_YA_RESUELTO');
select is((select ocupados from public.tramo where id = (select ta from _t)), 0, 'sentar un cancelado no cambia ocupados');

-- ---------------------------------------------------------------------------
-- Aislamiento entre eventos
-- ---------------------------------------------------------------------------
select is(public.sentar_pendiente((select b->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select tb from _t)), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'B no puede sentar un pendiente de A (se trata como inexistente)');
select is(public.cancelar_pendiente((select b->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3')), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'B no puede cancelar un pendiente de A');
select is((select estado from public.pendiente where id = (select (r->>'pendiente_id')::uuid from _p where n = 'p3')), 'pendiente', 'el pendiente de A sigue intacto');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'b1'), (select ta from _t)), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'A no puede sentar un pendiente de B');
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select tb from _t)), '{"success":false,"error":"TRAMO_INEXISTENTE"}'::jsonb, 'un tramo de otro evento es TRAMO_INEXISTENTE');
select is((select ocupados from public.tramo where id = (select tb from _t)), 0, 'los tramos de B no se tocaron');
select is((select count(*)::int from public.pendiente where evento_id = (select (b->>'evento_id')::uuid from _k) and estado = 'pendiente'), 2, 'los pendientes de B siguen pendientes');

-- ---------------------------------------------------------------------------
-- sentar_pendiente: éxito
-- ---------------------------------------------------------------------------
update public.fila set fragmentada = true where id in ((select f1 from _t), (select f2 from _t));

select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select ta from _t)), '{"success":true}'::jsonb, 'sentar 3 en tramo con 4 libres -> success');
select is((select ocupados from public.tramo where id = (select ta from _t)), 3, 'ocupados sube en la cantidad del grupo');
select results_eq(
  format($f$select estado, resuelto_en is not null from public.pendiente where id = %L$f$, (select r->>'pendiente_id' from _p where n = 'p3')),
  $$values ('sentado'::text, true)$$, 'el pendiente queda sentado con resuelto_en');
select is((select verificada_en is not null from public.fila where id = (select f1 from _t)), true, 'la fila queda con verificada_en');
select is((select fragmentada from public.fila where id = (select f1 from _t)), true, 'fragmentada sigue en true mientras la fila tiene libres públicos');
select is((select fragmentada from public.fila where id = (select f2 from _t)), true, 'la otra fila no se toca (fragmentada y sin verificar)');
select is((select verificada_en is null from public.fila where id = (select f2 from _t)), true, 'la otra fila no recibe verificada_en');
select is(
  (select count(*)::int from public.registro where tipo = 'confirmacion' and evento_id = (select (a->>'evento_id')::uuid from _k)),
  1, 'sentar escribe un registro confirmacion');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select detalle from public.registro where tipo = 'confirmacion' and evento_id = (select (a->>'evento_id')::uuid from _k))) k),
  array['cantidad', 'fila_id', 'fuera_de_sector', 'pendiente_id', 'sector_id', 'segundos', 'tramo_id'], 'el registro confirmacion tiene pendiente_id, tramo_id, fila_id, cantidad, segundos, sector_id y fuera_de_sector');
select results_eq(
  $$select detalle->>'pendiente_id', (detalle->>'tramo_id')::bigint, (detalle->>'fila_id')::bigint, (detalle->>'cantidad')::int
      from public.registro where tipo = 'confirmacion' and evento_id = (select (a->>'evento_id')::uuid from _k)$$,
  format($f$select %L::text, ta, f1, 3 from _t$f$, (select r->>'pendiente_id' from _p where n = 'p3')),
  'el detalle de confirmacion apunta al pendiente, tramo y fila correctos');
select is(
  (select (detalle->>'segundos')::numeric >= 600 and (detalle->>'segundos')::numeric < 610
          and (detalle->>'segundos')::numeric = round((detalle->>'segundos')::numeric, 1)
     from public.registro where tipo = 'confirmacion' and evento_id = (select (a->>'evento_id')::uuid from _k)),
  true, 'segundos ~600 (espera del pendiente) redondeado a 1 decimal');

select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3'), (select ta from _t)), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'repetir sentar -> PENDIENTE_YA_RESUELTO');
select is((select ocupados from public.tramo where id = (select ta from _t)), 3, 'repetir sentar no suma ocupados otra vez');
select is((select count(*)::int from public.registro where tipo = 'confirmacion' and evento_id = (select (a->>'evento_id')::uuid from _k)), 1, 'repetir sentar no duplica el registro');
select is(public.cancelar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p3')), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'cancelar un pendiente ya sentado -> PENDIENTE_YA_RESUELTO');
select is((select estado from public.pendiente where id = (select (r->>'pendiente_id')::uuid from _p where n = 'p3')), 'sentado', 'cancelar tras sentar no cambia el estado');

-- libres ahora: (4-3) + 2 + 2 = 5 (los sentados salen de pendientes y entran en ocupados)
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 20), '{"success":false,"error":"SECCION_SIN_CUPO","libres":5}'::jsonb, 'tras sentar 3 quedan 5 libres (ocupados reemplaza al pendiente)');

-- Llenar fila 1: ta (1 libre) y tc (2 libres)
insert into _p select 'p1b', public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 1);
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p1b'), (select ta from _t)), '{"success":true}'::jsonb, 'sentar 1 llena el tramo ta (4/4)');
select is((select fragmentada from public.fila where id = (select f1 from _t)), true, 'fila 1 aún con 2 libres en tc: sigue fragmentada');

insert into _p select 'p2', public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 2);
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p2'), (select tc from _t)), '{"success":true}'::jsonb, 'sentar 2 llena el tramo tc (2/2)');
select is((select fragmentada from public.fila where id = (select f1 from _t)), false, 'fila 1 sin libres públicos (el reservado no cuenta): fragmentada = false');
select is((select ocupados from public.tramo where id = (select tr from _t)), 0, 'el tramo reservado sigue en 0');
select is((select fragmentada from public.fila where id = (select f2 from _t)), true, 'fila 2 no se tocó: sigue fragmentada');

insert into _p select 'p2b', public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 2);
select is(public.sentar_pendiente((select a->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'p2b'), (select td from _t)), '{"success":true}'::jsonb, 'sentar 2 llena la fila 2');
select is((select fragmentada from public.fila where id = (select f2 from _t)), false, 'fila 2 llena: fragmentada = false');
select is((select verificada_en is not null from public.fila where id = (select f2 from _t)), true, 'fila 2 con verificada_en');
select is(public.mandar_grupo((select a->>'clave_ujier' from _k), 'centro', 1), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'sección centro llena: 8 sentados, libres 0');
select is(
  (select sum(t.ocupados)::int from public.tramo t join public.fila f on f.id = t.fila_id
    where f.evento_id = (select (a->>'evento_id')::uuid from _k) and f.seccion = 'centro'),
  8, 'jamás se sentaron más de 8 personas en centro');
select is((select count(*)::int from public.registro where tipo = 'confirmacion' and evento_id = (select (a->>'evento_id')::uuid from _k)), 4, 'cuatro confirmaciones registradas');

-- ---------------------------------------------------------------------------
-- Funciona como anon (los privilegios del rol no afectan: son SECURITY DEFINER)
-- ---------------------------------------------------------------------------
set local role anon;
select is(public.mandar_grupo((select b->>'clave_ujier' from _k), 'izquierda', 2), '{"success":false,"error":"SECCION_SIN_CUPO","libres":0}'::jsonb, 'anon puede llamar mandar_grupo (B no tiene izquierda)');
select is(public.cancelar_pendiente((select b->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'b2')), '{"success":true}'::jsonb, 'anon puede llamar cancelar_pendiente');
select is(public.sentar_pendiente((select b->>'clave_ujier' from _k), (select (r->>'pendiente_id')::uuid from _p where n = 'b1'), (select tb from _t)), '{"success":true}'::jsonb, 'anon puede llamar sentar_pendiente');
select throws_ok($$select public.mandar_grupo('clave-mala', 'centro', 1)$$, null, 'CLAVE_INVALIDA', 'anon con clave inválida: CLAVE_INVALIDA');
reset role;

select * from finish();
rollback;

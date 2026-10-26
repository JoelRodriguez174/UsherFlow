-- Task 6 (Etapa 1): salón (fila, tramo, pendiente, registro), RLS de solo lectura y obtener_estado_salon.
begin;
select plan(108);

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select has_table('public', 'fila', 'existe public.fila');
select has_table('public', 'tramo', 'existe public.tramo');
select has_table('public', 'pendiente', 'existe public.pendiente');
select has_table('public', 'registro', 'existe public.registro');
select has_function('public', 'obtener_estado_salon', array['text'], 'existe public.obtener_estado_salon(text)');
select has_function('private', 'aplicar_plantilla', array['uuid', 'jsonb'], 'existe private.aplicar_plantilla(uuid, jsonb)');

-- ---------------------------------------------------------------------------
-- RLS y policies
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('fila','tramo','pendiente','registro') and c.relrowsecurity),
  4,
  'RLS activada en fila, tramo, pendiente y registro');
select is(
  (select count(*)::int from pg_policies p, unnest(p.roles) r
    where p.schemaname = 'public' and p.tablename in ('fila','tramo','pendiente')
      and p.cmd = 'SELECT' and p.qual = 'true' and r in ('anon','authenticated')),
  6,
  'fila, tramo y pendiente tienen una policy SELECT using (true) para anon y para authenticated');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('fila','tramo','pendiente') and cmd <> 'SELECT'),
  0,
  'no hay policies de escritura en fila, tramo ni pendiente');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'registro'),
  0,
  'registro no tiene policies');

-- ---------------------------------------------------------------------------
-- Privilegios (independientes del rol de la sesión)
-- ---------------------------------------------------------------------------
select ok(
  not exists (
    select 1 from (values ('fila'),('tramo'),('pendiente')) t(tab), (values ('anon'),('authenticated')) r(rol),
         (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
     where has_table_privilege(r.rol, 'public.' || t.tab, p.priv)),
  'anon y authenticated no tienen INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER en fila, tramo ni pendiente');
select ok(
  (select bool_and(has_table_privilege(r.rol, 'public.' || t.tab, 'SELECT'))
     from (values ('fila'),('tramo'),('pendiente')) t(tab), (values ('anon'),('authenticated')) r(rol)),
  'anon y authenticated tienen SELECT en fila, tramo y pendiente');
select ok(
  not exists (
    select 1 from (values ('anon'),('authenticated')) r(rol),
         (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
     where has_table_privilege(r.rol, 'public.registro', p.priv)),
  'anon y authenticated no tienen ningún privilegio sobre registro');
select ok(has_function_privilege('anon', 'public.obtener_estado_salon(text)', 'EXECUTE'),
  'anon puede ejecutar obtener_estado_salon');
select ok(has_function_privilege('authenticated', 'public.obtener_estado_salon(text)', 'EXECUTE'),
  'authenticated puede ejecutar obtener_estado_salon');
select ok(not has_function_privilege('anon', 'private.aplicar_plantilla(uuid, jsonb)', 'EXECUTE'),
  'anon no tiene EXECUTE sobre aplicar_plantilla');
select ok(not has_function_privilege('authenticated', 'private.aplicar_plantilla(uuid, jsonb)', 'EXECUTE'),
  'authenticated no tiene EXECUTE sobre aplicar_plantilla');

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('fila','tramo','pendiente')),
  3,
  'supabase_realtime incluye fila, tramo y pendiente');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('fila','tramo','pendiente') and c.relreplident = 'f'),
  3,
  'REPLICA IDENTITY FULL en fila, tramo y pendiente');

-- ---------------------------------------------------------------------------
-- Datos de prueba: A (plantilla del brief), B (sin filas), C (orden de secciones)
-- ---------------------------------------------------------------------------
create temp table _a as select public.crear_evento('Evento A') as r;
create temp table _b as select public.crear_evento('Evento B') as r;
create temp table _c as select public.crear_evento('Evento C') as r;
grant select on _a, _b, _c to anon, authenticated;

-- Plantilla inválida sobre B (no debe dejar nada)
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, %L::jsonb)$f$,
    (select (r->>'evento_id') from _b),
    '{"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":3}]}],"derecha":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":0}]}]}'),
  null, 'PLANTILLA_INVALIDA', 'plantilla con capacidad 0 en una sección posterior -> PLANTILLA_INVALIDA');
select is(
  (select count(*)::int from public.fila where evento_id = (select (r->>'evento_id')::uuid from _b)),
  0,
  'una plantilla inválida no deja filas a medias');

-- Otras validaciones
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"fondo":[]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'sección desconocida -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"vip","capacidad":2}]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'tipo desconocido -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":2.5}]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'capacidad no entera -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":"3"}]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'capacidad como texto -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"reservado","capacidad":2}]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'reservado sin etiqueta -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"reservado","capacidad":2,"etiqueta":"  "}]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'reservado con etiqueta en blanco -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'fila sin tramos -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":1}]},{"numero":1,"tramos":[{"tipo":"publico","capacidad":1}]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'número de fila repetido en la sección -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":0,"tramos":[{"tipo":"publico","capacidad":1}]}]}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'número de fila 0 -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '[]'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'plantilla que no es objeto -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, null)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'plantilla NULL -> PLANTILLA_INVALIDA');
select throws_ok(
  format($f$select private.aplicar_plantilla(%L, '{"izquierda":{"numero":1}}'::jsonb)$f$, (select r->>'evento_id' from _b)),
  null, 'PLANTILLA_INVALIDA', 'sección que no es arreglo -> PLANTILLA_INVALIDA');

-- Plantilla del brief sobre A: [pub 3][res 2 "Mamás"][pub 3]
select lives_ok(
  format($f$select private.aplicar_plantilla(%L, %L::jsonb)$f$,
    (select r->>'evento_id' from _a),
    '{"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":3},{"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"},{"tipo":"publico","capacidad":3}]}]}'),
  'aplicar_plantilla acepta la plantilla de 1 fila');
select is(
  (select count(*)::int from public.fila where evento_id = (select (r->>'evento_id')::uuid from _a)),
  1,
  'aplicar_plantilla creó 1 fila');
select is(
  (select count(*)::int from public.tramo t join public.fila f on f.id = t.fila_id
    where f.evento_id = (select (r->>'evento_id')::uuid from _a) and t.ocupados = 0),
  3,
  'aplicar_plantilla creó 3 tramos con ocupados = 0');
select results_eq(
  $$select t.orden, t.tipo, t.capacidad, t.etiqueta
      from public.tramo t join public.fila f on f.id = t.fila_id
     where f.evento_id = (select (r->>'evento_id')::uuid from _a) order by t.orden$$,
  $$values (1, 'publico', 3, null::text), (2, 'reservado', 2, 'Mamás'), (3, 'publico', 3, null::text)$$,
  'los tramos quedan con orden 1..3 y sus tipos, capacidades y etiquetas');

-- Pendientes de A: dos pendientes (fuera de orden de inserción) y uno sentado
insert into public.pendiente (evento_id, seccion, cantidad, estado, creado_en) values
  ((select (r->>'evento_id')::uuid from _a), 'centro',    4, 'pendiente', '2026-10-22 10:05:00+00'),
  ((select (r->>'evento_id')::uuid from _a), 'izquierda', 2, 'pendiente', '2026-10-22 10:01:00+00'),
  ((select (r->>'evento_id')::uuid from _a), 'derecha',   5, 'sentado',   '2026-10-22 10:02:00+00');

-- Evento C: secciones desordenadas
select lives_ok(
  format($f$select private.aplicar_plantilla(%L, %L::jsonb)$f$,
    (select r->>'evento_id' from _c),
    '{"derecha":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":2}]}],"izquierda":[{"numero":2,"tramos":[{"tipo":"publico","capacidad":2}]},{"numero":1,"tramos":[{"tipo":"publico","capacidad":2}]}],"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":2}]}]}'),
  'aplicar_plantilla acepta una plantilla con las tres secciones');

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  format($f$update public.tramo set ocupados = capacidad + 1 where fila_id = %s$f$,
    (select id from public.fila where evento_id = (select (r->>'evento_id')::uuid from _a))),
  '23514', null, 'ocupados > capacidad viola el check');
select throws_ok(
  format($f$update public.tramo set ocupados = -1 where fila_id = %s$f$,
    (select id from public.fila where evento_id = (select (r->>'evento_id')::uuid from _a))),
  '23514', null, 'ocupados negativo viola el check');
select throws_ok(
  format($f$insert into public.tramo (fila_id, orden, tipo, capacidad) values (%s, 9, 'publico', 0)$f$,
    (select id from public.fila where evento_id = (select (r->>'evento_id')::uuid from _a))),
  '23514', null, 'capacidad 0 viola el check');
select throws_ok(
  format($f$insert into public.tramo (fila_id, orden, tipo, capacidad) values (%s, 9, 'reservado', 2)$f$,
    (select id from public.fila where evento_id = (select (r->>'evento_id')::uuid from _a))),
  '23514', null, 'tramo reservado sin etiqueta viola el check');
select throws_ok(
  format($f$insert into public.tramo (fila_id, orden, tipo, capacidad) values (%s, 1, 'publico', 1)$f$,
    (select id from public.fila where evento_id = (select (r->>'evento_id')::uuid from _a))),
  '23505', null, 'tramo con orden repetido en la fila viola la unique');
select throws_ok(
  format($f$insert into public.fila (evento_id, seccion, numero) values (%L, 'izquierda', 1)$f$,
    (select r->>'evento_id' from _a)),
  '23505', null, 'fila repetida (evento, seccion, numero) viola la unique');
select throws_ok(
  format($f$insert into public.fila (evento_id, seccion, numero) values (%L, 'fondo', 1)$f$,
    (select r->>'evento_id' from _a)),
  '23514', null, 'sección inválida en fila viola el check');
select throws_ok(
  format($f$insert into public.pendiente (evento_id, seccion, cantidad, estado) values (%L, 'centro', 1, 'perdido')$f$,
    (select r->>'evento_id' from _a)),
  '23514', null, 'estado inválido en pendiente viola el check');
select throws_ok(
  format($f$insert into public.pendiente (evento_id, seccion, cantidad) values (%L, 'centro', 0)$f$,
    (select r->>'evento_id' from _a)),
  '23514', null, 'cantidad 0 en pendiente viola el check');
with ins as (
  insert into public.pendiente (evento_id, seccion, cantidad)
  values ((select (r->>'evento_id')::uuid from _b), 'centro', 1) returning estado, creado_en)
select is((select estado from ins), 'pendiente', 'el estado por defecto de un pendiente es pendiente');

-- ---------------------------------------------------------------------------
-- obtener_estado_salon (como postgres)
-- ---------------------------------------------------------------------------
create temp table _s as select public.obtener_estado_salon(r->>'clave_ujier') as s from _a;

select is(jsonb_typeof((select s from _s)), 'object', 'obtener_estado_salon devuelve un objeto');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select s from _s)) k),
  array['evento_id','filas','pendientes','reservas','sectores','server_now','sesion'],
  'claves de primer nivel: evento_id, filas, pendientes, reservas, sectores, server_now, sesion');
select is(jsonb_typeof((select s->'server_now' from _s)), 'string', 'server_now es texto ISO-8601 (string json)');
select ok(((select s->>'server_now' from _s)::timestamptz) is not null, 'server_now es una fecha válida y no nula');
select is(
  (select (s->>'evento_id')::uuid from _s),
  (select (r->>'evento_id')::uuid from _a),
  'evento_id coincide con el del evento');
select is(jsonb_array_length((select s->'filas' from _s)), 1, 'filas tiene 1 elemento');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select s->'filas'->0 from _s)) k),
  array['fragmentada','id','numero','seccion','tramos','verificada_en'],
  'claves de una fila: fragmentada, id, numero, seccion, tramos, verificada_en');
select is((select s->'filas'->0->>'seccion' from _s), 'izquierda', 'fila: seccion');
select is((select (s->'filas'->0->>'numero')::int from _s), 1, 'fila: numero');
select is((select s->'filas'->0->'fragmentada' from _s), 'false'::jsonb, 'fila: fragmentada false');
select is((select s->'filas'->0->'verificada_en' from _s), 'null'::jsonb, 'fila: verificada_en es null json');
select is(jsonb_typeof((select s->'filas'->0->'id' from _s)), 'number', 'fila: id es numérico');
select is(jsonb_array_length((select s->'filas'->0->'tramos' from _s)), 3, 'la fila tiene 3 tramos');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select s->'filas'->0->'tramos'->0 from _s)) k),
  array['capacidad','etiqueta','id','ocupados','orden','tipo'],
  'claves de un tramo: capacidad, etiqueta, id, ocupados, orden, tipo');
select is(jsonb_typeof((select s->'filas'->0->'tramos'->0->'id' from _s)), 'number', 'tramo: id es numérico');
select is(
  (select array_agg(t->>'orden' order by ord) from jsonb_array_elements((select s->'filas'->0->'tramos' from _s)) with ordinality e(t, ord)),
  array['1','2','3'],
  'tramos en orden 1, 2, 3');
select is(
  (select array_agg(t->>'tipo' order by ord) from jsonb_array_elements((select s->'filas'->0->'tramos' from _s)) with ordinality e(t, ord)),
  array['publico','reservado','publico'],
  'tipos de tramo: publico, reservado, publico');
select is(
  (select array_agg((t->>'capacidad')::int order by ord) from jsonb_array_elements((select s->'filas'->0->'tramos' from _s)) with ordinality e(t, ord)),
  array[3,2,3],
  'capacidades 3, 2, 3');
select is(
  (select array_agg((t->>'ocupados')::int order by ord) from jsonb_array_elements((select s->'filas'->0->'tramos' from _s)) with ordinality e(t, ord)),
  array[0,0,0],
  'ocupados 0, 0, 0');
select is((select s->'filas'->0->'tramos'->1->>'etiqueta' from _s), 'Mamás', 'el tramo reservado tiene etiqueta Mamás');
select is((select s->'filas'->0->'tramos'->0->'etiqueta' from _s), 'null'::jsonb, 'el tramo público tiene etiqueta null');

-- pendientes: sólo estado = 'pendiente', por creado_en
select is(jsonb_array_length((select s->'pendientes' from _s)), 2, 'pendientes devuelve sólo los pendientes (no los sentados)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select s->'pendientes'->0 from _s)) k),
  array['cantidad','creado_en','id','seccion','sede_id'],
  'claves de un pendiente: cantidad, creado_en, id, seccion, sede_id');
select is(
  (select array_agg(p->>'seccion' order by ord) from jsonb_array_elements((select s->'pendientes' from _s)) with ordinality e(p, ord)),
  array['izquierda','centro'],
  'pendientes ordenados por creado_en');
select is((select (s->'pendientes'->0->>'cantidad')::int from _s), 2, 'pendiente: cantidad');

-- La clave de supervisor también sirve
select is(
  (select public.obtener_estado_salon(r->>'clave_supervisor')->>'evento_id' from _a),
  (select r->>'evento_id' from _a),
  'la clave de supervisor también obtiene el estado');

-- Evento sin filas: arreglos vacíos, nunca null
create temp table _sb as select public.obtener_estado_salon(r->>'clave_ujier') as s from _b;
select is((select s->'filas' from _sb), '[]'::jsonb, 'evento sin filas: filas es [] (no null)');
select is(jsonb_array_length((select s->'pendientes' from _sb)), 1, 'evento B: su pendiente aparece');
update public.pendiente set estado = 'cancelado' where evento_id = (select (r->>'evento_id')::uuid from _b);
select is(
  (select public.obtener_estado_salon(r->>'clave_ujier')->'pendientes' from _b),
  '[]'::jsonb,
  'sin pendientes: pendientes es [] (no null)');

-- Orden de secciones: izquierda, centro, derecha; luego número
select is(
  (select array_agg((f->>'seccion') || (f->>'numero') order by ord)
     from jsonb_array_elements((select public.obtener_estado_salon(r->>'clave_ujier')->'filas' from _c)) with ordinality e(f, ord)),
  array['izquierda1','izquierda2','centro1','derecha1'],
  'filas ordenadas por sección (izquierda, centro, derecha) y número');

-- Claves malas
select throws_ok($$select public.obtener_estado_salon('mala')$$, null, 'CLAVE_INVALIDA', 'clave mala -> CLAVE_INVALIDA');
select throws_ok($$select public.obtener_estado_salon(null)$$, null, 'CLAVE_INVALIDA', 'clave NULL -> CLAVE_INVALIDA');
select throws_ok($$select public.obtener_estado_salon('')$$, null, 'CLAVE_INVALIDA', 'clave vacía -> CLAVE_INVALIDA');

-- Borrar el evento arrastra todo (on delete cascade)
create temp table _d as select public.crear_evento('Evento D') as r;
select lives_ok(
  format($f$select private.aplicar_plantilla(%L, '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":2}]}]}'::jsonb)$f$,
    (select r->>'evento_id' from _d)),
  'evento D: plantilla aplicada');
insert into public.pendiente (evento_id, seccion, cantidad) values ((select (r->>'evento_id')::uuid from _d), 'centro', 1);
insert into public.registro (evento_id, tipo) values ((select (r->>'evento_id')::uuid from _d), 'prueba');
create temp table _dfila as select id from public.fila where evento_id = (select (r->>'evento_id')::uuid from _d);
delete from public.evento where id = (select (r->>'evento_id')::uuid from _d);
select is(
  (select (select count(*) from public.fila where evento_id = (select (r->>'evento_id')::uuid from _d))
        + (select count(*) from public.tramo where fila_id in (select id from _dfila))
        + (select count(*) from public.pendiente where evento_id = (select (r->>'evento_id')::uuid from _d))
        + (select count(*) from public.registro where evento_id = (select (r->>'evento_id')::uuid from _d))),
  0::bigint,
  'borrar un evento borra en cascada sus filas, tramos, pendientes y registro');

-- ---------------------------------------------------------------------------
-- Comportamiento real como anon
-- ---------------------------------------------------------------------------
set local role anon;

select lives_ok($$select * from public.fila$$, 'anon: select en fila funciona');
select lives_ok($$select * from public.tramo$$, 'anon: select en tramo funciona');
select lives_ok($$select * from public.pendiente$$, 'anon: select en pendiente funciona');
select cmp_ok((select count(*)::int from public.fila), '>=', 1, 'anon ve filas');
select cmp_ok((select count(*)::int from public.tramo), '>=', 3, 'anon ve tramos');
select throws_ok($$select * from public.registro$$, '42501', null, 'anon: select en registro -> permiso denegado');
select throws_ok($$insert into public.registro (evento_id, tipo) values (gen_random_uuid(), 'x')$$, '42501', null, 'anon: insert en registro -> permiso denegado');

select throws_ok($$insert into public.fila (evento_id, seccion, numero) values (gen_random_uuid(), 'centro', 99)$$, '42501', null, 'anon: insert en fila -> permiso denegado');
select throws_ok($$update public.fila set fragmentada = true$$, '42501', null, 'anon: update en fila -> permiso denegado');
select throws_ok($$delete from public.fila$$, '42501', null, 'anon: delete en fila -> permiso denegado');
select throws_ok($$insert into public.tramo (fila_id, orden, tipo, capacidad) values (1, 99, 'publico', 1)$$, '42501', null, 'anon: insert en tramo -> permiso denegado');
select throws_ok($$update public.tramo set ocupados = 1$$, '42501', null, 'anon: update en tramo -> permiso denegado');
select throws_ok($$delete from public.tramo$$, '42501', null, 'anon: delete en tramo -> permiso denegado');
select throws_ok($$insert into public.pendiente (evento_id, seccion, cantidad) values (gen_random_uuid(), 'centro', 1)$$, '42501', null, 'anon: insert en pendiente -> permiso denegado');
select throws_ok($$update public.pendiente set estado = 'sentado'$$, '42501', null, 'anon: update en pendiente -> permiso denegado');
select throws_ok($$delete from public.pendiente$$, '42501', null, 'anon: delete en pendiente -> permiso denegado');
select throws_ok($$truncate public.fila cascade$$, '42501', null, 'anon: truncate en fila -> permiso denegado');

select throws_ok($$select private.aplicar_plantilla(gen_random_uuid(), '{}'::jsonb)$$, '42501', null, 'anon: aplicar_plantilla -> permiso denegado');

select is(
  (select public.obtener_estado_salon(r->>'clave_ujier')->>'evento_id' from _a),
  (select r->>'evento_id' from _a),
  'anon: obtener_estado_salon con clave válida funciona');
select throws_ok($$select public.obtener_estado_salon('mala')$$, null, 'CLAVE_INVALIDA', 'anon: clave mala -> CLAVE_INVALIDA');

reset role;

-- ---------------------------------------------------------------------------
-- Comportamiento real como authenticated
-- ---------------------------------------------------------------------------
set local role authenticated;

select lives_ok($$select * from public.fila$$, 'authenticated: select en fila funciona');
select throws_ok($$insert into public.fila (evento_id, seccion, numero) values (gen_random_uuid(), 'centro', 99)$$, '42501', null, 'authenticated: insert en fila -> permiso denegado');
select throws_ok($$update public.tramo set ocupados = 1$$, '42501', null, 'authenticated: update en tramo -> permiso denegado');
select throws_ok($$delete from public.pendiente$$, '42501', null, 'authenticated: delete en pendiente -> permiso denegado');
select throws_ok($$select * from public.registro$$, '42501', null, 'authenticated: select en registro -> permiso denegado');

reset role;

select * from finish();
rollback;


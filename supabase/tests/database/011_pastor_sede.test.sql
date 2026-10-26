-- Etapa 3 / Tarea 3: RPC del pastor de sede (obtener_mapa_sede, guardar_preferencias), por clave de sede.
begin;
select plan(68);

select has_function('private', 'sede_de_clave', array['text'], 'existe private.sede_de_clave');
select has_function('public', 'obtener_mapa_sede', array['text'], 'existe obtener_mapa_sede');
select has_function('public', 'guardar_preferencias', array['text', 'bigint[]'], 'existe guardar_preferencias');

create function pg_temp.nlock(p_sede uuid) returns integer language sql as $$
  select count(*)::int from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid()
     and ((classid::bigint << 32) | objid::bigint) = hashtextextended(p_sede::text, 0)
$$;

-- Datos: evento A (centro 6 filas x 10) con sectores C1 (filas 1-3, cap 30) y C2 (4-6, cap 30);
-- evento B con un sector; evento C sin sectores.
create temp table _r0 as select public.crear_evento('Pastor A') as a, public.crear_evento('Pastor B') as b, public.crear_evento('Pastor C') as c;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ka, a->>'clave_supervisor' as sa,
         (b->>'evento_id')::uuid as eb, b->>'clave_supervisor' as sb,
         (c->>'evento_id')::uuid as ec, c->>'clave_supervisor' as sc
    from _r0;
select private.aplicar_plantilla((select ea from _k),
  (select jsonb_build_object('centro', jsonb_agg(jsonb_build_object('numero', n, 'tramos', jsonb_build_array(jsonb_build_object('tipo', 'publico', 'capacidad', 10)))))
     from generate_series(1, 6) n));
select private.aplicar_plantilla((select eb from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":10}]}]}'::jsonb);
select public.guardar_sectores((select sa from _k),
  '[{"seccion":"centro","nombre":"C1","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"C2","fila_desde":4,"fila_hasta":6}]'::jsonb);
select public.guardar_sectores((select sb from _k),
  '[{"seccion":"centro","nombre":"B1","fila_desde":1,"fila_hasta":1}]'::jsonb);

insert into public.sede (nombre) values ('Catán T11'), ('Lomas T11');
create temp table _s as
  select (select id from public.sede where nombre = 'Catán T11') as catan,
         (select id from public.sede where nombre = 'Lomas T11') as lomas;
create temp table _sec as
  select (select id from public.sector where evento_id = (select ea from _k) and nombre = 'C1') as c1,
         (select id from public.sector where evento_id = (select ea from _k) and nombre = 'C2') as c2,
         (select id from public.sector where evento_id = (select eb from _k)) as b1;

create temp table _x (n text primary key, r jsonb);
insert into _x select 'ac', public.generar_acceso_sede((select sa from _k), (select catan from _s));
insert into _x select 'al', public.generar_acceso_sede((select sa from _k), (select lomas from _s));
insert into _x select 'bc', public.generar_acceso_sede((select sb from _k), (select catan from _s));
insert into _x select 'cc', public.generar_acceso_sede((select sc from _k), (select catan from _s));
create temp table _c as
  select (select r->>'clave' from _x where n = 'ac') as catan,
         (select r->>'clave' from _x where n = 'al') as lomas,
         (select r->>'clave' from _x where n = 'bc') as catan_b,
         (select r->>'clave' from _x where n = 'cc') as catan_c;

insert into public.sesion (evento_id, nombre, inicio_at) values
  ((select ea from _k), 'Sáb T11', now() + interval '2 days'),
  ((select ea from _k), 'Dom T11', now() + interval '3 days');
create temp table _ses as
  select (select id from public.sesion where nombre = 'Sáb T11') as sab, (select id from public.sesion where nombre = 'Dom T11') as dom;

-- ---------------------------------------------------------------------------
-- sede_de_clave
-- ---------------------------------------------------------------------------
select is((select sede_id from private.sede_de_clave((select catan from _c))), (select catan from _s), 'sede_de_clave: devuelve la sede');
select is((select evento_id from private.sede_de_clave((select catan from _c))), (select ea from _k), 'sede_de_clave: devuelve el evento');
select is((select evento_id from private.sede_de_clave((select catan_b from _c))), (select eb from _k), 'la misma sede en otro evento tiene otra clave y otro evento');
select throws_ok($f$select * from private.sede_de_clave('no-existe')$f$, null, 'CLAVE_INVALIDA', 'sede_de_clave: clave inexistente');
select throws_ok($f$select * from private.sede_de_clave('')$f$, null, 'CLAVE_INVALIDA', 'sede_de_clave: clave vacía');
select throws_ok($f$select * from private.sede_de_clave(null)$f$, null, 'CLAVE_INVALIDA', 'sede_de_clave: clave nula');

-- ---------------------------------------------------------------------------
-- obtener_mapa_sede: forma y aislamiento
-- ---------------------------------------------------------------------------
insert into _x select 'm', public.obtener_mapa_sede((select catan from _c));
select is((select r->>'success' from _x where n = 'm'), 'true', 'obtener_mapa_sede: success');
select is((select r->'sede' from _x where n = 'm'), jsonb_build_object('id', (select catan from _s), 'nombre', 'Catán T11'), 'trae su sede (id y nombre)');
select is((select r->'abierto' from _x where n = 'm'), 'true'::jsonb, 'sin fecha límite: abierto');
select is((select r->'fecha_limite' from _x where n = 'm'), 'null'::jsonb, 'sin fecha límite: fecha_limite null');
select is((select jsonb_agg(e->>'nombre') from jsonb_array_elements((select r->'sectores' from _x where n = 'm')) e), '["C1","C2"]'::jsonb, 'sólo los sectores de su evento, en orden');
select is((select (r->'sectores'->0) - 'id' from _x where n = 'm'), '{"seccion":"centro","nombre":"C1","fila_desde":1,"fila_hasta":3}'::jsonb, 'cada sector trae seccion, nombre y filas (sin capacidad)');
select ok((select r->'sectores'->0 ? 'id' from _x where n = 'm'), 'cada sector trae id');
select is((select r->'preferencias' from _x where n = 'm'), '[]'::jsonb, 'sin preferencias: []');
select is((select jsonb_array_length(r->'sesiones') from _x where n = 'm'), 2, 'trae las 2 sesiones del evento');
select is((select r->'sesiones'->0->>'nombre' from _x where n = 'm'), 'Sáb T11', 'sesiones ordenadas por inicio');
select is((select r->'sesiones'->0->'sectores' from _x where n = 'm'),
  jsonb_build_array(jsonb_build_object('sector_id', (select c1 from _sec), 'agotado', false, 'asignado', 0),
                    jsonb_build_object('sector_id', (select c2 from _sec), 'agotado', false, 'asignado', 0)),
  'cada sesión lista todos los sectores, sin agotar');

-- preferencias propias vs ajenas
insert into public.preferencia (sede_id, sector_id) values ((select lomas from _s), (select c1 from _sec)), ((select catan from _s), (select c2 from _sec));
select is(public.obtener_mapa_sede((select catan from _c))->'preferencias', jsonb_build_array((select c2 from _sec)), 'Catán ve sólo sus preferencias');
select is(public.obtener_mapa_sede((select lomas from _c))->'preferencias', jsonb_build_array((select c1 from _sec)), 'Lomas ve sólo las suyas');
select is(public.obtener_mapa_sede((select catan_b from _c))->'preferencias', '[]'::jsonb, 'la clave de la sede en otro evento no trae preferencias del evento A');
select is(public.obtener_mapa_sede((select catan_b from _c))->'sede'->>'id', (select catan::text from _s), 'esa clave es de la misma sede, pero del evento B');
select is((select jsonb_agg(e->>'nombre') from jsonb_array_elements(public.obtener_mapa_sede((select catan_b from _c))->'sectores') e), '["B1"]'::jsonb, 'y sólo ve los sectores del evento B');

-- ---------------------------------------------------------------------------
-- agotado / asignado: Lomas llena C1 en Sáb (30 = capacidad); Catán tiene 5 en C2 en Sáb
-- ---------------------------------------------------------------------------
insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id) values
  ((select sab from _ses), (select lomas from _s), 'centro', 30, (select c1 from _sec)),
  ((select sab from _ses), (select catan from _s), 'centro', 5, (select c2 from _sec)),
  ((select dom from _ses), (select lomas from _s), 'centro', 29, (select c1 from _sec));
insert into _x select 'm2', public.obtener_mapa_sede((select catan from _c));
select is((select r->'sesiones'->0->'sectores' from _x where n = 'm2'),
  jsonb_build_array(jsonb_build_object('sector_id', (select c1 from _sec), 'agotado', true, 'asignado', 0),
                    jsonb_build_object('sector_id', (select c2 from _sec), 'agotado', false, 'asignado', 5)),
  'C1 agotado por otra sede: agotado true y asignado 0 para Catán; C2 asignado 5');
select is((select r->'sesiones'->1->'sectores'->0 from _x where n = 'm2'),
  jsonb_build_object('sector_id', (select c1 from _sec), 'agotado', false, 'asignado', 0),
  'agotado es por sesión: 29 de 30 en Dom no está agotado');
select is((select array_agg(distinct k order by k) from _x, jsonb_array_elements(r->'sesiones') s, jsonb_array_elements(s->'sectores') e, jsonb_object_keys(e) k where n = 'm2'),
  array['agotado', 'asignado', 'sector_id'], 'por sector sólo sector_id, agotado y asignado');
select is((select array_agg(k order by k) from _x, jsonb_object_keys(r) k where n = 'm2'),
  array['abierto', 'fecha_limite', 'preferencias', 'sectores', 'sede', 'sesiones', 'success'], 'el mapa tiene sólo las claves esperadas');
select is((select array_agg(k order by k) from _x, jsonb_array_elements(r->'sesiones') s, jsonb_object_keys(s) k where n = 'm2' and s->>'nombre' = 'Sáb T11'),
  array['id', 'inicio_at', 'nombre', 'sectores'], 'cada sesión tiene sólo id, nombre, inicio_at y sectores');
select ok(position((select lomas::text from _s) in (select r::text from _x where n = 'm2')) = 0
          and position('Lomas T11' in (select r::text from _x where n = 'm2')) = 0
          and position((select lomas from _c) in (select r::text from _x where n = 'm2')) = 0,
  'la respuesta de Catán no menciona a Lomas (id, nombre ni clave)');
select is(public.obtener_mapa_sede((select lomas from _c))->'sesiones'->0->'sectores'->0->>'asignado', '30', 'Lomas ve lo suyo: asignado 30');
-- una reserva de Etapa 2 (sector_id null) no cuenta
insert into public.reserva (sesion_id, sede_id, seccion, cantidad) values ((select dom from _ses), (select catan from _s), 'centro', 50);
select is(public.obtener_mapa_sede((select catan from _c))->'sesiones'->1->'sectores'->0->>'agotado', 'false', 'las reservas sin sector no agotan sectores');
-- la suma de varias sedes agota
insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id) values ((select dom from _ses), (select catan from _s), 'centro', 1, (select c1 from _sec));
select is(public.obtener_mapa_sede((select lomas from _c))->'sesiones'->1->'sectores'->0->>'agotado', 'true', 'la suma de todas las sedes (29 + 1 = capacidad) agota');
select is(public.obtener_mapa_sede((select lomas from _c))->'sesiones'->1->'sectores'->0->>'asignado', '29', 'y asignado de Lomas sigue siendo sólo lo suyo');

-- ---------------------------------------------------------------------------
-- guardar_preferencias
-- ---------------------------------------------------------------------------
select is(public.guardar_preferencias((select catan from _c), array[(select c1 from _sec)]), '{"success":true}'::jsonb, 'guarda');
select is((select array_agg(sector_id) from public.preferencia where sede_id = (select catan from _s)), array[(select c1 from _sec)], 'reemplaza (no acumula): quedó sólo C1');
select is((select count(*)::int from public.preferencia where sede_id = (select lomas from _s)), 1, 'no toca las preferencias de otra sede');
select is(public.guardar_preferencias((select catan from _c), array[(select c1 from _sec), (select c2 from _sec), (select c1 from _sec)])->>'success', 'true', 'acepta ids repetidos');
select is((select count(*)::int from public.preferencia where sede_id = (select catan from _s)), 2, 'los repetidos cuentan una vez');
select is(public.obtener_mapa_sede((select catan from _c))->'preferencias', jsonb_build_array((select c1 from _sec), (select c2 from _sec)), 'el mapa devuelve las preferencias guardadas');
select is(public.guardar_preferencias((select catan from _c), '{}'::bigint[])->>'success', 'true', 'acepta lista vacía');
select is((select count(*)::int from public.preferencia where sede_id = (select catan from _s)), 0, 'lista vacía borra las preferencias');
select is(public.guardar_preferencias((select catan from _c), array[(select c1 from _sec)]), '{"success":true}'::jsonb, 'vuelve a guardar');
select is(public.guardar_preferencias((select catan from _c), array[(select b1 from _sec)])->>'error', 'SECTOR_INVALIDO', 'sector de otro evento: SECTOR_INVALIDO');
select is(public.guardar_preferencias((select catan from _c), array[(select c2 from _sec), -1])->>'error', 'SECTOR_INVALIDO', 'sector inexistente: SECTOR_INVALIDO');
select is(public.guardar_preferencias((select catan from _c), null)->>'error', 'SECTOR_INVALIDO', 'arreglo nulo: SECTOR_INVALIDO');
select is(public.guardar_preferencias((select catan from _c), array[(select c2 from _sec), null]::bigint[])->>'error', 'SECTOR_INVALIDO', 'elemento nulo: SECTOR_INVALIDO');
select is((select array_agg(sector_id) from public.preferencia where sede_id = (select catan from _s)), array[(select c1 from _sec)], 'los rechazos no cambiaron nada');

-- ---------------------------------------------------------------------------
-- fecha límite: vencida, borde, futura, nula
-- ---------------------------------------------------------------------------
select public.guardar_fecha_limite((select sa from _k), now() - interval '1 second');
select is(public.guardar_preferencias((select catan from _c), array[(select c2 from _sec)])->>'error', 'FECHA_LIMITE_VENCIDA', 'vencida hace 1 s: FECHA_LIMITE_VENCIDA');
select is((select array_agg(sector_id) from public.preferencia where sede_id = (select catan from _s)), array[(select c1 from _sec)], 'y no guardó nada');
select is(public.obtener_mapa_sede((select catan from _c))->'abierto', 'false'::jsonb, 'vencida: abierto false');
select isnt(public.obtener_mapa_sede((select catan from _c))->'fecha_limite', 'null'::jsonb, 'el mapa trae la fecha límite');
-- borde: now() es el inicio de la transacción; clock_timestamp() ya lo pasó y el borde es estricto
select public.guardar_fecha_limite((select sa from _k), now());
select is(public.guardar_preferencias((select catan from _c), array[(select c2 from _sec)])->>'error', 'FECHA_LIMITE_VENCIDA', 'en el borde (fecha = instante ya alcanzado): rechaza');
select is(public.obtener_mapa_sede((select catan from _c))->'abierto', 'false'::jsonb, 'en el borde: abierto false');
select public.guardar_fecha_limite((select sa from _k), now() + interval '1 hour');
select is(public.guardar_preferencias((select catan from _c), array[(select c2 from _sec)])->>'success', 'true', 'fecha futura: guarda');
select is(public.obtener_mapa_sede((select catan from _c))->'abierto', 'true'::jsonb, 'fecha futura: abierto');
select public.guardar_fecha_limite((select sa from _k), null);
select is(public.guardar_preferencias((select catan from _c), array[(select c1 from _sec)])->>'success', 'true', 'fecha nula: guarda');

-- ---------------------------------------------------------------------------
-- Evento sin sectores, locks, claves de ujier / supervisor
-- ---------------------------------------------------------------------------
select is(public.obtener_mapa_sede((select catan_c from _c))->'sectores', '[]'::jsonb, 'evento sin sectores: sectores []');
select is(public.obtener_mapa_sede((select catan_c from _c))->'sesiones', '[]'::jsonb, 'evento sin sesiones: sesiones []');
select is(public.guardar_preferencias((select catan_c from _c), '{}'::bigint[])->>'success', 'true', 'evento sin sectores: lista vacía guarda');

create temp table _n (k text primary key, v integer);
insert into _n select 'base', pg_temp.nlock((select lomas from _s));
select public.obtener_mapa_sede((select lomas from _c));
insert into _n select 'mapa', pg_temp.nlock((select lomas from _s));
select public.guardar_preferencias((select lomas from _c), '{}'::bigint[]);
insert into _n select 'guardar', pg_temp.nlock((select lomas from _s));
select is((select v from _n where k = 'mapa'), (select v from _n where k = 'base'), 'obtener_mapa_sede no toma locks');
select is((select v from _n where k = 'guardar') - (select v from _n where k = 'base'), 1, 'guardar_preferencias toma el lock de la sede');

select throws_ok(format($f$select public.obtener_mapa_sede(%L)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'obtener_mapa_sede: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.obtener_mapa_sede(%L)$f$, (select sa from _k)), null, 'CLAVE_INVALIDA', 'obtener_mapa_sede: supervisor -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.guardar_preferencias(%L, '{}'::bigint[])$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'guardar_preferencias: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.guardar_preferencias(%L, '{}'::bigint[])$f$, (select sa from _k)), null, 'CLAVE_INVALIDA', 'guardar_preferencias: supervisor -> CLAVE_INVALIDA');
select throws_ok($f$select public.obtener_mapa_sede('')$f$, null, 'CLAVE_INVALIDA', 'obtener_mapa_sede: clave vacía');

select * from finish();
rollback;

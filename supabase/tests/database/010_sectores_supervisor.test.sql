-- Etapa 3 / Tarea 2: RPC de Supervisor para sectores, fecha límite, acceso por sede y mapa.
begin;
select plan(71);

select has_function('public', 'guardar_sectores', array['text', 'jsonb'], 'existe guardar_sectores');
select has_function('public', 'guardar_fecha_limite', array['text', 'timestamptz'], 'existe guardar_fecha_limite');
select has_function('public', 'generar_acceso_sede', array['text', 'uuid', 'boolean'], 'existe generar_acceso_sede');
select has_function('public', 'obtener_mapa_supervisor', array['text'], 'existe obtener_mapa_supervisor');

create function pg_temp.nlocks(p_evento uuid, p_seccion text)
returns integer language sql as $$
  select count(*)::int from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid()
     and ((classid::bigint << 32) | objid::bigint) = hashtextextended(p_evento::text || p_seccion, 0)
$$;

-- Datos: evento A con centro e izquierda de 9 filas x 10 (derecha sin filas); evento B aparte.
create temp table _r0 as select public.crear_evento('Sectores A') as a, public.crear_evento('Sectores B') as b;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ka, a->>'clave_supervisor' as sa,
         (b->>'evento_id')::uuid as eb, b->>'clave_supervisor' as sb
    from _r0;
select private.aplicar_plantilla((select ea from _k),
  (select jsonb_build_object(
            'centro', jsonb_agg(jsonb_build_object('numero', n, 'tramos', jsonb_build_array(jsonb_build_object('tipo', 'publico', 'capacidad', 10)))),
            'izquierda', jsonb_agg(jsonb_build_object('numero', n, 'tramos', jsonb_build_array(jsonb_build_object('tipo', 'publico', 'capacidad', 10)))))
     from generate_series(1, 9) n));
select private.aplicar_plantilla((select eb from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":10}]}]}'::jsonb);

insert into public.sede (nombre) values ('Catán T10'), ('Lomas T10');
create temp table _s as
  select (select id from public.sede where nombre = 'Catán T10') as catan,
         (select id from public.sede where nombre = 'Lomas T10') as lomas;

create temp table _x (n text primary key, r jsonb);

-- ---------------------------------------------------------------------------
-- guardar_sectores: caso válido (3 por sección sobre 9 filas)
-- ---------------------------------------------------------------------------
insert into _x select 'ok', public.guardar_sectores((select sa from _k),
  '[{"seccion":"centro","nombre":"C1","fila_desde":1,"fila_hasta":3},
    {"seccion":"centro","nombre":"C2","fila_desde":4,"fila_hasta":6},
    {"seccion":"centro","nombre":"C3","fila_desde":7,"fila_hasta":9},
    {"seccion":"izquierda","nombre":"I1","fila_desde":1,"fila_hasta":4},
    {"seccion":"izquierda","nombre":"I2","fila_desde":5,"fila_hasta":9}]'::jsonb);
select is((select r from _x where n = 'ok'), '{"success":true,"sectores":5}'::jsonb, 'guardar_sectores guarda 5 sectores');

insert into _x select 'mapa', public.obtener_mapa_supervisor((select sa from _k));
select is((select r->>'success' from _x where n = 'mapa'), 'true', 'obtener_mapa_supervisor: success');
select is(jsonb_array_length((select r->'sectores' from _x where n = 'mapa')), 5, 'el mapa trae los 5 sectores');
select is((select r->'sectores'->0->>'nombre' from _x where n = 'mapa'), 'I1', 'sectores ordenados: izquierda primero');
select is((select r->'sectores'->0->>'capacidad' from _x where n = 'mapa'), '40', 'capacidad de I1 (4 filas x 10)');
select is((select r->'sectores'->3->>'nombre' || ':' || (r->'sectores'->3->>'capacidad') || ':' || (r->'sectores'->3->>'fila_desde') || '-' || (r->'sectores'->3->>'fila_hasta') from _x where n = 'mapa'),
  'C2:30:4-6', 'capacidad y filas de C2');
select ok((select r->'sectores'->0 ? 'id' and r->'sectores'->0 ? 'seccion' from _x where n = 'mapa'), 'cada sector trae id y seccion');
select is((select count(*)::int from public.sector where evento_id = (select ea from _k)), 5, 'quedaron 5 sectores en la tabla');

-- ---------------------------------------------------------------------------
-- guardar_sectores: inválidos (nada cambia)
-- ---------------------------------------------------------------------------
create function pg_temp.sec(p_json text) returns jsonb language sql as $$
  select public.guardar_sectores((select sa from _k), p_json::jsonb)
$$;

select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"B","fila_desde":5,"fila_hasta":9}]')->>'error',
  'SECTORES_INVALIDOS', 'hueco: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"B","fila_desde":5,"fila_hasta":9}]')->'errores'->0->>'motivo',
  'Hueco en centro: faltan las filas 4 a 4', 'hueco: el motivo nombra las filas que faltan');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":4},{"seccion":"centro","nombre":"B","fila_desde":4,"fila_hasta":9}]')->>'error',
  'SECTORES_INVALIDOS', 'solape: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":4},{"seccion":"centro","nombre":"B","fila_desde":4,"fila_hasta":9}]')->'errores'->0->>'motivo',
  'Solape en centro: B empieza en la fila 4, ya cubierta', 'solape: el motivo nombra el sector y la fila');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":2,"fila_hasta":9}]')->>'error',
  'SECTORES_INVALIDOS', 'no empieza en la primera fila: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":8}]')->>'error',
  'SECTORES_INVALIDOS', 'no termina en la última fila: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":10}]')->>'error',
  'SECTORES_INVALIDOS', 'se pasa de la última fila: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":9},{"seccion":"centro","nombre":"B","fila_desde":3,"fila_hasta":2}]')->>'error',
  'SECTORES_INVALIDOS', 'fila_hasta < fila_desde: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"   ","fila_desde":1,"fila_hasta":9}]')->>'error',
  'SECTORES_INVALIDOS', 'nombre vacío: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"arriba","nombre":"A","fila_desde":1,"fila_hasta":9}]')->>'error',
  'SECTORES_INVALIDOS', 'sección inválida: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":5},{"seccion":"centro","nombre":" a ","fila_desde":6,"fila_hasta":9}]')->>'error',
  'SECTORES_INVALIDOS', 'nombres repetidos en la sección (sin mayúsculas): SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"derecha","nombre":"A","fila_desde":1,"fila_hasta":1}]')->>'error',
  'SECTORES_INVALIDOS', 'una sección sin filas no admite sectores');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":"x","fila_hasta":9}]')->>'error',
  'SECTORES_INVALIDOS', 'fila no numérica: SECTORES_INVALIDOS');
select is(pg_temp.sec('{"seccion":"centro"}')->>'error', 'SECTORES_INVALIDOS', 'no es un arreglo: SECTORES_INVALIDOS');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":9}]')->>'success', 'true',
  'un solo sector que cubre toda la sección: ok');
-- el mismo nombre en secciones distintas es válido
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":9},{"seccion":"izquierda","nombre":"A","fila_desde":1,"fila_hasta":9}]')->>'sectores',
  '2', 'mismo nombre en secciones distintas: ok');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"A","fila_desde":1,"fila_hasta":9},{"seccion":"centro","nombre":"B","fila_desde":3,"fila_hasta":2}]')->'errores'->>0 is not null, true,
  'los inválidos devuelven la lista de errores');

-- los rechazos no tocaron los sectores (quedan los 2 del último guardado ok)
select is((select count(*)::int from public.sector where evento_id = (select ea from _k)), 2, 'los rechazos no cambiaron nada');

-- ---------------------------------------------------------------------------
-- Preferencias: reemplazar sectores las borra en cascada
-- ---------------------------------------------------------------------------
select pg_temp.sec('[{"seccion":"centro","nombre":"C1","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"C2","fila_desde":4,"fila_hasta":9}]');
insert into public.preferencia (sede_id, sector_id)
  select (select catan from _s), id from public.sector where evento_id = (select ea from _k) and nombre = 'C1';
insert into public.preferencia (sede_id, sector_id)
  select (select lomas from _s), id from public.sector where evento_id = (select ea from _k);
select is((select r->'sedes' from (select public.obtener_mapa_supervisor((select sa from _k)) r) z
            ) @> jsonb_build_array(jsonb_build_object('sede_id', (select catan from _s))), true, 'el mapa lista la sede Catán');
select is((select jsonb_array_length(e->'preferencias') from jsonb_array_elements(public.obtener_mapa_supervisor((select sa from _k))->'sedes') e
            where e->>'sede_id' = (select catan::text from _s)), 1, 'Catán prefiere 1 sector');
select is((select jsonb_array_length(e->'preferencias') from jsonb_array_elements(public.obtener_mapa_supervisor((select sa from _k))->'sedes') e
            where e->>'sede_id' = (select lomas::text from _s)), 2, 'Lomas prefiere 2 sectores');

select pg_temp.sec('[{"seccion":"centro","nombre":"N1","fila_desde":1,"fila_hasta":9}]');
select is((select count(*)::int from public.preferencia where sede_id in ((select catan from _s), (select lomas from _s))), 0,
  'reemplazar sectores borra las preferencias en cascada');
select is((select count(*)::int from public.sector where evento_id = (select ea from _k)), 1, 'quedó sólo el sector nuevo');
select is((select count(*)::int from public.sector where evento_id = (select eb from _k)), 0, 'no tocó los sectores de otro evento');

-- ---------------------------------------------------------------------------
-- Asignaciones: con reservas ligadas a un sector no se puede reemplazar
-- ---------------------------------------------------------------------------
insert into public.sesion (evento_id, nombre, inicio_at) values ((select ea from _k), 'Sábado T10', now() + interval '2 hours');
-- una reserva de Etapa 2 (sector_id null) no cuenta como asignación
insert into public.reserva (sesion_id, sede_id, seccion, cantidad)
  values ((select id from public.sesion where nombre = 'Sábado T10'), (select lomas from _s), 'centro', 4);
select is(pg_temp.sec('[{"seccion":"centro","nombre":"N1","fila_desde":1,"fila_hasta":9}]')->>'success', 'true',
  'una reserva de Etapa 2 con sector_id null no bloquea guardar_sectores');
select is((select count(*)::int from public.reserva where sede_id = (select lomas from _s) and sector_id is null), 1, 'y esa reserva sigue intacta');
insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id)
  select (select id from public.sesion where nombre = 'Sábado T10'), (select catan from _s), 'centro', 6, id
    from public.sector where evento_id = (select ea from _k);
insert into public.preferencia (sede_id, sector_id) select (select catan from _s), id from public.sector where evento_id = (select ea from _k);

insert into _x select 'asig', pg_temp.sec('[{"seccion":"centro","nombre":"Z1","fila_desde":1,"fila_hasta":9}]');
select is((select r->>'error' from _x where n = 'asig'), 'SECTORES_CON_ASIGNACIONES', 'con reservas por sector: SECTORES_CON_ASIGNACIONES');
select is((select nombre from public.sector where evento_id = (select ea from _k)), 'N1', 'no cambió los sectores');
select is((select count(*)::int from public.preferencia where sede_id = (select catan from _s)), 1, 'ni las preferencias');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"Z1","fila_desde":1,"fila_hasta":8}]')->>'error', 'SECTORES_INVALIDOS',
  'la validación va antes que el chequeo de asignaciones');

select is((select r->'sesiones'->0->'asignado' from (select public.obtener_mapa_supervisor((select sa from _k)) r) z),
  (select jsonb_build_array(jsonb_build_object('sector_id', id, 'sede_id', (select catan from _s), 'cantidad', 6))
     from public.sector where evento_id = (select ea from _k)),
  'el mapa muestra lo asignado por sector');
select is((select r->'sesiones'->0->>'nombre' from (select public.obtener_mapa_supervisor((select sa from _k)) r) z), 'Sábado T10', 'el mapa trae la sesión');

-- ---------------------------------------------------------------------------
-- guardar_fecha_limite
-- ---------------------------------------------------------------------------
select is(public.guardar_fecha_limite((select sa from _k), '2030-01-01 10:00+00'), '{"success":true}'::jsonb, 'guardar_fecha_limite: ok');
select is((select fecha_limite from public.evento where id = (select ea from _k)), '2030-01-01 10:00+00'::timestamptz, 'la fecha quedó guardada');
select is((public.obtener_mapa_supervisor((select sa from _k))->>'fecha_limite')::timestamptz, '2030-01-01 10:00+00'::timestamptz, 'el mapa la devuelve');
select is(public.guardar_fecha_limite((select sa from _k), '2000-01-01 10:00+00')->>'success', 'true', 'una fecha pasada es válida');
select is(public.guardar_fecha_limite((select sa from _k), null)->>'success', 'true', 'null la borra');
select is((select fecha_limite from public.evento where id = (select ea from _k)), null, 'fecha_limite quedó en null');
select is(public.obtener_mapa_supervisor((select sa from _k))->'fecha_limite', 'null'::jsonb, 'el mapa devuelve fecha_limite null');
select is((select fecha_limite from public.evento where id = (select eb from _k)), null, 'no tocó otro evento');

-- ---------------------------------------------------------------------------
-- generar_acceso_sede
-- ---------------------------------------------------------------------------
insert into _x select 'a1', public.generar_acceso_sede((select sa from _k), (select catan from _s));
select ok((select (r->>'success')::boolean and length(r->>'clave') = 64 from _x where n = 'a1'), 'crea una clave de 64 caracteres');
select is((select clave from public.acceso_sede where evento_id = (select ea from _k) and sede_id = (select catan from _s)),
  (select r->>'clave' from _x where n = 'a1'), 'la clave quedó guardada');
select is(public.generar_acceso_sede((select sa from _k), (select catan from _s))->>'clave', (select r->>'clave' from _x where n = 'a1'),
  'repetir devuelve la misma clave');
insert into _x select 'a2', public.generar_acceso_sede((select sa from _k), (select catan from _s), true);
select isnt((select r->>'clave' from _x where n = 'a2'), (select r->>'clave' from _x where n = 'a1'), 'rotar da una clave nueva');
select is((select count(*)::int from public.acceso_sede where clave = (select r->>'clave' from _x where n = 'a1')), 0, 'la clave vieja deja de servir');
select is((select count(*)::int from public.acceso_sede where evento_id = (select ea from _k)), 1, 'sigue habiendo una sola fila por sede');
select is(public.generar_acceso_sede((select sa from _k), gen_random_uuid())->>'error', 'SEDE_INVALIDA', 'sede inexistente: SEDE_INVALIDA');
select is(public.generar_acceso_sede((select sa from _k), null)->>'error', 'SEDE_INVALIDA', 'sede null: SEDE_INVALIDA');
select is((select e->>'clave_acceso' from jsonb_array_elements(public.obtener_mapa_supervisor((select sa from _k))->'sedes') e
            where e->>'sede_id' = (select catan::text from _s)), (select r->>'clave' from _x where n = 'a2'), 'el mapa trae la clave de la sede');
select is((select e->'clave_acceso' from jsonb_array_elements(public.obtener_mapa_supervisor((select sa from _k))->'sedes') e
            where e->>'sede_id' = (select lomas::text from _s)), 'null'::jsonb, 'sin clave: clave_acceso null');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo in ('guardar_sectores', 'fecha_limite', 'acceso_sede')),
  11, 'se registraron los cambios (sectores, fecha límite, acceso)');

-- ---------------------------------------------------------------------------
-- Locks: sólo guardar_sectores toma los tres (evento nuevo, sin locks previos en la transacción)
-- ---------------------------------------------------------------------------
create temp table _c0 as select public.crear_evento('Locks C') as c;
create temp table _kc as select (c->>'evento_id')::uuid as ec, c->>'clave_supervisor' as sc from _c0;
create function pg_temp.nl(p_evento uuid) returns integer language sql as $$
  select pg_temp.nlocks(p_evento, 'izquierda') + pg_temp.nlocks(p_evento, 'centro') + pg_temp.nlocks(p_evento, 'derecha')
$$;
create temp table _n (k text primary key, v integer);
insert into _n select 'base', pg_temp.nl((select ec from _kc));
select public.obtener_mapa_supervisor((select sc from _kc));
insert into _n select 'mapa', pg_temp.nl((select ec from _kc));
select public.guardar_fecha_limite((select sc from _kc), now());
insert into _n select 'fecha', pg_temp.nl((select ec from _kc));
select public.generar_acceso_sede((select sc from _kc), (select catan from _s));
insert into _n select 'acceso', pg_temp.nl((select ec from _kc));
select public.guardar_sectores((select sc from _kc), '[]'::jsonb);
insert into _n select 'sectores', pg_temp.nl((select ec from _kc));
select is((select v from _n where k = 'mapa'), (select v from _n where k = 'base'), 'obtener_mapa_supervisor no toma locks');
select is((select v from _n where k = 'fecha'), (select v from _n where k = 'base'), 'guardar_fecha_limite no toma locks');
select is((select v from _n where k = 'acceso'), (select v from _n where k = 'base'), 'generar_acceso_sede no toma locks');
select is((select v from _n where k = 'sectores') - (select v from _n where k = 'base'), 3, 'guardar_sectores toma los tres locks de sección');

-- ---------------------------------------------------------------------------
-- Clave de ujier
-- ---------------------------------------------------------------------------
select throws_ok(format($f$select public.guardar_sectores(%L, '[]'::jsonb)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'guardar_sectores: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.guardar_fecha_limite(%L, null)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'guardar_fecha_limite: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.generar_acceso_sede(%L, gen_random_uuid())$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'generar_acceso_sede: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.obtener_mapa_supervisor(%L)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'obtener_mapa_supervisor: ujier -> CLAVE_INVALIDA');

select * from finish();
rollback;

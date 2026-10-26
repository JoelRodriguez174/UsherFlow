-- Etapa 3 / Tarea 1: sectores, preferencias, claves de acceso por sede y private.apartado agrupado.
begin;
select plan(33);

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select has_table('public', 'sector', 'existe public.sector');
select has_table('public', 'preferencia', 'existe public.preferencia');
select has_table('public', 'acceso_sede', 'existe public.acceso_sede');
select has_column('public', 'sector', 'fila_desde', 'sector.fila_desde existe');
select has_column('public', 'sector', 'fila_hasta', 'sector.fila_hasta existe');
select has_column('public', 'sector', 'orden', 'sector.orden existe');
select has_column('public', 'acceso_sede', 'clave', 'acceso_sede.clave existe');
select has_column('public', 'evento', 'fecha_limite', 'evento.fecha_limite existe');
select has_column('public', 'reserva', 'sector_id', 'reserva.sector_id existe');
select has_column('public', 'pendiente', 'sector_id', 'pendiente.sector_id existe');
select has_function('private', 'capacidad_sector', array['bigint'], 'existe private.capacidad_sector');
select has_function('private', 'apartado', array['uuid', 'text', 'uuid'], 'private.apartado conserva su firma');

-- Permisos, RLS y realtime
select ok(has_table_privilege('anon', 'public.sector', 'SELECT') and has_table_privilege('authenticated', 'public.sector', 'SELECT'), 'anon y authenticated leen sector');
select ok(not (has_table_privilege('anon', 'public.sector', 'INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', 'public.sector', 'INSERT,UPDATE,DELETE')), 'sector sin permisos de escritura');
select ok(not (has_table_privilege('anon', 'public.preferencia', 'SELECT') or has_table_privilege('authenticated', 'public.preferencia', 'SELECT')), 'preferencia sin SELECT');
select ok(not (has_table_privilege('anon', 'public.acceso_sede', 'SELECT') or has_table_privilege('authenticated', 'public.acceso_sede', 'SELECT')), 'acceso_sede sin SELECT');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.sector'::regclass, 'public.preferencia'::regclass, 'public.acceso_sede'::regclass)), 'las tres tablas tienen RLS activada');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'sector' and cmd = 'SELECT'), 2, 'sector: una policy de lectura por rol');
select is((select relreplident from pg_class where oid = 'public.sector'::regclass), 'f', 'sector REPLICA IDENTITY FULL');
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sector'),
  1, 'sector está en la publicación realtime');

-- ---------------------------------------------------------------------------
-- Datos: evento con centro de 4 filas x 10, sesión en 2 h, sedes Catán y Lomas
-- ---------------------------------------------------------------------------
create temp table _k as select public.crear_evento('Sectores') as e;
create temp table _c as select (e->>'evento_id')::uuid as ev, e->>'clave_ujier' as k from _k;
select private.aplicar_plantilla((select ev from _c),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":10}]},
              {"numero":2,"tramos":[{"tipo":"publico","capacidad":10}]},
              {"numero":3,"tramos":[{"tipo":"publico","capacidad":10}]},
              {"numero":4,"tramos":[{"tipo":"publico","capacidad":10}]}]}'::jsonb);

insert into public.sede (nombre) values ('Catán T9'), ('Lomas T9');
create temp table _s as
  select (select id from public.sede where nombre = 'Catán T9') as catan,
         (select id from public.sede where nombre = 'Lomas T9') as lomas;
insert into public.sesion (evento_id, nombre, inicio_at)
  values ((select ev from _c), 'Sábado T9', now() + interval '2 hours');
create temp table _ses as select id from public.sesion where nombre = 'Sábado T9';

insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
  values ((select ev from _c), 'centro', 'A', 2, 3, 1);
create temp table _sec as select id from public.sector where nombre = 'A' and evento_id = (select ev from _c);

-- capacidad_sector
select is(private.capacidad_sector((select id from _sec)), 20, 'capacidad_sector: filas 2-3 de 10 = 20');
update public.tramo set tipo = 'reservado', etiqueta = 'VIP'
 where fila_id = (select id from public.fila where evento_id = (select ev from _c) and numero = 3);
select is(private.capacidad_sector((select id from _sec)), 10, 'capacidad_sector descuenta un tramo reservado');

-- restricciones de sector
select throws_ok($$insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
  select ev, 'centro', 'Mal', 3, 2, 2 from _c$$, '23514', null, 'fila_hasta < fila_desde viola el check');
select throws_ok($$insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
  select ev, 'centro', 'A', 1, 1, 2 from _c$$, '23505', null, 'sector (evento, seccion, nombre) es único');

-- unicidad de reserva con nulls not distinct
insert into public.reserva (sesion_id, sede_id, seccion, cantidad)
  select (select id from _ses), (select catan from _s), 'centro', 3;
select throws_ok($$insert into public.reserva (sesion_id, sede_id, seccion, cantidad)
  select (select id from _ses), (select catan from _s), 'centro', 1$$, '23505', null, 'dos reservas sin sector de la misma sede/sección/sesión fallan');
select lives_ok($$insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id)
  select (select id from _ses), (select catan from _s), 'centro', 1, (select id from _sec)$$,
  'con sector distinto, otra reserva de la misma sede/sección entra');

-- ---------------------------------------------------------------------------
-- Regresión Review Focus 1: apartado agrupa por (sede, sección, sesión).
-- Centro con 10 libres (una sola fila); Catán con dos reservas de 3 (sector A y sector B).
-- ---------------------------------------------------------------------------
delete from public.reserva;
delete from public.fila where evento_id = (select ev from _c) and numero > 1;
insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
  values ((select ev from _c), 'centro', 'B', 1, 1, 2);
insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id)
  select (select id from _ses), (select catan from _s), 'centro', 3, id from public.sector where evento_id = (select ev from _c);
select is((select count(*)::int from public.reserva), 2, 'dos reservas de Catán en centro, una por sector');
select is(private.apartado((select ev from _c), 'centro', null), 6, 'sin consumo: apartado = 3 + 3');

create temp table _r (n text primary key, r jsonb);
insert into _r select 'g1', public.mandar_grupo((select k from _c), 'centro', 5);
select is((select r from _r where n = 'g1'), '{"success":false,"error":"SECCION_SIN_CUPO","libres":4}'::jsonb,
  'sin sede, 5 con 6 apartados: libres = 10 - 6 = 4');

insert into _r select 'g2', public.mandar_grupo((select k from _c), 'centro', 2, (select catan from _s));
select public.sentar_pendiente((select k from _c), (select (r->>'pendiente_id')::uuid from _r where n = 'g2'),
  (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (select ev from _c)));
select is(private.apartado((select ev from _c), 'centro', null), 4,
  'Catán sentó 2: el consumo se descuenta una vez por grupo (6 - 2 = 4, no 2)');

-- Casos de 006 con reservas sin sector
delete from public.reserva;
insert into public.reserva (sesion_id, sede_id, seccion, cantidad)
  select (select id from _ses), (select catan from _s), 'centro', 6
  union all select (select id from _ses), (select lomas from _s), 'centro', 2;
select is(private.apartado((select ev from _c), 'centro', null), 6, 'sin sector: (6 - 2) de Catán + 2 de Lomas');
select is(private.apartado((select ev from _c), 'centro', (select lomas from _s)), 4, 'excluyendo Lomas: solo lo de Catán (6 - 2)');
update public.sesion set inicio_at = now() + interval '10 minutes' where id = (select id from _ses);
select is(private.apartado((select ev from _c), 'centro', null), 0, 'dentro de la liberación, apartado = 0');

select * from finish();
rollback;

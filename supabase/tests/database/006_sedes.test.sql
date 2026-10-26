-- Etapa 2 / Tarea 1: reservas por sede, sesión en curso y mandar_grupo con sede.
begin;
select plan(48);

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select has_column('public', 'sesion', 'nombre', 'sesion.nombre existe');
select has_column('public', 'evento', 'liberacion_min', 'evento.liberacion_min existe');
select has_table('public', 'reserva', 'existe public.reserva');
select has_column('public', 'pendiente', 'sede_id', 'pendiente.sede_id existe');
select has_column('public', 'pendiente', 'sesion_id', 'pendiente.sesion_id existe');
select has_function('public', 'mandar_grupo', array['text', 'text', 'integer', 'uuid'], 'mandar_grupo tiene p_sede');
select hasnt_function('public', 'mandar_grupo', array['text', 'text', 'integer'], 'la versión de 3 argumentos ya no existe');
select has_function('private', 'sesion_en_curso', array['uuid'], 'existe private.sesion_en_curso');
select has_function('private', 'apartado', array['uuid', 'text', 'uuid'], 'existe private.apartado');
select ok((select relrowsecurity from pg_class where oid = 'public.reserva'::regclass), 'reserva tiene RLS activada');
select ok(not (has_table_privilege('anon', 'public.reserva', 'SELECT') or has_table_privilege('authenticated', 'public.reserva', 'SELECT')), 'anon y authenticated NO leen reserva (solo por RPC con clave)');
select ok(has_table_privilege('anon', 'public.sesion', 'SELECT') and has_table_privilege('authenticated', 'public.sesion', 'SELECT'), 'anon y authenticated leen sesion');
select ok(not (has_table_privilege('anon', 'public.reserva', 'INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', 'public.reserva', 'INSERT,UPDATE,DELETE')), 'reserva sin permisos de escritura');
select ok(not (has_table_privilege('anon', 'public.sesion', 'INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', 'public.sesion', 'INSERT,UPDATE,DELETE')), 'sesion sin permisos de escritura');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('reserva', 'sesion') and cmd = 'SELECT'), 2, 'solo sesion tiene policies de lectura (una por rol); reserva ninguna');
select is((select relreplident from pg_class where oid = 'public.reserva'::regclass), 'f', 'reserva REPLICA IDENTITY FULL');
select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('reserva', 'sesion')),
  1, 'solo sesion está en la publicación realtime (reserva avisa vía trigger que toca sesion)');
select ok(has_function_privilege('anon', 'public.mandar_grupo(text,text,integer,uuid)', 'EXECUTE'), 'anon puede ejecutar mandar_grupo');

-- ---------------------------------------------------------------------------
-- Datos: un evento, centro con 10 libres públicos, sesión "Sábado tarde" en 2 h,
-- reservas Catán centro 6 y Lomas centro 2.
-- ---------------------------------------------------------------------------
create temp table _k as select public.crear_evento('Sedes') as e;
create temp table _c as select (e->>'evento_id')::uuid as ev, e->>'clave_ujier' as k from _k;
select private.aplicar_plantilla((select ev from _c),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":10}]}]}'::jsonb);

insert into public.sede (nombre) values ('Catán T6'), ('Lomas T6');
create temp table _s as
  select (select id from public.sede where nombre = 'Catán T6') as catan,
         (select id from public.sede where nombre = 'Lomas T6') as lomas;

insert into public.sesion (evento_id, nombre, inicio_at)
  values ((select ev from _c), 'Sábado tarde', now() + interval '2 hours');
insert into public.reserva (sesion_id, sede_id, seccion, cantidad)
  select (select id from public.sesion where nombre = 'Sábado tarde'), (select catan from _s), 'centro', 6
  union all
  select (select id from public.sesion where nombre = 'Sábado tarde'), (select lomas from _s), 'centro', 2;

create temp table _r (n text primary key, r jsonb);

-- ---------------------------------------------------------------------------
-- Sin sede: 10 - 6 - 2 = 2
-- ---------------------------------------------------------------------------
insert into _r select 'a1', public.mandar_grupo((select k from _c), 'centro', 3);
select is((select r from _r where n = 'a1'), '{"success":false,"error":"SECCION_SIN_CUPO","libres":2}'::jsonb,
  'sin sede, 3 con 6+2 apartados: SECCION_SIN_CUPO con libres = 2');
insert into _r select 'a2', public.mandar_grupo((select k from _c), 'centro', 2);
select is((select r->>'success' from _r where n = 'a2'), 'true', 'sin sede, 2: entra');
select public.cancelar_pendiente((select k from _c), (select (r->>'pendiente_id')::uuid from _r where n = 'a2'));

-- ---------------------------------------------------------------------------
-- Ventana de liberación: faltan 10 min (< 20) => se ve todo libre
-- ---------------------------------------------------------------------------
update public.sesion set inicio_at = now() + interval '10 minutes' where nombre = 'Sábado tarde';
select is(private.apartado((select ev from _c), 'centro', null), 0, 'dentro de la liberación, apartado = 0');
insert into _r select 'w1', public.mandar_grupo((select k from _c), 'centro', 10);
select is((select r->>'success' from _r where n = 'w1'), 'true', 'dentro de la liberación, sin sede ve los 10 libres');
select public.cancelar_pendiente((select k from _c), (select (r->>'pendiente_id')::uuid from _r where n = 'w1'));
update public.sesion set inicio_at = now() + interval '2 hours' where nombre = 'Sábado tarde';

-- ---------------------------------------------------------------------------
-- Con sede: no descuenta el apartado propio
-- ---------------------------------------------------------------------------
insert into _r select 'c1', public.mandar_grupo((select k from _c), 'centro', 6, (select catan from _s));
select is((select r->>'success' from _r where n = 'c1'), 'true', 'Catán con 6: entra (solo descuenta el apartado de Lomas)');
select public.cancelar_pendiente((select k from _c), (select (r->>'pendiente_id')::uuid from _r where n = 'c1'));

-- ---------------------------------------------------------------------------
-- Review Focus 4: tras mandar 4, a Catán le quedan 2 apartados; llegan 3
-- ---------------------------------------------------------------------------
insert into _r select 'f1', public.mandar_grupo((select k from _c), 'centro', 4, (select catan from _s));
select is(private.apartado((select ev from _c), 'centro', null), 4, 'tras 4 de Catán: apartado = 2 (Catán) + 2 (Lomas)');
insert into _r select 'f2', public.mandar_grupo((select k from _c), 'centro', 3, (select catan from _s));
select is((select r->>'success' from _r where n = 'f2'), 'true', 'llegan 3 de Catán con 2 apartados: entra (10-4-2 = 4 >= 3)');
insert into _r select 'f3', public.mandar_grupo((select k from _c), 'centro', 2);
select is((select r from _r where n = 'f3'), '{"success":false,"error":"SECCION_SIN_CUPO","libres":1}'::jsonb,
  'luego, sin sede: libres = 10 - 7 - 2 = 1');

-- cancelar un grupo de Catán le vuelve a apartar sus lugares
select public.cancelar_pendiente((select k from _c), (select (r->>'pendiente_id')::uuid from _r where n = 'f2'));
insert into _r select 'f4', public.mandar_grupo((select k from _c), 'centro', 3);
select is((select r from _r where n = 'f4'), '{"success":false,"error":"SECCION_SIN_CUPO","libres":2}'::jsonb,
  'cancelar 3 de Catán: vuelve a apartarle 3 (libres = 10 - 4 - 2 - 2 = 2)');

-- uno sentado sigue contando
select public.sentar_pendiente((select k from _c), (select (r->>'pendiente_id')::uuid from _r where n = 'f1'),
  (select t.id from public.tramo t join public.fila f on f.id = t.fila_id where f.evento_id = (select ev from _c)));
insert into _r select 'f5', public.mandar_grupo((select k from _c), 'centro', 3);
select is((select r from _r where n = 'f5'), '{"success":false,"error":"SECCION_SIN_CUPO","libres":2}'::jsonb,
  'con los 4 de Catán sentados: siguen consumiendo (libres = 6 - 2 - 2 = 2)');

-- ---------------------------------------------------------------------------
-- Pendientes de otra sesión no cuentan como consumido
-- ---------------------------------------------------------------------------
insert into public.sesion (evento_id, nombre, inicio_at)
  values ((select ev from _c), 'Domingo', now() + interval '30 hours');
insert into public.pendiente (evento_id, seccion, cantidad, estado, sede_id, sesion_id)
  values ((select ev from _c), 'centro', 3, 'sentado', (select catan from _s),
          (select id from public.sesion where nombre = 'Domingo'));
select is(private.apartado((select ev from _c), 'centro', null), 4,
  'sentados de Catán de otra sesión no cuentan (apartado sigue 2 + 2)');

-- ---------------------------------------------------------------------------
-- obtener_estado_salon
-- ---------------------------------------------------------------------------
insert into _r select 'p1', public.mandar_grupo((select k from _c), 'centro', 1, (select catan from _s));
insert into _r select 'est', public.obtener_estado_salon((select k from _c));
select is((select (r #>> '{sesion,nombre}') from _r where n = 'est'), 'Sábado tarde', 'estado: sesión en curso');
select is(
  (select ((r #>> '{sesion,libera_at}')::timestamptz = (r #>> '{sesion,inicio_at}')::timestamptz - interval '20 minutes') from _r where n = 'est'),
  true, 'estado: libera_at = inicio_at - 20 min');
select is((select jsonb_array_length(r->'reservas') from _r where n = 'est'), 2, 'estado: dos reservas');
select is(
  (select e->>'sentados' from _r, jsonb_array_elements(r->'reservas') e where n = 'est' and e->>'sede' = 'Catán T6'),
  '4', 'estado: Catán sentados = 4 (no cuenta la otra sesión ni el pendiente)');
select is(
  (select e->>'cantidad' from _r, jsonb_array_elements(r->'reservas') e where n = 'est' and e->>'sede' = 'Catán T6' and e->>'seccion' = 'centro'),
  '6', 'estado: Catán cantidad = 6');
select is(
  (select e->>'sentados' from _r, jsonb_array_elements(r->'reservas') e where n = 'est' and e->>'sede' = 'Lomas T6'),
  '0', 'estado: Lomas sentados = 0');
select is(
  (select p->>'sede_id' from _r, jsonb_array_elements(r->'pendientes') p where n = 'est'),
  (select catan::text from _s), 'estado: el pendiente trae sede_id');
delete from public.pendiente where sesion_id = (select id from public.sesion where nombre = 'Domingo');
delete from public.sesion where nombre = 'Domingo';

-- ---------------------------------------------------------------------------
-- Errores
-- ---------------------------------------------------------------------------
select is(public.mandar_grupo((select k from _c), 'centro', 1, gen_random_uuid()),
  '{"success":false,"error":"SEDE_INVALIDA"}'::jsonb, 'sede inexistente: SEDE_INVALIDA');
select throws_ok($$select public.mandar_grupo('clave-mala', 'centro', 1, null)$$, null, 'CLAVE_INVALIDA', 'clave inválida lanza CLAVE_INVALIDA');

-- ---------------------------------------------------------------------------
-- Sesión en curso
-- ---------------------------------------------------------------------------
delete from public.sesion where evento_id = (select ev from _c);
select is(private.sesion_en_curso((select ev from _c)), null, 'sin sesiones: sesion_en_curso es null');
insert into _r select 'n1', public.obtener_estado_salon((select k from _c));
select is((select r->'sesion' from _r where n = 'n1'), 'null'::jsonb, 'sin sesiones: estado trae sesion null');
select is((select r->'reservas' from _r where n = 'n1'), '[]'::jsonb, 'sin sesiones: estado trae reservas []');
insert into _r select 'n2', public.mandar_grupo((select k from _c), 'centro', 1);
select is((select r->>'success' from _r where n = 'n2'), 'true', 'sin sesiones: mandar_grupo funciona como en la Etapa 1');
select is((select sesion_id from public.pendiente where id = (select (r->>'pendiente_id')::uuid from _r where n = 'n2')), null,
  'sin sesiones: el pendiente queda con sesion_id null');

insert into public.sesion (evento_id, nombre, inicio_at)
  values ((select ev from _c), 'Única pasada', now() - interval '4 hours');
select is(private.sesion_en_curso((select ev from _c)), null, 'única sesión 4 h en el pasado: null');
insert into _r select 'n3', public.obtener_estado_salon((select k from _c));
select is((select r->'sesion' from _r where n = 'n3'), 'null'::jsonb, 'sesión pasada: estado trae sesion null');
delete from public.sesion where evento_id = (select ev from _c);

insert into public.sesion (evento_id, nombre, inicio_at) values
  ((select ev from _c), 'Mañana', now() - interval '1 hour'),
  ((select ev from _c), 'Tarde', now() + interval '5 hours');
select is(private.sesion_en_curso((select ev from _c)), (select id from public.sesion where nombre = 'Mañana'),
  'mañana hace 1 h + tarde en 5 h: en curso la de la mañana');
update public.sesion set inicio_at = now() - interval '4 hours' where nombre = 'Mañana';
select is(private.sesion_en_curso((select ev from _c)), (select id from public.sesion where nombre = 'Tarde'),
  'mañana hace 4 h: en curso la de la tarde');
select throws_ok($$insert into public.sesion (evento_id, nombre, inicio_at)
  select evento_id, 'Tarde', now() from public.sesion where nombre = 'Tarde'$$, '23505', null, 'sesion.nombre es único por evento');

select * from finish();
rollback;

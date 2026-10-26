-- Etapa 3 / tanda final (F3b): guardar_sede crea sedes sin importar reservas.
begin;
select plan(15);

select has_function('public', 'guardar_sede', array['text', 'text'], 'existe guardar_sede');

create temp table _r0 as select public.crear_evento('Sede A') as a, public.crear_evento('Sede B') as b;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ka, a->>'clave_supervisor' as sa,
         (b->>'evento_id')::uuid as eb, b->>'clave_supervisor' as sb
    from _r0;
create temp table _x (n text primary key, r jsonb);

insert into _x select 'n', public.guardar_sede((select sa from _k), '  Catán T15  ');
select is((select (r->>'success')::boolean from _x where n = 'n'), true, 'crea la sede: success');
select is((select nombre from public.sede where id = (select (r->>'sede_id')::uuid from _x where n = 'n')), 'Catán T15', 'recorta el nombre');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'guardar_sede'), 1, 'queda en el registro');

-- idempotente, sin distinguir mayúsculas
insert into _x select 'm', public.guardar_sede((select sa from _k), 'CATÁN t15');
-- (lower() no unifica acentos distintos: "CATÁN" -> "catán", igual que "Catán")
select is((select r from _x where n = 'm'), (select r from _x where n = 'n'), 'mismo nombre con otras mayúsculas: devuelve la existente');
select is((select count(*)::int from public.sede where lower(nombre) = 'catán t15'), 1, 'no duplicó la sede');
select is((select count(*)::int from public.registro where evento_id = (select ea from _k) and tipo = 'guardar_sede'), 1, 'la repetición no registra de nuevo');

-- sede creada por otro evento: se reutiliza
insert into _x select 'b', public.guardar_sede((select sb from _k), 'catán T15');
select is((select r from _x where n = 'b'), (select r from _x where n = 'n'), 'la sede es global: otro evento obtiene la misma');

-- vacío / nulo
select is(public.guardar_sede((select sa from _k), '   '), '{"success":false,"error":"NOMBRE_INVALIDO"}'::jsonb, 'nombre vacío: NOMBRE_INVALIDO');
select is(public.guardar_sede((select sa from _k), null)->>'error', 'NOMBRE_INVALIDO', 'nombre nulo: NOMBRE_INVALIDO');
select is((select count(*)::int from public.sede where nombre = ''), 0, 'no creó sede vacía');

-- claves
select throws_ok(format($f$select public.guardar_sede(%L, 'X')$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'clave de ujier: CLAVE_INVALIDA');
select throws_ok($f$select public.guardar_sede('no-existe', 'X')$f$, null, 'CLAVE_INVALIDA', 'clave inexistente: CLAVE_INVALIDA');

-- privilegios
select ok(has_function_privilege('anon', 'public.guardar_sede(text, text)', 'EXECUTE'), 'anon puede ejecutar guardar_sede');
set local role anon;
select throws_ok($$select * from public.sede$$, '42501', null, 'anon sigue sin SELECT en sede');
reset role;

select * from finish();
rollback;

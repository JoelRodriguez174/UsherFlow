-- Sedes: se comparan sin distinguir acentos ni mayúsculas (Supervisor en rutas, §7d).
begin;
select plan(7);

select has_function('private', 'sin_acentos', array['text'], 'existe private.sin_acentos');

create temp table _r0 as select public.crear_evento('Sede acentos') as a;
create temp table _k as select (a->>'evento_id')::uuid as ea, a->>'clave_supervisor' as sa from _r0;
select private.aplicar_plantilla((select ea from _k),
  '{"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}]}'::jsonb);
select public.guardar_sesion((select sa from _k), 'Sesion T16', now() + interval '3 hours');

create temp table _x (n text primary key, r jsonb);

-- guardar_sede: misma sede con y sin acento
insert into _x select 'a', public.guardar_sede((select sa from _k), 'Catán T16');
insert into _x select 'b', public.guardar_sede((select sa from _k), 'catan t16');
select is((select r from _x where n = 'b'), (select r from _x where n = 'a'), 'guardar_sede: "catan" devuelve la misma sede que "Catán"');
select is((select count(*)::int from public.sede where private.sin_acentos(nombre) = 'catan t16'), 1, 'no duplicó la sede');

-- importar_reservas (simulado): sede existente con otra grafía no es nueva
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"CATAN T16","seccion":"izquierda","sesion":"Sesion T16","cantidad":1}]'::jsonb, true)->'sedes_nuevas',
  '[]'::jsonb, 'importar: "CATAN" matchea la sede "Catán" existente');

-- importar_reservas real: la reserva cuelga de la sede existente
select public.importar_reservas((select sa from _k),
  '[{"sede":"CATAN T16","seccion":"izquierda","sesion":"Sesion T16","cantidad":1}]'::jsonb);
select is((select count(*)::int from public.reserva where sede_id = (select (r->>'sede_id')::uuid from _x where n = 'a')), 1, 'importar: la reserva usa la sede existente');

-- fila repetida entre grafías
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Lomás T16","seccion":"izquierda","sesion":"Sesion T16","cantidad":1},
    {"sede":"lomas t16","seccion":"izquierda","sesion":"Sesion T16","cantidad":1}]'::jsonb)->'errores'->0->>'motivo',
  'Fila repetida: lomas t16, izquierda, Sesion T16', '"Lomás" y "lomas" en la misma sesión/sección: fila repetida');

-- unicidad en la tabla
select throws_ok($$insert into public.sede (nombre) values ('CATAN T16')$$, '23505', null, 'insert directo de "CATAN T16" viola la unicidad');

select * from finish();
rollback;

-- El pastor carga las reservas de su sede (guardar_reservas_sede / obtener_reservas_sede) y el Excel ya no pisa a las otras sedes.
begin;
select plan(17);

select has_function('public', 'guardar_reservas_sede', array['text', 'jsonb', 'text[]'], 'existe guardar_reservas_sede');
select has_function('public', 'obtener_reservas_sede', array['text'], 'existe obtener_reservas_sede');

-- Centro: 10 públicos. Dos sesiones.
create temp table _r0 as select public.crear_evento('Pastor reservas') as a;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_supervisor' as sa from _r0;
select private.aplicar_plantilla((select ea from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":10}]}]}'::jsonb);
select public.guardar_sesion((select sa from _k), 'Sab T17', now() + interval '3 hours');
select public.guardar_sesion((select sa from _k), 'Dom T17', now() + interval '1 day');

insert into public.sede (nombre) values ('Catan T17'), ('Lomas T17');
create temp table _s as
  select (select id from public.sede where nombre = 'Catan T17') as catan,
         (select id from public.sede where nombre = 'Lomas T17') as lomas;
create temp table _x (n text primary key, r jsonb);
insert into _x select 'c', public.generar_acceso_sede((select sa from _k), (select catan from _s));
create temp table _c as select (select r->>'clave' from _x where n = 'c') as catan;

-- Lomas la carga el supervisor; el pastor de Catán carga la suya.
select public.importar_reservas((select sa from _k),
  '[{"sede":"Lomas T17","seccion":"centro","sesion":"Sab T17","cantidad":4}]'::jsonb);

select is(public.guardar_reservas_sede((select catan from _c),
  '[{"seccion":"centro","sesion":"Sab T17","cantidad":5}]'::jsonb, '{"Sab T17"}'),
  '{"success":true,"sedes_nuevas":[],"reservas":1}'::jsonb, 'el pastor guarda su reserva');
select is(public.obtener_reservas_sede((select catan from _c))->'sesiones'->1->'reservas',
  '[{"seccion":"centro","cantidad":5}]'::jsonb, 'el pastor ve lo suyo');
select is(public.obtener_reservas_sede((select catan from _c))->'sesiones'->0->'reservas', '[]'::jsonb, 'y la otra sesión vacía');
select is((select count(*)::int from public.reserva where sede_id = (select lomas from _s)), 1, 'la reserva de Lomas sigue');
select is((select jsonb_agg(r->>'sede' order by r->>'sede')
             from jsonb_array_elements(public.obtener_reservas((select sa from _k))->'sesiones'->1->'reservas') r),
  '["Catan T17", "Lomas T17"]'::jsonb, 'el supervisor ve las reservas de las dos sedes');

-- El nombre de sede de las filas se ignora: no puede escribir en otra sede.
select public.guardar_reservas_sede((select catan from _c),
  '[{"sede":"Lomas T17","seccion":"centro","sesion":"Sab T17","cantidad":3}]'::jsonb, '{"Sab T17"}');
select is((select cantidad from public.reserva where sede_id = (select catan from _s)), 3, 'la fila quedó en la sede del pastor');
select is((select cantidad from public.reserva where sede_id = (select lomas from _s)), 4, 'Lomas no se tocó');

-- Capacidad: cuenta lo de las otras sedes (7 + 4 > 10).
select is(public.guardar_reservas_sede((select catan from _c),
  '[{"seccion":"centro","sesion":"Sab T17","cantidad":7}]'::jsonb, '{"Sab T17"}')->'errores'->0->>'motivo',
  'Excede la capacidad de centro en Sab T17: 11 > 10', 'la capacidad suma a las otras sedes');
select is((select cantidad from public.reserva where sede_id = (select catan from _s)), 3, 'el rechazo no escribió');

-- Excel/CSV del supervisor: sólo pisa las sedes que trae.
select public.importar_reservas((select sa from _k),
  '[{"sede":"Lomas T17","seccion":"centro","sesion":"Sab T17","cantidad":2}]'::jsonb);
select is((select cantidad from public.reserva where sede_id = (select lomas from _s)), 2, 'el Excel reemplazó a Lomas');
select is((select cantidad from public.reserva where sede_id = (select catan from _s)), 3, 'y no pisó a Catán');

-- Vaciar la propia sede.
select is(public.guardar_reservas_sede((select catan from _c), '[]'::jsonb, '{"Sab T17"}')->>'success', 'true', 'el pastor vacía su sesión');
select is((select count(*)::int from public.reserva where sede_id = (select catan from _s)), 0, 'Catán sin reservas');
select is((select count(*)::int from public.reserva where sede_id = (select lomas from _s)), 1, 'Lomas sigue');

-- Fecha límite vencida y claves ajenas.
update public.evento set fecha_limite = now() - interval '1 minute' where id = (select ea from _k);
select is(public.guardar_reservas_sede((select catan from _c),
  '[{"seccion":"centro","sesion":"Sab T17","cantidad":1}]'::jsonb, '{"Sab T17"}'),
  '{"success":false,"error":"FECHA_LIMITE_VENCIDA"}'::jsonb, 'vencida la fecha límite no se guarda');
select throws_ok(format($f$select public.guardar_reservas_sede(%L, '[]'::jsonb)$f$, (select sa from _k)), null, 'CLAVE_INVALIDA', 'la clave de supervisor no sirve');

select * from finish();
rollback;

-- Etapa 3 / tanda final (F1): guardar_sectores conserva las preferencias de los sectores cuyo rango no cambia.
begin;
select plan(15);

create temp table _r0 as select public.crear_evento('Conservar A') as a;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ka, a->>'clave_supervisor' as sa from _r0;
select private.aplicar_plantilla((select ea from _k),
  (select jsonb_build_object('centro', jsonb_agg(jsonb_build_object('numero', n, 'tramos', jsonb_build_array(jsonb_build_object('tipo', 'publico', 'capacidad', 10)))))
     from generate_series(1, 9) n));

insert into public.sede (nombre) values ('Catán T14'), ('Lomas T14');
create temp table _s as
  select (select id from public.sede where nombre = 'Catán T14') as catan,
         (select id from public.sede where nombre = 'Lomas T14') as lomas;

create function pg_temp.sec(p jsonb) returns jsonb language sql as $$
  select public.guardar_sectores((select sa from _k), p)
$$;
-- preferencias como "sede:rango" ordenadas, para comparar
create function pg_temp.prefs() returns text language sql as $$
  select coalesce(string_agg((case when p.sede_id = (select catan from _s) then 'catan' else 'lomas' end) || ':' || s.fila_desde || '-' || s.fila_hasta,
                             ',' order by s.fila_desde, p.sede_id = (select catan from _s) desc), '')
    from public.preferencia p join public.sector s on s.id = p.sector_id
   where s.evento_id = (select ea from _k)
$$;

select pg_temp.sec('[{"seccion":"centro","nombre":"C1","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"C2","fila_desde":4,"fila_hasta":6},{"seccion":"centro","nombre":"C3","fila_desde":7,"fila_hasta":9}]');
insert into public.preferencia (sede_id, sector_id)
  select (select catan from _s), id from public.sector where evento_id = (select ea from _k) and nombre in ('C1', 'C2');
insert into public.preferencia (sede_id, sector_id)
  select (select lomas from _s), id from public.sector where evento_id = (select ea from _k) and nombre = 'C2';
select is(pg_temp.prefs(), 'catan:1-3,catan:4-6,lomas:4-6', 'datos: 3 preferencias');

-- 1. Re-guardar los mismos sectores
select is(pg_temp.sec('[{"seccion":"centro","nombre":"C1","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"C2","fila_desde":4,"fila_hasta":6},{"seccion":"centro","nombre":"C3","fila_desde":7,"fila_hasta":9}]'),
  '{"success":true,"sectores":3}'::jsonb, 're-guardar los mismos sectores: ok');
select is(pg_temp.prefs(), 'catan:1-3,catan:4-6,lomas:4-6', 're-guardar los mismos sectores conserva todas las preferencias');

-- 2. Cambiar solo un nombre
select pg_temp.sec('[{"seccion":"centro","nombre":"Alfa","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"C2","fila_desde":4,"fila_hasta":6},{"seccion":"centro","nombre":"C3","fila_desde":7,"fila_hasta":9}]');
select is(pg_temp.prefs(), 'catan:1-3,catan:4-6,lomas:4-6', 'cambiar solo un nombre conserva las preferencias');
select is((select count(*)::int from public.preferencia p join public.sector s on s.id = p.sector_id where s.nombre = 'Alfa'), 1,
  'la preferencia quedó ligada al sector con el nombre nuevo');

-- 3. Cambiar el rango de un sector: caen solo las de ese
select pg_temp.sec('[{"seccion":"centro","nombre":"Alfa","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"C2","fila_desde":4,"fila_hasta":5},{"seccion":"centro","nombre":"C3","fila_desde":6,"fila_hasta":9}]');
select is(pg_temp.prefs(), 'catan:1-3', 'cambiar el rango de un sector borra solo las preferencias de ese');

-- 4. Sectores nuevos sin preferencia previa
select pg_temp.sec('[{"seccion":"centro","nombre":"Alfa","fila_desde":1,"fila_hasta":3},{"seccion":"centro","nombre":"Nuevo","fila_desde":4,"fila_hasta":9}]');
select is(pg_temp.prefs(), 'catan:1-3', 'un sector nuevo no recibe preferencias');
select is((select count(*)::int from public.sector where evento_id = (select ea from _k)), 2, 'quedaron 2 sectores');

-- 5. Partir un sector en dos: ninguna coincide
select pg_temp.sec('[{"seccion":"centro","nombre":"A1","fila_desde":1,"fila_hasta":1},{"seccion":"centro","nombre":"A2","fila_desde":2,"fila_hasta":9}]');
select is(pg_temp.prefs(), '', 'partir un sector borra sus preferencias');

-- 6. Otro evento: no se toca
create temp table _r1 as select public.crear_evento('Conservar B') as b;
create temp table _kb as select (b->>'evento_id')::uuid as eb, b->>'clave_supervisor' as sb from _r1;
select private.aplicar_plantilla((select eb from _kb),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":10}]},{"numero":2,"tramos":[{"tipo":"publico","capacidad":10}]}]}'::jsonb);
select public.guardar_sectores((select sb from _kb), '[{"seccion":"centro","nombre":"B1","fila_desde":1,"fila_hasta":2}]'::jsonb);
insert into public.preferencia (sede_id, sector_id) select (select catan from _s), id from public.sector where evento_id = (select eb from _kb);
select public.guardar_sectores((select sa from _k), '[{"seccion":"centro","nombre":"A1","fila_desde":1,"fila_hasta":9}]'::jsonb);
select is((select count(*)::int from public.preferencia p join public.sector s on s.id = p.sector_id where s.evento_id = (select eb from _kb)), 1,
  'guardar sectores de un evento no toca las preferencias de otro');
select public.guardar_sectores((select sb from _kb), '[{"seccion":"centro","nombre":"B1","fila_desde":1,"fila_hasta":2}]'::jsonb);
select is((select count(*)::int from public.preferencia p join public.sector s on s.id = p.sector_id where s.evento_id = (select eb from _kb)), 1,
  'y re-guardar el otro evento conserva la suya');

-- 7. Errores intactos
select throws_ok(format($f$select public.guardar_sectores(%L, '[]'::jsonb)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'clave de ujier: CLAVE_INVALIDA');
select is(pg_temp.sec('[{"seccion":"centro","nombre":"X","fila_desde":1,"fila_hasta":8}]')->>'error', 'SECTORES_INVALIDOS', 'sigue validando');

insert into public.sesion (evento_id, nombre, inicio_at) values ((select ea from _k), 'Sáb T14', now() + interval '2 hours');
insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id)
  select (select id from public.sesion where nombre = 'Sáb T14'), (select lomas from _s), 'centro', 6, id
    from public.sector where evento_id = (select ea from _k);
insert into public.preferencia (sede_id, sector_id) select (select lomas from _s), id from public.sector where evento_id = (select ea from _k);
select is(pg_temp.sec('[{"seccion":"centro","nombre":"Z","fila_desde":1,"fila_hasta":9}]')->>'error', 'SECTORES_CON_ASIGNACIONES', 'con reservas por sector: SECTORES_CON_ASIGNACIONES');
select is(pg_temp.prefs(), 'lomas:1-9', 'y no cambió las preferencias');

select * from finish();
rollback;

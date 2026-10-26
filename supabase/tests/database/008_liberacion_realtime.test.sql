-- Etapa 2 / correcciones finales: guardar_liberacion toca `sesion` para disparar realtime.
begin;
select plan(4);

create temp table _r as select public.crear_evento('Liberacion RT') as r;
create temp table _k as select (r->>'evento_id')::uuid as e, r->>'clave_supervisor' as s from _r;
insert into public.sesion (evento_id, nombre, inicio_at)
select e, 'Domingo', '2026-10-25 13:00+00' from _k;
create temp table _antes as select ctid::text as x from public.sesion where nombre = 'Domingo';

select is(public.guardar_liberacion((select s from _k), 45), '{"success":true}'::jsonb, 'guardar_liberacion ok');
select is((select inicio_at from public.sesion where nombre = 'Domingo'), '2026-10-25 13:00+00'::timestamptz, 'inicio_at no cambia');
select is((select liberacion_min from public.evento where id = (select e from _k)), 45, 'liberacion_min guardada');
select isnt((select ctid::text from public.sesion where nombre = 'Domingo'), (select x from _antes), 'la fila de sesion se reescribió (dispara realtime)');

select * from finish();
rollback;

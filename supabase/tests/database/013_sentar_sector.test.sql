-- Etapa 3 / Tarea 5: sentar_pendiente con sector (fuera_de_sector) y obtener_estado_salon ampliado.
begin;
select plan(38);

create function pg_temp.tr(p_ev uuid, p_seccion text, p_fila integer) returns bigint language sql as $$
  select t.id from public.tramo t join public.fila f on f.id = t.fila_id
   where f.evento_id = p_ev and f.seccion = p_seccion and f.numero = p_fila and t.tipo = 'publico' limit 1
$$;
create function pg_temp.sid(p_ev uuid, p_nombre text) returns bigint language sql as $$
  select id from public.sector where evento_id = p_ev and nombre = p_nombre
$$;

-- Centro: filas 1..4 de 6 públicos; izquierda: fila 1 de 6.
-- Sectores centro: Frente (fila 1, orden 1), Medio (fila 2, orden 2), Fondo (fila 3, orden 3); la fila 4 no tiene sector.
create temp table _r0 as select public.crear_evento('Sentar sector') as a;
create temp table _k as
  select (a->>'evento_id')::uuid as ev, a->>'clave_ujier' as ku, a->>'clave_supervisor' as ks from _r0;
select private.aplicar_plantilla((select ev from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":6}]},
              {"numero":2,"tramos":[{"tipo":"publico","capacidad":6}]},
              {"numero":3,"tramos":[{"tipo":"publico","capacidad":6}]},
              {"numero":4,"tramos":[{"tipo":"publico","capacidad":6}]}],
    "izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":6}]}]}'::jsonb);
insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
select ev, 'centro', v.n, v.d, v.d, v.o from _k, (values ('Frente', 1, 1), ('Medio', 2, 2), ('Fondo', 3, 3)) v(n, d, o);
insert into public.sesion (evento_id, nombre, inicio_at) select ev, 'Sábado', now() + interval '3 hours' from _k;
insert into public.sede (nombre) values ('Catán T13'), ('Lomas T13'), ('Sola T13');
create temp table _s as
  select (select id from public.sede where nombre = 'Catán T13') as catan,
         (select id from public.sede where nombre = 'Lomas T13') as lomas,
         (select id from public.sede where nombre = 'Sola T13') as sola;
-- Catán: Frente 4 + Medio 2 (6 en total); Lomas: centro entero 3; Sola: sin reservas.
insert into public.reserva (sesion_id, sede_id, seccion, cantidad, sector_id)
select ses.id, v.sede, 'centro', v.c, v.sec
  from (select id from public.sesion where nombre = 'Sábado' and evento_id = (select ev from _k)) ses, _s,
       (values (1, 4, pg_temp.sid((select ev from _k), 'Frente')),
               (1, 2, pg_temp.sid((select ev from _k), 'Medio')),
               (2, 3, null::bigint)) as v0(w, c, sec),
       lateral (select case v0.w when 1 then _s.catan else _s.lomas end as sede, v0.c, v0.sec) v;
select is((select count(*)::int from public.reserva r join _s on r.sede_id in (_s.catan, _s.lomas)), 3, 'datos: 3 reservas');

create temp table _x (n text primary key, r jsonb);
create temp table _p (n text primary key, id uuid);
-- Un pendiente por grupo.
insert into _p select 'g1', (public.mandar_grupo((select ku from _k), 'centro', 2, (select catan from _s))->>'pendiente_id')::uuid;
insert into _p select 'g2', (public.mandar_grupo((select ku from _k), 'centro', 2, (select catan from _s))->>'pendiente_id')::uuid;
insert into _p select 'g3', (public.mandar_grupo((select ku from _k), 'centro', 1, (select catan from _s))->>'pendiente_id')::uuid;
insert into _p select 'g4', (public.mandar_grupo((select ku from _k), 'centro', 2, (select lomas from _s))->>'pendiente_id')::uuid;
insert into _p select 'g5', (public.mandar_grupo((select ku from _k), 'centro', 1)->>'pendiente_id')::uuid;
insert into _p select 'g6', (public.mandar_grupo((select ku from _k), 'centro', 1, (select sola from _s))->>'pendiente_id')::uuid;
insert into _p select 'g7', (public.mandar_grupo((select ku from _k), 'izquierda', 1, (select catan from _s))->>'pendiente_id')::uuid;
insert into _p select 'g8', (public.mandar_grupo((select ku from _k), 'centro', 1, (select catan from _s))->>'pendiente_id')::uuid;
select is((select count(*)::int from _p), 8, 'datos: 8 pendientes creados');

-- Dentro del sector asignado: sin marca y con sector_id
insert into _x select 'g1', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g1'), pg_temp.tr((select ev from _k), 'centro', 1));
select is((select r from _x where n = 'g1'), '{"success":true}'::jsonb, 'sentar dentro del sector asignado: success sin marca');
select is((select sector_id from public.pendiente where id = (select id from _p where n = 'g1')),
  pg_temp.sid((select ev from _k), 'Frente'), 'pendiente.sector_id = Frente');

-- Fuera del sector (Fondo): marca y nombres de los sectores asignados, por orden
insert into _x select 'g2', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g2'), pg_temp.tr((select ev from _k), 'centro', 3));
select is((select r from _x where n = 'g2'), '{"success":true,"fuera_de_sector":true,"sectores":["Frente","Medio"]}'::jsonb,
  'sentar fuera: fuera_de_sector y nombres de los sectores de la sede');
select is((select sector_id from public.pendiente where id = (select id from _p where n = 'g2')),
  pg_temp.sid((select ev from _k), 'Fondo'), 'pendiente.sector_id = Fondo (donde se sentó)');
select is((select estado from public.pendiente where id = (select id from _p where n = 'g2')), 'sentado', 'y quedó sentado igual');

-- Efectos: sentados por sector no cambia; sentados_seccion sí
create temp table _e1 as select public.obtener_estado_salon((select ku from _k))->'reservas' as r;
select is((select e->>'sentados' from _e1, jsonb_array_elements(r) e where e->>'sector' = 'Frente'), '2', 'sentados de Frente: solo el grupo sentado en Frente');
select is((select e->>'sentados' from _e1, jsonb_array_elements(r) e where e->>'sector' = 'Medio'), '0', 'sentados de Medio: 0 (el que se sentó fuera no cuenta)');
select is((select e->>'sentados_seccion' from _e1, jsonb_array_elements(r) e where e->>'sector' = 'Frente'), '4', 'sentados_seccion de Frente: 4 (cuenta el sentado fuera)');
select is((select e->>'sentados_seccion' from _e1, jsonb_array_elements(r) e where e->>'sector' = 'Medio'), '4', 'sentados_seccion de Medio: 4 (misma sede y sección)');

-- Review focus 6: sentar fuera no descuenta aparte ni rompe el conteo de la sección
insert into _x select 'g3', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g3'), pg_temp.tr((select ev from _k), 'centro', 2));
select is((select r from _x where n = 'g3'), '{"success":true}'::jsonb, 'sentar en Medio (asignado): sin marca');
select is((select count(*)::int from public.pendiente where evento_id = (select ev from _k) and sede_id = (select catan from _s) and estado = 'sentado'), 3, 'Catán tiene 3 grupos sentados');
select is(private.apartado((select ev from _k), 'centro', (select lomas from _s)), 0,
  'apartado de Catán (sin Lomas) = 6 - (5 sentados dentro y fuera + 1 pendiente g8) = 0: se descuenta una sola vez de la sección');
select is(private.apartado((select ev from _k), 'centro', (select sola from _s)), 1,
  'con Lomas: 0 de Catán + (3 - 2 pendiente g4) = 1');
create temp table _e2 as select public.obtener_estado_salon((select ku from _k))->'reservas' as r;
select is((select e->>'sentados' from _e2, jsonb_array_elements(r) e where e->>'sector' = 'Medio'), '1', 'sentados de Medio: 1');
select is((select e->>'sentados_seccion' from _e2, jsonb_array_elements(r) e where e->>'sector' = 'Medio'), '5', 'sentados_seccion: 5 (2 + 2 + 1)');

-- Reserva de sección entera: sin marca; guarda el sector donde se sentó; sentados por sección
insert into _x select 'g4', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g4'), pg_temp.tr((select ev from _k), 'centro', 3));
select is((select r from _x where n = 'g4'), '{"success":true}'::jsonb, 'reserva sin sector (sección entera): nunca marca');
select is((select sector_id from public.pendiente where id = (select id from _p where n = 'g4')),
  pg_temp.sid((select ev from _k), 'Fondo'), 'y guarda igual el sector del asiento');
select is((select e->>'sentados' || '/' || (e->>'sentados_seccion') || '/' || coalesce(e->>'sector_id', 'null') || '/' || coalesce(e->>'sector', 'null')
             || '/' || coalesce(e->>'fila_desde', 'null')
             from jsonb_array_elements(public.obtener_estado_salon((select ku from _k))->'reservas') e where e->>'sede' = 'Lomas T13'),
  '2/2/null/null/null', 'reserva sin sector: sentados por sección, sector_id/sector/fila_desde nulos');

-- Sin sede, sede sin reservas: sin marca
insert into _x select 'g5', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g5'), pg_temp.tr((select ev from _k), 'centro', 2));
select is((select r from _x where n = 'g5'), '{"success":true}'::jsonb, 'sin sede: sin marca');
insert into _x select 'g6', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g6'), pg_temp.tr((select ev from _k), 'centro', 1));
select is((select r from _x where n = 'g6'), '{"success":true}'::jsonb, 'sede sin reservas: sin marca');

-- Sede con reservas con sector, pero en otra sección: sin marca y sector null (izquierda no tiene sectores)
insert into _x select 'g7', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g7'), pg_temp.tr((select ev from _k), 'izquierda', 1));
select is((select r from _x where n = 'g7'), '{"success":true}'::jsonb, 'sección sin reservas con sector para la sede: sin marca');
select is((select sector_id from public.pendiente where id = (select id from _p where n = 'g7')), null, 'fila sin sector definido: sector_id nulo');

-- Fila fuera de todo sector (fila 4) con la sede que tiene sectores: fuera, sector null
insert into _x select 'g8', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g8'), pg_temp.tr((select ev from _k), 'centro', 4));
select is((select r from _x where n = 'g8'), '{"success":true,"fuera_de_sector":true,"sectores":["Frente","Medio"]}'::jsonb,
  'fila sin sector, sede con sectores: fuera_de_sector');
select is((select sector_id from public.pendiente where id = (select id from _p where n = 'g8')), null, 'y sector_id nulo');

-- Registro confirmacion: detalle con sector_id y fuera_de_sector
select is((select (detalle->>'fuera_de_sector') || '/' || (detalle->>'sector_id')
             from public.registro where tipo = 'confirmacion' and detalle->>'pendiente_id' = (select id::text from _p where n = 'g2')),
  'true/' || pg_temp.sid((select ev from _k), 'Fondo'), 'registro confirmacion: fuera_de_sector y sector_id');
select is((select detalle->>'fuera_de_sector' from public.registro where tipo = 'confirmacion' and detalle->>'pendiente_id' = (select id::text from _p where n = 'g1')),
  'false', 'registro confirmacion: fuera_de_sector false dentro del sector');
select is((select detalle->'sector_id' from public.registro where tipo = 'confirmacion' and detalle->>'pendiente_id' = (select id::text from _p where n = 'g8')),
  'null'::jsonb, 'registro confirmacion: sector_id null cuando no hay sector');

-- obtener_estado_salon: sectores y campos nuevos
select is((select public.obtener_estado_salon((select ku from _k))->'sectores'),
  (select jsonb_agg(jsonb_build_object('id', s.id, 'seccion', s.seccion, 'nombre', s.nombre,
                                        'fila_desde', s.fila_desde, 'fila_hasta', s.fila_hasta, 'orden', s.orden) order by s.orden)
     from public.sector s where s.evento_id = (select ev from _k)), 'obtener_estado_salon incluye sectores');
select is((select e - 'sentados' - 'sentados_seccion' from jsonb_array_elements(public.obtener_estado_salon((select ku from _k))->'reservas') e
            where e->>'sector' = 'Frente'),
  jsonb_build_object('sede_id', (select catan from _s), 'sede', 'Catán T13', 'seccion', 'centro', 'cantidad', 4,
                     'sector_id', pg_temp.sid((select ev from _k), 'Frente'), 'sector', 'Frente', 'fila_desde', 1, 'fila_hasta', 1),
  'cada reserva con sector trae sector_id, sector, fila_desde y fila_hasta');
select is((select jsonb_agg(e->>'sector') from jsonb_array_elements(public.obtener_estado_salon((select ku from _k))->'reservas') e),
  '["Frente","Medio",null]'::jsonb, 'reservas ordenadas por sede, sección y sector');

-- Errores intactos y sin efectos de sector
insert into _x select 'rep', public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g1'), pg_temp.tr((select ev from _k), 'centro', 1));
select is((select r from _x where n = 'rep'), '{"success":false,"error":"PENDIENTE_YA_RESUELTO"}'::jsonb, 'sentar dos veces: PENDIENTE_YA_RESUELTO');
insert into _p select 'g9', (public.mandar_grupo((select ku from _k), 'centro', 1, (select catan from _s))->>'pendiente_id')::uuid;
select is(public.sentar_pendiente((select ku from _k), (select id from _p where n = 'g9'), pg_temp.tr((select ev from _k), 'izquierda', 1))->>'error',
  'SECCION_INCORRECTA', 'tramo de otra sección: SECCION_INCORRECTA');
select is((select sector_id from public.pendiente where id = (select id from _p where n = 'g9')), null, 'un rechazo no deja sector_id');

-- Evento sin sectores: sentar con sede y reserva de sección entera -> sin marca
create temp table _r1 as select public.crear_evento('Sin sectores T13') as a;
select private.aplicar_plantilla(((select a from _r1)->>'evento_id')::uuid,
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":6}]}]}'::jsonb);
insert into public.sesion (evento_id, nombre, inicio_at) select ((select a from _r1)->>'evento_id')::uuid, 'Domingo', now() + interval '3 hours';
insert into public.reserva (sesion_id, sede_id, seccion, cantidad)
select s.id, (select catan from _s), 'centro', 4 from public.sesion s where s.nombre = 'Domingo' and s.evento_id = ((select a from _r1)->>'evento_id')::uuid;
create temp table _q as select (public.mandar_grupo((select a->>'clave_ujier' from _r1), 'centro', 2, (select catan from _s))->>'pendiente_id')::uuid as id;
select is(public.sentar_pendiente((select a->>'clave_ujier' from _r1), (select id from _q),
  pg_temp.tr(((select a from _r1)->>'evento_id')::uuid, 'centro', 1)), '{"success":true}'::jsonb, 'evento sin sectores: sin marca');
select is(public.obtener_estado_salon((select a->>'clave_ujier' from _r1))->'sectores', '[]'::jsonb, 'evento sin sectores: sectores vacío');
select ok(has_function_privilege('anon', 'public.sentar_pendiente(text,uuid,bigint)', 'EXECUTE')
          and has_function_privilege('anon', 'public.obtener_estado_salon(text)', 'EXECUTE')
          and not has_function_privilege('public', 'public.sentar_pendiente(text,uuid,bigint)', 'EXECUTE'),
  'grants intactos: anon ejecuta, public no');

select * from finish();
rollback;

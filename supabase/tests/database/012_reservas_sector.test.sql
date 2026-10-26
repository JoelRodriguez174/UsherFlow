-- Etapa 3 / Tarea 4: importar_reservas y obtener_reservas con sector.
begin;
select plan(35);

create function pg_temp.nlocks(p_evento uuid, p_seccion text)
returns integer language sql as $$
  select count(*)::int from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid()
     and ((classid::bigint << 32) | objid::bigint) = hashtextextended(p_evento::text || p_seccion, 0)
$$;

-- Centro: 2 filas de 5 públicos (+ 2 reservados en la fila 1 que no cuentan) = 10; izquierda: 1 fila de 4.
create temp table _r0 as select public.crear_evento('Reservas sector') as a;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_supervisor' as sa from _r0;
select private.aplicar_plantilla((select ea from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":5},{"tipo":"reservado","capacidad":2,"etiqueta":"Pastores"}]},
              {"numero":2,"tramos":[{"tipo":"publico","capacidad":5}]}],
    "izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}]}'::jsonb);
-- Directo en la tabla (guardar_sectores toma los locks de sección y falsearía las pruebas de locks).
insert into public.sector (evento_id, seccion, nombre, fila_desde, fila_hasta, orden)
select ea, v.seccion, v.nombre, v.d, v.h, v.o from _k,
  (values ('centro', 'Frente', 1, 1, 1), ('centro', 'Fondo', 2, 2, 2), ('izquierda', 'Única', 1, 1, 3)) v(seccion, nombre, d, h, o);
select public.guardar_sesion((select sa from _k), 'Sábado', now() + interval '3 hours');

create temp table _x (n text primary key, r jsonb);
create temp table _antes as select count(*)::int n from public.reserva;

-- Simular: valida igual, no escribe y no toma locks (se prueba primero: el resto sí los toma)
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"izquierda","sesion":"Sábado","cantidad":2,"sector":"unica"}]'::jsonb, true),
  '{"success":true,"sedes_nuevas":["Catán"],"reservas":1}'::jsonb, 'simular con sector (sin acentos) devuelve éxito');
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":1,"sector":"Nada"}]'::jsonb, true)->'errores'->0->>'motivo',
  'Sector inexistente: Nada', 'simular también valida el sector');
select is((select count(*)::int from public.reserva) || '/' || (select count(*)::int from public.sede where nombre = 'Catán'),
  (select n from _antes) || '/0', 'simular no escribe reservas ni sedes');
select is(pg_temp.nlocks((select ea from _k), 'centro') + pg_temp.nlocks((select ea from _k), 'izquierda')
          + pg_temp.nlocks((select ea from _k), 'derecha'), 0, 'simular no toma locks');

-- ---------------------------------------------------------------------------
-- Rechazos (ninguno escribe) y simular
-- ---------------------------------------------------------------------------
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":1,"sector":"Frente"},
    {"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":1,"sector":"Nada"}]'::jsonb)->'errores',
  '[{"fila":2,"motivo":"Sector inexistente: Nada"}]'::jsonb, 'sector inexistente: motivo exacto en su fila');
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":1,"sector":"Única"}]'::jsonb)->'errores'->0->>'motivo',
  'Sector inexistente: Única', 'el sector se busca dentro de la sección (Única es de izquierda)');
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":1},
    {"sede":"catán","seccion":"centro","sesion":"Sábado","cantidad":1,"sector":"Frente"}]'::jsonb)->'errores',
  '[{"fila":1,"motivo":"Mezcla de sector y sección entera: Catán, centro, Sábado"}]'::jsonb,
  'mezcla de sector y sección entera de la misma sede/sección/sesión: rechazada');
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":3,"sector":"Frente"},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado","cantidad":3,"sector":"frente"}]'::jsonb)->'errores',
  '[{"fila":1,"motivo":"Excede la capacidad del sector Frente en Sábado: 6 > 5"}]'::jsonb,
  'excede la capacidad del sector (5): suma de todas las sedes, nombre canónico del sector');
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":1,"sector":"Frente"},
    {"sede":"CATÁN","seccion":"centro","sesion":"sabado","cantidad":1,"sector":"FRENTE"}]'::jsonb)->'errores',
  '[{"fila":2,"motivo":"Fila repetida: CATÁN, centro, sabado"}]'::jsonb,
  'repetida (sede, sección, sesión, sector): error en la fila 2');
select is(jsonb_array_length(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":5,"sector":"Frente"},
    {"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":5,"sector":"Fondo"},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado","cantidad":1}]'::jsonb)->'errores'), 1,
  'cada sector cabe pero la sección no: un solo error');
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":5,"sector":"Frente"},
    {"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":5,"sector":"Fondo"},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado","cantidad":1}]'::jsonb)->'errores'->0->>'motivo',
  'Excede la capacidad de centro en Sábado: 11 > 10', 'la capacidad de la sección suma todas las filas, con o sin sector');
select is((select count(*)::int from public.reserva), (select n from _antes), 'los rechazos no escribieron');
select is((select count(*)::int from public.sede where nombre in ('Catán', 'Lomas')), 0, 'ni crearon sedes');

-- ---------------------------------------------------------------------------
-- Importación válida con sectores
-- ---------------------------------------------------------------------------
insert into _x select 'ok', public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":3,"sector":"frente"},
    {"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":2,"sector":"FONDO"},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado","cantidad":2,"sector":"Frente"},
    {"sede":"Lomas","seccion":"izquierda","sesion":"Sábado","cantidad":4,"sector":"UNICA"}]'::jsonb);
select is((select r from _x where n = 'ok'), '{"success":true,"sedes_nuevas":["Catán","Lomas"],"reservas":4}'::jsonb,
  'la misma sede en dos sectores de la misma sección es válida');
select is(pg_temp.nlocks((select ea from _k), 'izquierda')::text || pg_temp.nlocks((select ea from _k), 'centro')::text
          || pg_temp.nlocks((select ea from _k), 'derecha')::text, '111', 'al escribir toma los tres locks de sección');
select is((select count(*)::int from public.reserva r join public.sector s on s.id = r.sector_id), 4, 'las 4 reservas quedaron con sector_id');
select is((select r.cantidad from public.reserva r join public.sede sd on sd.id = r.sede_id join public.sector s on s.id = r.sector_id
            where sd.nombre = 'Catán' and s.nombre = 'Frente'), 3, 'Catán en Frente: 3');
select is((select r.cantidad from public.reserva r join public.sede sd on sd.id = r.sede_id join public.sector s on s.id = r.sector_id
            where sd.nombre = 'Catán' and s.nombre = 'Fondo'), 2, 'Catán en Fondo: 2');
select is((select s.nombre from public.reserva r join public.sector s on s.id = r.sector_id
            join public.sede sd on sd.id = r.sede_id where sd.nombre = 'Lomas' and r.seccion = 'izquierda'), 'Única',
  'el nombre del sector se resuelve sin acentos ni mayúsculas');

-- obtener_reservas
select is(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas',
  '[{"sede":"Catán","seccion":"centro","cantidad":3,"sector":"Frente"},
    {"sede":"Catán","seccion":"centro","cantidad":2,"sector":"Fondo"},
    {"sede":"Lomas","seccion":"izquierda","cantidad":4,"sector":"Única"},
    {"sede":"Lomas","seccion":"centro","cantidad":2,"sector":"Frente"}]'::jsonb,
  'obtener_reservas devuelve el nombre del sector en cada reserva');
select is(public.obtener_reservas((select sa from _k))->'sectores',
  (select jsonb_agg(jsonb_build_object('id', s.id, 'seccion', s.seccion, 'nombre', s.nombre,
                                        'fila_desde', s.fila_desde, 'fila_hasta', s.fila_hasta)
                    order by array_position(array['izquierda', 'centro', 'derecha'], s.seccion), s.orden, s.id)
     from public.sector s where s.evento_id = (select ea from _k)),
  'obtener_reservas devuelve sectores en la raíz');
select is(jsonb_array_length(public.obtener_reservas((select sa from _k))->'sectores'), 3, 'son los 3 sectores del evento');

-- Reemplazo: reimportar la sesión sin sectores (compatibilidad Etapa 2) pisa las reservas con sector.
insert into _x select 'legacy', public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":6},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado","cantidad":4}]'::jsonb);
select is((select r from _x where n = 'legacy'), '{"success":true,"sedes_nuevas":[],"reservas":2}'::jsonb,
  'sin columna sector funciona como en la Etapa 2');
select is((select count(*)::int from public.reserva where sector_id is null), 2, 'esas reservas quedan sin sector (toda la sección)');
select is((select count(*)::int from public.reserva), 2, 'y reemplazaron las que tenían sector');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas'->0->>'sector', null, 'sin sector: sector nulo/ausente');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas'->0->>'cantidad', '6', 'y la cantidad se mantiene');

-- Mezcla entre sedes distintas es válida: Catán por sector, Lomas toda la sección.
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado","cantidad":3,"sector":"Frente"},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado","cantidad":4}]'::jsonb)->>'success', 'true',
  'una sede por sector y otra por sección entera: válido');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas',
  '[{"sede":"Catán","seccion":"centro","cantidad":3,"sector":"Frente"},{"sede":"Lomas","seccion":"centro","cantidad":4}]'::jsonb,
  'obtener_reservas mezcla ambas formas');

-- Vaciar con p_sesiones sigue funcionando.
select is(public.importar_reservas((select sa from _k), '[]'::jsonb, false, '{sabado}')->>'success', 'true', 'vaciar con p_sesiones');
select is((select count(*)::int from public.reserva), 0, 'quedó sin reservas');

-- Etapa 2: sin sectores definidos todo sigue igual.
create temp table _r1 as select public.crear_evento('Sin sectores') as a;
select private.aplicar_plantilla(((select a from _r1)->>'evento_id')::uuid,
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":6}]}]}'::jsonb);
select public.guardar_sesion((select a->>'clave_supervisor' from _r1), 'Domingo', now() + interval '3 hours');
select is(public.importar_reservas((select a->>'clave_supervisor' from _r1),
  '[{"sede":"Catán","seccion":"centro","sesion":"Domingo","cantidad":6}]'::jsonb)->>'success', 'true',
  'evento sin sectores: importa por sección');
select is(public.importar_reservas((select a->>'clave_supervisor' from _r1),
  '[{"sede":"Catán","seccion":"centro","sesion":"Domingo","cantidad":6,"sector":"Frente"}]'::jsonb)->'errores'->0->>'motivo',
  'Sector inexistente: Frente', 'evento sin sectores: un sector es inexistente (y no ve los de otro evento)');
select is(public.obtener_reservas((select a->>'clave_supervisor' from _r1))->'sectores', '[]'::jsonb, 'sin sectores: sectores vacío');
select is(public.obtener_reservas((select a->>'clave_supervisor' from _r1))->'sesiones'->0->'reservas',
  '[{"sede":"Catán","seccion":"centro","cantidad":6}]'::jsonb, 'sin sectores: reservas como en la Etapa 2');

select * from finish();
rollback;

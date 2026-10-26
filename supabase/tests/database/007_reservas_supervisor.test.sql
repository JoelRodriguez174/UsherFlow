-- Etapa 2 / Tarea 7: RPC de Supervisor para sesiones y reservas.
begin;
select plan(50);

select has_function('public', 'guardar_sesion', array['text', 'text', 'timestamptz'], 'existe guardar_sesion');
select has_function('public', 'borrar_sesion', array['text', 'uuid'], 'existe borrar_sesion');
select has_function('public', 'guardar_liberacion', array['text', 'integer'], 'existe guardar_liberacion');
select has_function('public', 'obtener_reservas', array['text'], 'existe obtener_reservas');
select has_function('public', 'importar_reservas', array['text', 'jsonb', 'boolean', 'text[]'], 'existe importar_reservas');

create function pg_temp.nlocks(p_evento uuid, p_seccion text)
returns integer language sql as $$
  select count(*)::int from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid()
     and ((classid::bigint << 32) | objid::bigint) = hashtextextended(p_evento::text || p_seccion, 0)
$$;

-- Datos: centro con 10 públicos (+4 reservados que NO cuentan), izquierda con 4 públicos.
create temp table _r0 as select public.crear_evento('Reservas A') as a, public.crear_evento('Reservas B') as b;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ka, a->>'clave_supervisor' as sa,
         (b->>'evento_id')::uuid as eb, b->>'clave_supervisor' as sb
    from _r0;
select private.aplicar_plantilla((select ea from _k),
  '{"centro":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":6},{"tipo":"reservado","capacidad":4,"etiqueta":"Pastores"},{"tipo":"publico","capacidad":4}]}],
    "izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":4}]}]}'::jsonb);

create temp table _x (n text primary key, r jsonb);

-- ---------------------------------------------------------------------------
-- guardar_sesion
-- ---------------------------------------------------------------------------
insert into _x select 'm', public.guardar_sesion((select sa from _k), 'Sábado mañana', now() + interval '3 hours');
insert into _x select 't1', public.guardar_sesion((select sa from _k), 'Sábado tarde', now() + interval '5 hours');
insert into _x select 't2', public.guardar_sesion((select sa from _k), 'Sábado tarde', now() + interval '6 hours');
select is((select r->>'success' from _x where n = 't1'), 'true', 'guardar_sesion crea la sesión');
select is((select r->>'sesion_id' from _x where n = 't2'), (select r->>'sesion_id' from _x where n = 't1'), 'mismo nombre: misma sesion_id');
select ok((select inicio_at > now() + interval '5 hours 30 minutes' from public.sesion where id = (select (r->>'sesion_id')::uuid from _x where n = 't1')), 'el inicio_at se actualizó');
select is(public.guardar_sesion((select sa from _k), '   ', now()), '{"success":false,"error":"NOMBRE_INVALIDO"}'::jsonb, 'nombre vacío: NOMBRE_INVALIDO');

-- ---------------------------------------------------------------------------
-- importar_reservas
-- ---------------------------------------------------------------------------
insert into _x select 'i1', public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":6}]'::jsonb);
select is((select r from _x where n = 'i1'), '{"success":true,"sedes_nuevas":["Catán"],"reservas":1}'::jsonb, 'Catán es sede nueva y se importa 1 reserva');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->1->'reservas',
  '[{"sede":"Catán","seccion":"centro","cantidad":6}]'::jsonb, 'obtener_reservas lo muestra en Sábado tarde');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->0->>'nombre', 'Sábado mañana', 'sesiones ordenadas por inicio_at');
select is((public.obtener_reservas((select sa from _k))->>'liberacion_min')::int, 20, 'liberacion_min por defecto 20');
select is(pg_temp.nlocks((select ea from _k), 'centro'), 1, 'importar tomó el advisory lock de la sección');

-- mañana: dos reservas
select is((public.importar_reservas((select sa from _k),
  '[{"sede":"catán","seccion":" IZQUIERDA ","sesion":"sabado MAÑANA","cantidad":2},
    {"sede":"Lomas","seccion":"Centro","sesion":"Sábado mañana","cantidad":3}]'::jsonb))->>'sedes_nuevas', '["Lomas"]',
  'sede existente matchea sin mayúsculas; sección y sesión normalizadas (sin acentos); Lomas es nueva');

-- reimportar sólo la tarde: la mañana queda intacta
select is((public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"sabado TARDE","cantidad":5}]'::jsonb))->>'success', 'true', 'fila con "sabado TARDE" matchea Sábado tarde');
select is(jsonb_array_length(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas'), 2, 'las reservas de la mañana siguen');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->1->'reservas',
  '[{"sede":"Catán","seccion":"centro","cantidad":5}]'::jsonb, 'la tarde se reemplazó');

-- 2 válidas + 1 sección inválida: nada cambia
create temp table _antes as select count(*)::int n, coalesce(sum(cantidad),0)::int s from public.reserva;
insert into _x select 'bad', public.importar_reservas((select sa from _k),
  '[{"sede":"Zzz","seccion":"centro","sesion":"Sábado tarde","cantidad":1},
    {"sede":"Catán","seccion":"izquierda","sesion":"Sábado tarde","cantidad":1},
    {"sede":"Catán","seccion":"arriba","sesion":"Sábado tarde","cantidad":1}]'::jsonb);
select is((select r->>'error' from _x where n = 'bad'), 'RESERVAS_INVALIDAS', 'sección inválida: RESERVAS_INVALIDAS');
select is((select r->'errores'->0->>'fila' from _x where n = 'bad'), '3', 'el error apunta a la fila 3');
select is((select count(*)::int || '/' || coalesce(sum(cantidad),0)::int from public.reserva), (select n || '/' || s from _antes), 'no escribió nada');
select is((select count(*)::int from public.sede where nombre = 'Zzz'), 0, 'no creó la sede de una importación rechazada');

-- otros errores por fila
select is((public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Nope","cantidad":1}]'::jsonb))->'errores'->0->>'fila', '1', 'sesión inexistente: error en fila 1');
select is((public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":0},
    {"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":1.5},
    {"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":"x"}]'::jsonb))->'errores'->>2, '{"fila": 3, "motivo": "Cantidad inválida: x"}',
  'cantidad 0, decimal o texto: error por fila');
select is((public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":1},
    {"sede":"CATÁN","seccion":"centro","sesion":"sábado tarde","cantidad":2}]'::jsonb))->'errores'->0->>'fila', '2', 'repetida (sede, sección, sesión): error en la fila 2');

-- capacidad pública del centro = 6 + 4 = 10 (el tramo reservado no cuenta)
select is((public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":6},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado tarde","cantidad":5}]'::jsonb))->'errores'->0->>'motivo',
  'Excede la capacidad de centro en Sábado tarde: 11 > 10', 'supera la capacidad pública: motivo de capacidad');
select is((public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":6},
    {"sede":"Lomas","seccion":"centro","sesion":"Sábado tarde","cantidad":4}]'::jsonb))->>'success', 'true', 'justo en la capacidad: ok');

-- simular
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Nueva","seccion":"derecha","sesion":"Sábado mañana","cantidad":1}]'::jsonb, true),
  '{"success":false,"error":"RESERVAS_INVALIDAS","errores":[{"fila":1,"motivo":"Excede la capacidad de derecha en Sábado mañana: 1 > 0"}]}'::jsonb,
  'simular valida igual (derecha no tiene capacidad)');
select is(public.importar_reservas((select sa from _k),
  '[{"sede":"Nueva","seccion":"izquierda","sesion":"Sábado mañana","cantidad":1}]'::jsonb, true),
  '{"success":true,"sedes_nuevas":["Nueva"],"reservas":1}'::jsonb, 'simular devuelve éxito');
select is((select count(*)::int from public.sede where nombre = 'Nueva'), 0, 'simular no crea sedes');
select is(jsonb_array_length(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas'), 2, 'simular no cambió las reservas');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas'->0->>'cantidad', '2', 'ni sus cantidades');

-- vacío
select is(public.importar_reservas((select sa from _k), '[]'::jsonb), '{"success":true,"sedes_nuevas":[],"reservas":0}'::jsonb, 'arreglo vacío: ok');
select is(jsonb_array_length(public.obtener_reservas((select sa from _k))->'sesiones'->1->'reservas'), 2, 'arreglo vacío no borra nada');
select is(public.importar_reservas((select sa from _k), '[]'::jsonb, false, '{Nope}')->'errores'->0->>'fila', '0', 'p_sesiones con sesión inexistente: error fila 0');
select is(public.importar_reservas((select sa from _k), '[]'::jsonb, false, '{sabado tarde}')->>'success', 'true', 'vaciar con p_sesiones');
select is(public.obtener_reservas((select sa from _k))->'sesiones'->1->'reservas', '[]'::jsonb, 'la tarde quedó sin reservas');
select is(jsonb_array_length(public.obtener_reservas((select sa from _k))->'sesiones'->0->'reservas'), 2, 'la mañana no se tocó');

-- ---------------------------------------------------------------------------
-- guardar_liberacion y libera_at
-- ---------------------------------------------------------------------------
select is(public.guardar_liberacion((select sa from _k), 181), '{"success":false,"error":"RANGO_INVALIDO"}'::jsonb, '181: RANGO_INVALIDO');
select is(public.guardar_liberacion((select sa from _k), 30), '{"success":true}'::jsonb, '30: ok');
select ok((public.obtener_estado_salon((select ka from _k))->'sesion'->>'libera_at')::timestamptz
          = (select inicio_at - interval '30 minutes' from public.sesion where nombre = 'Sábado mañana'), 'libera_at = inicio_at - 30 min');

-- ---------------------------------------------------------------------------
-- borrar_sesion
-- ---------------------------------------------------------------------------
select public.importar_reservas((select sa from _k),
  '[{"sede":"Catán","seccion":"centro","sesion":"Sábado tarde","cantidad":1}]'::jsonb);
insert into _x select 'del', public.borrar_sesion((select sa from _k), (select (r->>'sesion_id')::uuid from _x where n = 't1'));
select is((select r from _x where n = 'del'), '{"success":true}'::jsonb, 'borrar_sesion ok');
select is((select count(*)::int from public.reserva where sesion_id = (select (r->>'sesion_id')::uuid from _x where n = 't1')), 0, 'se borraron sus reservas en cascada');
select is(public.borrar_sesion((select sa from _k), (select (r->>'sesion_id')::uuid from _x where n = 't1'))->>'error', 'SESION_INEXISTENTE', 'borrar de nuevo: SESION_INEXISTENTE');
select is(public.borrar_sesion((select sb from _k), (select (r->>'sesion_id')::uuid from _x where n = 'm'))->>'error', 'SESION_INEXISTENTE', 'sesión de otro evento: SESION_INEXISTENTE');

-- ---------------------------------------------------------------------------
-- Clave de ujier
-- ---------------------------------------------------------------------------
select throws_ok(format($f$select public.guardar_sesion(%L, 'X', now())$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'guardar_sesion: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.borrar_sesion(%L, gen_random_uuid())$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'borrar_sesion: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.guardar_liberacion(%L, 10)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'guardar_liberacion: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.obtener_reservas(%L)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'obtener_reservas: ujier -> CLAVE_INVALIDA');
select throws_ok(format($f$select public.importar_reservas(%L, '[]'::jsonb)$f$, (select ka from _k)), null, 'CLAVE_INVALIDA', 'importar_reservas: ujier -> CLAVE_INVALIDA');

select * from finish();
rollback;

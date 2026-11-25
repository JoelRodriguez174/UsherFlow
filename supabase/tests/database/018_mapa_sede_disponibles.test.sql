-- Pruebas pgTAP de 20261121000100_mapa_sede_disponibles.sql:
-- obtener_mapa_sede devuelve capacidad y disponibles (capacidad - reservas de otras sedes) sin exponer otras sedes.

begin;
select plan(6);

create temp table _r0 as select public.crear_evento('Conferencia Mapa') as a;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_supervisor' as sa from _r0;

select private.aplicar_plantilla((select ea from _k), '{
  "izquierda": [
    {"numero": 1, "tramos": [{"tipo": "publico", "capacidad": 10}]},
    {"numero": 2, "tramos": [{"tipo": "publico", "capacidad": 10}]}
  ],
  "centro": [
    {"numero": 1, "tramos": [{"tipo": "publico", "capacidad": 10}]}
  ]
}'::jsonb);

select public.guardar_sectores((select sa from _k), '[
  {"seccion": "izquierda", "nombre": "Izquierda A", "fila_desde": 1, "fila_hasta": 2},
  {"seccion": "centro", "nombre": "Centro A", "fila_desde": 1, "fila_hasta": 1}
]'::jsonb);

select public.guardar_sesion((select sa from _k), 'Sab T18', now() + interval '1 day');

insert into public.sede (nombre) values ('Moreno T18'), ('Moron T18');
create temp table _s as
  select (select id from public.sede where nombre = 'Moreno T18') as moreno,
         (select id from public.sede where nombre = 'Moron T18') as moron;

create temp table _c as
  select public.generar_acceso_sede((select sa from _k), (select moreno from _s))->>'clave' as moreno,
         public.generar_acceso_sede((select sa from _k), (select moron from _s))->>'clave' as moron;

-- 1) Sin reservas: Izquierda A tiene capacidad 20 y disponibles 20.
select is(
  (public.obtener_mapa_sede((select moreno from _c))->'sesiones'->0->'sectores'->0->>'capacidad')::int,
  20,
  'capacidad inicial del sector es 20'
);
select is(
  (public.obtener_mapa_sede((select moreno from _c))->'sesiones'->0->'sectores'->0->>'disponibles')::int,
  20,
  'disponibles inicial del sector es 20'
);

-- 2) Morón reserva 7 en Izquierda A y Moreno reserva 5 en Izquierda A.
select public.guardar_reservas_sede((select moron from _c),
  '[{"seccion":"izquierda","sesion":"Sab T18","cantidad":7,"sector":"Izquierda A"}]'::jsonb, '{"Sab T18"}');
select public.guardar_reservas_sede((select moreno from _c),
  '[{"seccion":"izquierda","sesion":"Sab T18","cantidad":5,"sector":"Izquierda A"}]'::jsonb, '{"Sab T18"}');

select is(
  (public.obtener_mapa_sede((select moreno from _c))->'sesiones'->0->'sectores'->0->>'disponibles')::int,
  13,
  'disponibles descuenta solo otras sedes (20 - 7 = 13)'
);
select is(
  (public.obtener_mapa_sede((select moreno from _c))->'sesiones'->0->'sectores'->0->>'asignado')::int,
  5,
  'asignado refleja lo propio de la sede'
);
select is(
  (public.obtener_mapa_sede((select moreno from _c))->'sesiones'->0->'sectores'->0->>'agotado')::boolean,
  false,
  'no está agotado mientras queden lugares'
);

-- 3) Morón llena Centro A (10 de 10): para Moreno disponibles = 0.
select public.guardar_reservas_sede((select moron from _c),
  '[{"seccion":"izquierda","sesion":"Sab T18","cantidad":7,"sector":"Izquierda A"},{"seccion":"centro","sesion":"Sab T18","cantidad":10,"sector":"Centro A"}]'::jsonb,
  '{"Sab T18"}');

select is(
  (public.obtener_mapa_sede((select moreno from _c))->'sesiones'->0->'sectores'->1->>'disponibles')::int,
  0,
  'cuando otra sede llena el sector, disponibles es 0'
);

select * from finish();
rollback;

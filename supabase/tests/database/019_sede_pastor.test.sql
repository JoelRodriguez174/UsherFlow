-- Pruebas pgTAP Fase 1 (20261125000100_sede_pastor.sql):
-- tabla sede_pastor con RLS y sin privilegios públicos, guardar_email_sede, importar_emails_sedes y obtener_mapa_supervisor.

begin;
select plan(22);

select has_table('public', 'sede_pastor', 'existe public.sede_pastor');
select ok((select relrowsecurity from pg_class where oid = 'public.sede_pastor'::regclass), 'sede_pastor tiene RLS habilitado');
select ok(
  not has_table_privilege('anon', 'public.sede_pastor', 'SELECT')
  and not has_table_privilege('authenticated', 'public.sede_pastor', 'SELECT')
  and not has_table_privilege('anon', 'public.sede_pastor', 'INSERT')
  and not has_table_privilege('authenticated', 'public.sede_pastor', 'UPDATE'),
  'anon y authenticated no tienen acceso directo a sede_pastor'
);

create temp table _r0 as select public.crear_evento('Fase 1 Pastores') as a;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_ujier' as ku, a->>'clave_supervisor' as ks from _r0;

insert into public.sede (nombre) values ('Moreno F1'), ('Morón F1');
create temp table _s as
  select (select id from public.sede where nombre = 'Moreno F1') as moreno,
         (select id from public.sede where nombre = 'Morón F1') as moron;

-- ---------------------------------------------------------------------------
-- guardar_email_sede
-- ---------------------------------------------------------------------------
select is(
  public.guardar_email_sede((select ks from _k), (select moreno from _s), '  Pastor.Moreno@Gmail.COM  '),
  '{"success":true,"email":"pastor.moreno@gmail.com"}'::jsonb,
  'guarda el email normalizado en minúsculas y sin espacios'
);

select is(
  public.guardar_email_sede((select ks from _k), (select moron from _s), 'PASTOR.MORENO@gmail.com')->>'error',
  'EMAIL_DUPLICADO',
  'rechaza email duplicado en otra sede (case-insensitive)'
);

select is(
  public.guardar_email_sede((select ks from _k), (select moron from _s), 'no-es-un-email')->>'error',
  'EMAIL_INVALIDO',
  'rechaza formato de email inválido'
);

select is(
  public.guardar_email_sede((select ks from _k), gen_random_uuid(), 'otro@iglesia.org')->>'error',
  'SEDE_INVALIDA',
  'rechaza sede inexistente'
);

-- Editar el email de la misma sede reemplaza el anterior
select is(
  public.guardar_email_sede((select ks from _k), (select moreno from _s), 'nuevo.moreno@gmail.com'),
  '{"success":true,"email":"nuevo.moreno@gmail.com"}'::jsonb,
  'permite cambiar el email de una sede'
);
select is(
  (select count(*)::int from public.sede_pastor where email = 'pastor.moreno@gmail.com'),
  0,
  'el email anterior deja de estar autorizado inmediatamente'
);

-- Quitar email con null o vacío
select is(
  public.guardar_email_sede((select ks from _k), (select moreno from _s), '   '),
  '{"success":true,"email":null}'::jsonb,
  'espacio en blanco quita la autorización de la sede'
);
select is(
  (select count(*)::int from public.sede_pastor where sede_id = (select moreno from _s)),
  0,
  'quedó sin fila en sede_pastor'
);

-- Clave de ujier rechazada
select throws_ok(
  format($f$select public.guardar_email_sede(%L, %L, 'x@y.com')$f$, (select ku from _k), (select moreno from _s)),
  null, 'CLAVE_INVALIDA',
  'guardar_email_sede rechaza clave de ujier'
);

-- ---------------------------------------------------------------------------
-- importar_emails_sedes: simulación, alta, cambios, swap y errores
-- ---------------------------------------------------------------------------
select public.guardar_email_sede((select ks from _k), (select moreno from _s), 'viejo.moreno@gmail.com');

-- Simulación: reporta 1 sede nueva y 1 cambio sin escribir
select is(
  public.importar_emails_sedes((select ks from _k), '[
    {"sede":"Moreno F1","email":"moreno@iglesia.org"},
    {"sede":"Moron F1","email":"moron@iglesia.org"},
    {"sede":"Merlo F1","email":"merlo@iglesia.org"}
  ]'::jsonb, true),
  '{"success":true,"total":3,"sedes_nuevas":["Merlo F1"],"cambios":1}'::jsonb,
  'simular devuelve total, sedes_nuevas y cambios sin escribir'
);
select is((select count(*)::int from public.sede where nombre = 'Merlo F1'), 0, 'simular no creó Merlo F1');

-- Confirmación real
select is(
  public.importar_emails_sedes((select ks from _k), '[
    {"sede":"Moreno F1","email":"moreno@iglesia.org"},
    {"sede":"Moron F1","email":"moron@iglesia.org"},
    {"sede":"Merlo F1","email":"merlo@iglesia.org"}
  ]'::jsonb, false)->>'success',
  'true',
  'importar crea sedes nuevas y guarda los emails'
);
select is((select email from public.sede_pastor where sede_id = (select moreno from _s)), 'moreno@iglesia.org', 'actualizó Moreno F1');
select is((select email from public.sede_pastor where sede_id = (select moron from _s)), 'moron@iglesia.org', 'matcheó Morón F1 sin acento');

-- Swap de emails entre dos sedes en el mismo archivo
select is(
  public.importar_emails_sedes((select ks from _k), '[
    {"sede":"Moreno F1","email":"moron@iglesia.org"},
    {"sede":"Morón F1","email":"moreno@iglesia.org"}
  ]'::jsonb, false)->>'success',
  'true',
  'permite intercambiar emails entre dos sedes en el mismo lote'
);

-- Errores: email duplicado en archivo no escribe nada
select is(
  public.importar_emails_sedes((select ks from _k), '[
    {"sede":"Moreno F1","email":"rep@iglesia.org"},
    {"sede":"Morón F1","email":"REP@iglesia.org"}
  ]'::jsonb, false)->>'error',
  'FILAS_INVALIDAS',
  'rechaza emails repetidos en el archivo'
);

-- ---------------------------------------------------------------------------
-- obtener_mapa_supervisor + privacidad en obtener_mapa_sede
-- ---------------------------------------------------------------------------
select is(
  (select e->>'email_autorizado'
     from jsonb_array_elements(public.obtener_mapa_supervisor((select ks from _k))->'sedes') e
    where e->>'sede_id' = (select moreno::text from _s)),
  'moron@iglesia.org',
  'obtener_mapa_supervisor incluye email_autorizado'
);

select is(
  (select (e->>'cuenta_activa')::boolean
     from jsonb_array_elements(public.obtener_mapa_supervisor((select ks from _k))->'sedes') e
    where e->>'sede_id' = (select moreno::text from _s)),
  false,
  'cuenta_activa es false si el email todavía no tiene cuenta confirmada'
);

-- Privacidad: obtener_mapa_sede nunca filtra emails de sede_pastor
create temp table _c as
  select public.generar_acceso_sede((select ks from _k), (select moreno from _s))->>'clave' as moreno;
select ok(
  position('moron@iglesia.org' in public.obtener_mapa_sede((select moreno from _c))::text) = 0
  and position('moreno@iglesia.org' in public.obtener_mapa_sede((select moreno from _c))::text) = 0,
  'obtener_mapa_sede no expone emails autorizados'
);

select * from finish();
rollback;

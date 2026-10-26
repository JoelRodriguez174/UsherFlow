-- Task 5 (Etapa 1): evento, claves de acceso y limpieza del esquema viejo.
begin;
select plan(43);

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select has_table('public', 'evento', 'existe public.evento');
select has_table('public', 'sesion', 'existe public.sesion');
select has_table('public', 'sede', 'existe public.sede');
select has_table('public', 'acceso', 'existe public.acceso');
select has_function('public', 'crear_evento', array['text'], 'existe public.crear_evento(text)');
select has_function('private', 'evento_de_clave', array['text', 'boolean'], 'existe private.evento_de_clave(text, boolean)');

-- Limpieza del esquema viejo
select hasnt_table('public', 'filas', 'tabla vieja filas eliminada');
select hasnt_table('public', 'envios_transito', 'tabla vieja envios_transito eliminada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('despachar_grupo','sentar_personas','liberar_asiento','llenar_fila',
                        'confirmar_envio','cancelar_envio','recalibrar_fila','desfragmentar_fila',
                        'agregar_fila_al_fondo','modificar_capacidad_fila','reiniciar_salon',
                        'obtener_estado_salon')
      -- Task 6 crea la nueva obtener_estado_salon(text): sólo la vieja (uuid) debe haber desaparecido.
      and not (p.proname = 'obtener_estado_salon' and p.pronargs = 1 and p.proargtypes[0] = 'text'::regtype)
      -- Task 8 crea la nueva agregar_fila_al_fondo(text, text, integer): la vieja era (text, int, uuid).
      and not (p.proname = 'agregar_fila_al_fondo' and p.pronargs = 3
               and p.proargtypes[0] = 'text'::regtype and p.proargtypes[1] = 'text'::regtype)
      -- Task 9 crea la nueva reiniciar_salon(text, text): la vieja era (text, uuid).
      and not (p.proname = 'reiniciar_salon' and p.pronargs = 2
               and p.proargtypes[0] = 'text'::regtype and p.proargtypes[1] = 'text'::regtype)),
  0,
  'las 12 funciones viejas fueron eliminadas');

-- RLS: activada en todas las tablas; acceso sin ninguna policy
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('evento','sesion','sede','acceso') and c.relrowsecurity),
  4,
  'RLS activada en evento, sesion, sede y acceso');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'acceso'),
  0,
  'acceso no tiene policies');

-- ---------------------------------------------------------------------------
-- crear_evento
-- ---------------------------------------------------------------------------
create temp table _r as select public.crear_evento('Prueba') as r;

select is(jsonb_typeof((select r from _r)), 'object', 'crear_evento devuelve un objeto jsonb');
select ok((select r ? 'evento_id' and r ? 'clave_ujier' and r ? 'clave_supervisor' from _r),
  'el resultado tiene evento_id, clave_ujier y clave_supervisor');
select isnt(
  (select r->>'clave_ujier' from _r),
  (select r->>'clave_supervisor' from _r),
  'las dos claves son distintas');
select ok((select length(r->>'clave_ujier') = 64 and length(r->>'clave_supervisor') = 64 from _r),
  'las claves tienen 64 caracteres');
select ok((select r->>'clave_ujier' ~ '^[0-9a-f]{64}$' and r->>'clave_supervisor' ~ '^[0-9a-f]{64}$' from _r),
  'las claves son hexadecimales sin guiones');
select is(
  (select nombre from public.evento where id = (select (r->>'evento_id')::uuid from _r)),
  'Prueba',
  'el evento quedó guardado con su nombre');
select is(
  (select count(*)::int from public.acceso where evento_id = (select (r->>'evento_id')::uuid from _r)),
  1,
  'el evento tiene una fila en acceso');
select throws_ok($$select public.crear_evento('   ')$$, null, 'NOMBRE_INVALIDO', 'nombre en blanco rechazado');
select throws_ok($$select public.crear_evento(null)$$, null, 'NOMBRE_INVALIDO', 'nombre NULL rechazado');

-- ---------------------------------------------------------------------------
-- private.evento_de_clave
-- ---------------------------------------------------------------------------
select is(
  private.evento_de_clave((select r->>'clave_ujier' from _r)),
  (select (r->>'evento_id')::uuid from _r),
  'clave de ujier -> evento_id');
select is(
  private.evento_de_clave((select r->>'clave_ujier' from _r), false),
  (select (r->>'evento_id')::uuid from _r),
  'clave de ujier con p_supervisor=false -> evento_id');
select is(
  private.evento_de_clave((select r->>'clave_supervisor' from _r), false),
  (select (r->>'evento_id')::uuid from _r),
  'clave de supervisor con p_supervisor=false -> evento_id');
select is(
  private.evento_de_clave((select r->>'clave_supervisor' from _r), true),
  (select (r->>'evento_id')::uuid from _r),
  'clave de supervisor con p_supervisor=true -> evento_id');
select throws_ok(
  format($f$select private.evento_de_clave(%L, true)$f$, (select r->>'clave_ujier' from _r)),
  null, 'CLAVE_INVALIDA', 'clave de ujier con p_supervisor=true -> CLAVE_INVALIDA');
select throws_ok(
  $$select private.evento_de_clave('no-existe')$$,
  null, 'CLAVE_INVALIDA', 'clave inexistente -> CLAVE_INVALIDA');
select throws_ok(
  $$select private.evento_de_clave('no-existe', true)$$,
  null, 'CLAVE_INVALIDA', 'clave inexistente (supervisor) -> CLAVE_INVALIDA');
select throws_ok(
  $$select private.evento_de_clave(null)$$,
  null, 'CLAVE_INVALIDA', 'clave NULL -> CLAVE_INVALIDA');
select throws_ok(
  $$select private.evento_de_clave('')$$,
  null, 'CLAVE_INVALIDA', 'clave vacía -> CLAVE_INVALIDA');

-- Dos eventos no comparten claves
select isnt(
  (select r->>'clave_ujier' from _r),
  public.crear_evento('Otro')->>'clave_ujier',
  'cada evento recibe claves distintas');

-- ---------------------------------------------------------------------------
-- Privilegios (verificación independiente del rol)
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.crear_evento(text)', 'EXECUTE'),
  'anon no tiene EXECUTE sobre crear_evento');
select ok(not has_function_privilege('authenticated', 'public.crear_evento(text)', 'EXECUTE'),
  'authenticated no tiene EXECUTE sobre crear_evento');
select ok(has_function_privilege('service_role', 'public.crear_evento(text)', 'EXECUTE'),
  'service_role puede ejecutar crear_evento');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'),
  'anon no tiene USAGE sobre el esquema private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated no tiene USAGE sobre el esquema private');
select ok(not has_function_privilege('anon', 'private.evento_de_clave(text, boolean)', 'EXECUTE'),
  'anon no tiene EXECUTE sobre evento_de_clave');

-- ---------------------------------------------------------------------------
-- Comportamiento real como anon
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok($$select * from public.acceso$$, '42501', null, 'anon: select en acceso -> permiso denegado');
select throws_ok($$select * from public.evento$$, '42501', null, 'anon: select en evento -> permiso denegado');
select lives_ok($$select * from public.sesion$$, 'anon: select en sesion permitido (Etapa 2: lectura abierta para Realtime)');
select throws_ok($$select * from public.sede$$, '42501', null, 'anon: select en sede -> permiso denegado');
select throws_ok($$insert into public.evento (nombre) values ('x')$$, '42501', null, 'anon: insert en evento -> permiso denegado');
select throws_ok($$select public.crear_evento('Intruso')$$, '42501', null, 'anon: crear_evento -> permiso denegado');
select throws_ok($$select private.evento_de_clave('x')$$, '42501', null, 'anon: evento_de_clave -> permiso denegado');

reset role;

select * from finish();
rollback;

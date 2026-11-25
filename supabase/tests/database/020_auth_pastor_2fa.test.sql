-- Pruebas pgTAP Fase 2 (20261125000200_auth_pastor_2fa.sql):
-- bloqueo de alta en auth.users fuera de lista blanca, verificación obligatoria de 2FA (amr=otp),
-- revocación inmediata al cambiar el email en sede_pastor, y RPCs autenticadas del pastor.

begin;
select plan(17);

create temp table _r0 as select public.crear_evento('Fase 2 Auth') as a;
create temp table _k as
  select (a->>'evento_id')::uuid as ea, a->>'clave_supervisor' as ks from _r0;

select private.aplicar_plantilla((select ea from _k), '{
  "centro": [{"numero": 1, "tramos": [{"tipo": "publico", "capacidad": 20}]}]
}'::jsonb);
select public.guardar_sectores((select ks from _k), '[
  {"seccion": "centro", "nombre": "Centro A", "fila_desde": 1, "fila_hasta": 1}
]'::jsonb);
select public.guardar_sesion((select ks from _k), 'Sab F2', now() + interval '1 day');

insert into public.sede (nombre) values ('Moreno F2'), ('Moron F2');
create temp table _s as
  select (select id from public.sede where nombre = 'Moreno F2') as moreno,
         (select id from public.sede where nombre = 'Moron F2') as moron;

select public.guardar_email_sede((select ks from _k), (select moreno from _s), 'pastor.moreno@iglesia.org');

-- 1. estado_email_pastor antes de activar cuenta
select is(
  public.estado_email_pastor('intruso@gmail.com'),
  '{"autorizado":false,"cuenta_activa":false}'::jsonb,
  'email fuera de lista blanca: autorizado false'
);
select is(
  public.estado_email_pastor('PASTOR.MORENO@IGLESIA.ORG'),
  '{"autorizado":true,"cuenta_activa":false}'::jsonb,
  'email en lista blanca sin cuenta aún: autorizado true, cuenta_activa false'
);

-- 2. Trigger en auth.users bloquea altas fuera de sede_pastor
select throws_ok(
  $$insert into auth.users (id, email, aud, role) values (gen_random_uuid(), 'intruso@gmail.com', 'authenticated', 'authenticated')$$,
  null, 'EMAIL_NO_AUTORIZADO',
  'auth.users rechaza alta de email no autorizado en sede_pastor'
);

-- 3. Alta permitida para email en sede_pastor
create temp table _u as select gen_random_uuid() as uid;
insert into auth.users (id, email, aud, role, email_confirmed_at, encrypted_password)
values ((select uid from _u), 'pastor.moreno@iglesia.org', 'authenticated', 'authenticated', now(), 'hash-simulado');

select is(
  public.estado_email_pastor('pastor.moreno@iglesia.org'),
  '{"autorizado":true,"cuenta_activa":true}'::jsonb,
  'con usuario confirmado y password: cuenta_activa true'
);

-- Helper para simular JWT de PostgREST en el test
create function pg_temp.set_jwt(p_uid uuid, p_email text, p_sid text, p_amr jsonb) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_uid::text,
    'email', p_email,
    'session_id', p_sid,
    'role', 'authenticated',
    'amr', p_amr
  )::text, true);
end;
$$;

-- 4. Sólo con contraseña (sin OTP): NO puede confirmar 2FA ni leer el mapa
select pg_temp.set_jwt((select uid from _u), 'pastor.moreno@iglesia.org', 'sess-1',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)));

select is(
  public.confirmar_2fa_pastor(),
  '{"success":false,"error":"OTP_REQUERIDO"}'::jsonb,
  'confirmar_2fa_pastor rechaza JWT sin OTP reciente'
);
select throws_ok(
  $$select public.obtener_eventos_pastor()$$,
  null, 'DOS_FACTORES_REQUERIDO',
  'obtener_eventos_pastor exige 2FA verificado'
);
select throws_ok(
  format($f$select public.obtener_mapa_sede_auth(%L::uuid)$f$, (select ea from _k)),
  null, 'DOS_FACTORES_REQUERIDO',
  'obtener_mapa_sede_auth exige 2FA verificado'
);

-- 5. OTP viejo (> 10 min) tampoco sirve para confirmar 2FA
select pg_temp.set_jwt((select uid from _u), 'pastor.moreno@iglesia.org', 'sess-1',
  jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now() - interval '15 minutes')::bigint)));

select is(
  public.confirmar_2fa_pastor()->>'error',
  'OTP_REQUERIDO',
  'OTP vencido (> 10 min) no habilita 2FA'
);

-- 6. Con OTP reciente: confirma 2FA y habilita lectura + reserva
select pg_temp.set_jwt((select uid from _u), 'pastor.moreno@iglesia.org', 'sess-1',
  jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint)));

select is(public.confirmar_2fa_pastor()->>'success', 'true', 'confirmar_2fa_pastor aprueba con OTP reciente');
select is(public.obtener_eventos_pastor()->'sede'->>'nombre', 'Moreno F2', 'obtener_eventos_pastor devuelve la sede del pastor');
select is(
  (public.obtener_mapa_sede_auth((select ea from _k))->'sesiones'->0->'sectores'->0->>'disponibles')::int,
  20,
  'obtener_mapa_sede_auth devuelve disponibilidad del sector'
);
select is(
  public.guardar_reservas_sede_auth(
    (select ea from _k),
    '[{"seccion":"centro","sesion":"Sab F2","cantidad":8,"sector":"Centro A"}]'::jsonb,
    '{"Sab F2"}'
  )->>'success',
  'true',
  'guardar_reservas_sede_auth guarda la reserva de la sede'
);
select is(
  (public.obtener_mapa_sede_auth((select ea from _k))->'sesiones'->0->'sectores'->0->>'asignado')::int,
  8,
  'el mapa refleja los 8 lugares guardados'
);

-- 7. Otra sesión distinta (sess-2) del mismo usuario NO hereda el 2FA de sess-1
select pg_temp.set_jwt((select uid from _u), 'pastor.moreno@iglesia.org', 'sess-2',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)));
select throws_ok(
  $$select public.obtener_eventos_pastor()$$,
  null, 'DOS_FACTORES_REQUERIDO',
  'otra sesión sin 2FA propio es rechazada'
);

-- 8. Revocación al salir (revocar_2fa_pastor)
select pg_temp.set_jwt((select uid from _u), 'pastor.moreno@iglesia.org', 'sess-1',
  jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint)));
select is(public.revocar_2fa_pastor()->>'success', 'true', 'revocar_2fa_pastor limpia la sesión');
select throws_ok(
  $$select public.obtener_eventos_pastor()$$,
  null, 'DOS_FACTORES_REQUERIDO',
  'tras revocar_2fa_pastor la sesión pierde acceso'
);

-- 9. Revocación inmediata si el supervisor cambia el email de la sede
select public.confirmar_2fa_pastor();
select public.guardar_email_sede((select ks from _k), (select moreno from _s), 'reemplazo@iglesia.org');
select throws_ok(
  $$select public.obtener_eventos_pastor()$$,
  null, 'NO_AUTORIZADO',
  'al cambiar el email de la sede, el pastor anterior pierde acceso al instante'
);

select * from finish();
rollback;

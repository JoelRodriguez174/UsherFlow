-- UsherFlow Etapa 1 / Tarea 5: evento, claves de acceso y limpieza del esquema viejo.
-- ATENCION: elimina las tablas y funciones del esquema anterior (supabase/schema.sql).
-- La app nunca se usó, no hay datos que conservar. Sólo para correr contra la base local/nueva.

-- ---------------------------------------------------------------------------
-- 1. Limpieza del esquema viejo
-- ---------------------------------------------------------------------------
drop function if exists public.despachar_grupo(bigint, int, int);
drop function if exists public.sentar_personas(bigint, int);
drop function if exists public.liberar_asiento(bigint, int, boolean);
drop function if exists public.liberar_asiento(bigint, int);
drop function if exists public.llenar_fila(bigint);
drop function if exists public.confirmar_envio(uuid);
drop function if exists public.cancelar_envio(uuid);
drop function if exists public.recalibrar_fila(bigint, int, boolean);
drop function if exists public.desfragmentar_fila(bigint);
drop function if exists public.agregar_fila_al_fondo(text, int, uuid);
drop function if exists public.modificar_capacidad_fila(bigint, int);
drop function if exists public.reiniciar_salon(text, uuid);
drop function if exists public.obtener_estado_salon(uuid);

-- envios_transito depende de filas; el DROP también la saca de la publicación supabase_realtime.
drop table if exists public.envios_transito;
drop table if exists public.filas;

-- ---------------------------------------------------------------------------
-- 2. Esquema privado (no expuesto por la API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tablas
-- ---------------------------------------------------------------------------
create table public.evento (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) > 0),
  creado_en timestamptz not null default now()
);

create table public.sesion (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.evento (id) on delete cascade,
  inicio_at timestamptz not null,
  creado_en timestamptz not null default now()
);
create index sesion_evento_id_idx on public.sesion (evento_id);

create table public.sede (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  creado_en timestamptz not null default now()
);

create table public.acceso (
  evento_id uuid primary key references public.evento (id) on delete cascade,
  clave_ujier text not null unique,
  clave_supervisor text not null unique,
  rotada_en timestamptz
);

-- RLS activada en todo. Sin policies: el acceso de la app pasa sólo por RPC SECURITY DEFINER.
alter table public.evento enable row level security;
alter table public.sesion enable row level security;
alter table public.sede enable row level security;
alter table public.acceso enable row level security;

-- Supabase otorga ALL a anon/authenticated sobre tablas nuevas de public: se revoca todo.
revoke all on table public.evento, public.sesion, public.sede, public.acceso
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.evento_de_clave
--    p_supervisor = false: acepta clave de ujier O de supervisor (supervisor incluye ujier).
--    p_supervisor = true : acepta sólo la clave de supervisor.
-- ---------------------------------------------------------------------------
create function private.evento_de_clave(p_clave text, p_supervisor boolean default false)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_evento uuid;
begin
  if p_clave is null or p_clave = '' then
    raise exception 'CLAVE_INVALIDA';
  end if;

  if p_supervisor then
    select a.evento_id into v_evento
      from public.acceso a
     where a.clave_supervisor = p_clave;
  else
    select a.evento_id into v_evento
      from public.acceso a
     where a.clave_ujier = p_clave
        or a.clave_supervisor = p_clave;
  end if;

  if v_evento is null then
    raise exception 'CLAVE_INVALIDA';
  end if;

  return v_evento;
end;
$$;

revoke all on function private.evento_de_clave(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.crear_evento (sólo postgres / service_role)
-- ---------------------------------------------------------------------------
create function public.crear_evento(p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ujier text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_supervisor text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if p_nombre is null or length(btrim(p_nombre)) = 0 then
    raise exception 'NOMBRE_INVALIDO';
  end if;

  insert into public.evento (nombre) values (btrim(p_nombre)) returning id into v_id;
  insert into public.acceso (evento_id, clave_ujier, clave_supervisor)
    values (v_id, v_ujier, v_supervisor);

  return jsonb_build_object(
    'evento_id', v_id,
    'clave_ujier', v_ujier,
    'clave_supervisor', v_supervisor
  );
end;
$$;

revoke execute on function public.crear_evento(text) from public, anon, authenticated;
grant execute on function public.crear_evento(text) to service_role;

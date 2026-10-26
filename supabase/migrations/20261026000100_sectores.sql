-- UsherFlow Etapa 3 / Tarea 1: sectores, preferencias de las sedes, claves de acceso por sede y
-- private.apartado agrupado por (sede, sección, sesión).
--   public.sector, public.preferencia, public.acceso_sede, evento.fecha_limite,
--   reserva.sector_id, pendiente.sector_id, private.capacidad_sector, private.apartado reescrita.
-- Toda escritura pasa por RPC SECURITY DEFINER (sin policies de escritura); sólo `sector` es legible.

-- ---------------------------------------------------------------------------
-- 1. Tablas nuevas
-- ---------------------------------------------------------------------------
create table public.sector (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.evento (id) on delete cascade,
  seccion text not null check (seccion in ('izquierda', 'centro', 'derecha')),
  nombre text not null check (length(btrim(nombre)) > 0),
  fila_desde integer not null check (fila_desde > 0),
  fila_hasta integer not null,
  orden integer not null default 0,
  unique (evento_id, seccion, nombre),
  check (fila_hasta >= fila_desde)
);

create table public.preferencia (
  sede_id uuid not null references public.sede (id) on delete cascade,
  sector_id bigint not null references public.sector (id) on delete cascade,
  primary key (sede_id, sector_id)
);
-- La PK cubre búsquedas por sede; este índice cubre el borrado en cascada desde sector.
create index preferencia_sector_id_idx on public.preferencia (sector_id);

create table public.acceso_sede (
  evento_id uuid not null references public.evento (id) on delete cascade,
  sede_id uuid not null references public.sede (id) on delete cascade,
  clave text not null unique,
  primary key (evento_id, sede_id)
);

alter table public.evento add column fecha_limite timestamptz;

-- reserva: la reserva pasa a ser por sector. Ligadas a un sector no se puede borrar el sector.
alter table public.reserva add column sector_id bigint references public.sector (id) on delete restrict;
alter table public.reserva drop constraint reserva_sesion_id_sede_id_seccion_key;
alter table public.reserva
  add constraint reserva_sesion_sede_seccion_sector_key
  unique nulls not distinct (sesion_id, sede_id, seccion, sector_id);
create index reserva_sector_id_idx on public.reserva (sector_id);

alter table public.pendiente add column sector_id bigint references public.sector (id) on delete set null;
create index pendiente_sector_id_idx on public.pendiente (sector_id);

-- ---------------------------------------------------------------------------
-- 2. RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.sector enable row level security;
alter table public.preferencia enable row level security;
alter table public.acceso_sede enable row level security;
revoke all on table public.sector, public.preferencia, public.acceso_sede from public, anon, authenticated;
revoke all on sequence public.sector_id_seq from public, anon, authenticated;

grant select on table public.sector to anon, authenticated;
create policy sector_select_anon on public.sector for select to anon using (true);
create policy sector_select_authenticated on public.sector for select to authenticated using (true);

-- Realtime: el cliente pide un resync ante cualquier cambio; necesita la fila completa.
alter table public.sector replica identity full;
alter publication supabase_realtime add table public.sector;

-- ---------------------------------------------------------------------------
-- 3. private.capacidad_sector: Σ capacidad de tramos públicos de las filas del sector.
-- ---------------------------------------------------------------------------
create function private.capacidad_sector(p_sector bigint)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(t.capacidad), 0)::integer
    from public.sector s
    join public.fila f on f.evento_id = s.evento_id
                      and f.seccion = s.seccion
                      and f.numero between s.fila_desde and s.fila_hasta
    join public.tramo t on t.fila_id = f.id and t.tipo = 'publico'
   where s.id = p_sector;
$$;

revoke all on function private.capacidad_sector(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.apartado: igual que en la Etapa 2, pero con varias reservas (una por sector) por
--    (sede, sección, sesión) el consumo se resta UNA vez sobre la suma, no por fila de reserva.
-- ---------------------------------------------------------------------------
create or replace function private.apartado(p_evento uuid, p_seccion text, p_excluir_sede uuid)
returns integer
language sql
volatile
set search_path = ''
as $$
  select coalesce(sum(greatest(
           g.total - coalesce((select sum(p.cantidad)
                                 from public.pendiente p
                                where p.sesion_id = g.sesion_id
                                  and p.sede_id = g.sede_id
                                  and p.seccion = g.seccion
                                  and p.estado in ('pendiente', 'sentado')), 0),
           0)), 0)::integer
    from (select r.sesion_id, r.sede_id, r.seccion, sum(r.cantidad) as total
            from public.sesion s
            join public.evento e on e.id = s.evento_id
            join public.reserva r on r.sesion_id = s.id
           where s.id = private.sesion_en_curso(p_evento)
             and r.seccion = p_seccion
             and r.sede_id is distinct from p_excluir_sede
             and clock_timestamp() < s.inicio_at - make_interval(mins => e.liberacion_min)
           group by r.sesion_id, r.sede_id, r.seccion) g;
$$;

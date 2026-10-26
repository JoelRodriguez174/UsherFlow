-- UsherFlow Etapa 2 / Tarea 1: reservas de lugares por sede.
--   sesion.nombre, evento.liberacion_min, public.reserva, pendiente.sede_id / sesion_id,
--   private.sesion_en_curso, private.apartado, mandar_grupo con sede y obtener_estado_salon ampliado.
--
-- Cuentas (spec §4), por sección S y en la sesión en curso:
--   consumido(sede) = pendientes de esa sede, sesión y S en estado 'pendiente' o 'sentado'.
--   apartado(sede)  = max(reserva - consumido, 0) antes de libera_at; 0 desde libera_at.
--   libera_at       = inicio_at - liberacion_min minutos.
-- mandar_grupo toma el mismo advisory lock de sección de la Etapa 1 y calcula el cupo en UNA sentencia.

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------------
-- Las tablas están vacías (la app no tiene datos), así que nombre no necesita default.
alter table public.sesion add column nombre text not null check (length(btrim(nombre)) > 0);
alter table public.sesion add constraint sesion_evento_nombre_key unique (evento_id, nombre);

alter table public.evento
  add column liberacion_min integer not null default 20 check (liberacion_min between 0 and 180);

alter table public.pendiente
  add column sede_id uuid references public.sede (id),
  add column sesion_id uuid references public.sesion (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. reserva (sólo Supervisor la escribe, vía RPC; sin policies)
-- ---------------------------------------------------------------------------
create table public.reserva (
  id bigint generated always as identity primary key,
  sesion_id uuid not null references public.sesion (id) on delete cascade,
  sede_id uuid not null references public.sede (id),
  seccion text not null check (seccion in ('izquierda', 'centro', 'derecha')),
  cantidad integer not null check (cantidad > 0),
  unique (sesion_id, sede_id, seccion)
);

alter table public.reserva enable row level security;
revoke all on table public.reserva from public, anon, authenticated;
revoke all on sequence public.reserva_id_seq from public, anon, authenticated;

-- Lectura abierta (como fila/tramo/pendiente): Realtime necesita poder leer para entregar los cambios.
grant select on table public.reserva, public.sesion to anon, authenticated;
create policy reserva_select_anon on public.reserva for select to anon using (true);
create policy reserva_select_authenticated on public.reserva for select to authenticated using (true);
create policy sesion_select_anon on public.sesion for select to anon using (true);
create policy sesion_select_authenticated on public.sesion for select to authenticated using (true);

-- Realtime: el cliente pide un resync ante cualquier cambio; necesita la fila completa.
alter table public.reserva replica identity full;
alter publication supabase_realtime add table public.reserva, public.sesion;

-- ---------------------------------------------------------------------------
-- 3. private.sesion_en_curso: la primera sesión del evento (por inicio_at) que empezó hace
--    menos de 3 horas o todavía no empezó. Null si no hay.
-- ---------------------------------------------------------------------------
create function private.sesion_en_curso(p_evento uuid)
returns uuid
language sql
volatile
set search_path = ''
as $$
  select s.id
    from public.sesion s
   where s.evento_id = p_evento
     and s.inicio_at > clock_timestamp() - interval '3 hours'
   order by s.inicio_at
   limit 1;
$$;

revoke all on function private.sesion_en_curso(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.apartado: Σ apartado de las sedes de la sección, salvo p_excluir_sede (null = ninguna).
-- ---------------------------------------------------------------------------
create function private.apartado(p_evento uuid, p_seccion text, p_excluir_sede uuid)
returns integer
language sql
volatile
set search_path = ''
as $$
  select coalesce(sum(greatest(
           r.cantidad - coalesce((select sum(p.cantidad)
                                    from public.pendiente p
                                   where p.sesion_id = r.sesion_id
                                     and p.sede_id = r.sede_id
                                     and p.seccion = r.seccion
                                     and p.estado in ('pendiente', 'sentado')), 0),
           0)), 0)::integer
    from public.sesion s
    join public.evento e on e.id = s.evento_id
    join public.reserva r on r.sesion_id = s.id
   where s.id = private.sesion_en_curso(p_evento)
     and r.seccion = p_seccion
     and r.sede_id is distinct from p_excluir_sede
     and clock_timestamp() < s.inicio_at - make_interval(mins => e.liberacion_min);
$$;

revoke all on function private.apartado(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. mandar_grupo con sede (opcional). Reemplaza la firma de 3 argumentos.
--    Orden de validación: clave -> sección -> cantidad -> sede -> cupo.
--    Cupo = libres actuales - apartado de las OTRAS sedes (o de todas si no hay sede).
-- ---------------------------------------------------------------------------
drop function public.mandar_grupo(text, text, integer);

create function public.mandar_grupo(p_clave text, p_seccion text, p_cantidad integer, p_sede uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_libres integer;
  v_id uuid;
begin
  if p_seccion is null or p_seccion not in ('izquierda', 'centro', 'derecha') then
    return jsonb_build_object('success', false, 'error', 'SECCION_INVALIDA');
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 20 then
    return jsonb_build_object('success', false, 'error', 'CANTIDAD_INVALIDA');
  end if;
  if p_sede is not null and not exists (select 1 from public.sede where id = p_sede) then
    return jsonb_build_object('success', false, 'error', 'SEDE_INVALIDA');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_evento::text || p_seccion, 0));

  select greatest(
           coalesce((select sum(greatest(t.capacidad - t.ocupados, 0))
                       from public.tramo t
                       join public.fila f on f.id = t.fila_id
                      where f.evento_id = v_evento
                        and f.seccion = p_seccion
                        and t.tipo = 'publico'), 0)
           - coalesce((select sum(p.cantidad)
                         from public.pendiente p
                        where p.evento_id = v_evento
                          and p.seccion = p_seccion
                          and p.estado = 'pendiente'), 0)
           - private.apartado(v_evento, p_seccion, p_sede),
           0)::integer
    into v_libres;

  if p_cantidad > v_libres then
    return jsonb_build_object('success', false, 'error', 'SECCION_SIN_CUPO', 'libres', v_libres);
  end if;

  insert into public.pendiente (evento_id, seccion, cantidad, sede_id, sesion_id)
  values (v_evento, p_seccion, p_cantidad, p_sede, private.sesion_en_curso(v_evento))
  returning id into v_id;

  return jsonb_build_object('success', true, 'pendiente_id', v_id);
end;
$$;

revoke execute on function public.mandar_grupo(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.mandar_grupo(text, text, integer, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. obtener_estado_salon: agrega `sesion`, `reservas` y `sede_id` en cada pendiente.
-- ---------------------------------------------------------------------------
create or replace function public.obtener_estado_salon(p_clave text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
  v_sesion uuid := private.sesion_en_curso(v_evento);
begin
  return (
    select jsonb_build_object(
      'server_now', to_jsonb(clock_timestamp()),
      'evento_id', v_evento,
      'filas', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', f.id,
                   'seccion', f.seccion,
                   'numero', f.numero,
                   'fragmentada', f.fragmentada,
                   'verificada_en', f.verificada_en,
                   'tramos', coalesce((
                     select jsonb_agg(
                              jsonb_build_object(
                                'id', t.id,
                                'orden', t.orden,
                                'tipo', t.tipo,
                                'capacidad', t.capacidad,
                                'ocupados', t.ocupados,
                                'etiqueta', t.etiqueta)
                              order by t.orden)
                       from public.tramo t
                      where t.fila_id = f.id), '[]'::jsonb))
                 order by array_position(array['izquierda', 'centro', 'derecha'], f.seccion), f.numero)
          from public.fila f
         where f.evento_id = v_evento), '[]'::jsonb),
      'pendientes', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', p.id,
                   'seccion', p.seccion,
                   'cantidad', p.cantidad,
                   'sede_id', p.sede_id,
                   'creado_en', p.creado_en)
                 order by p.creado_en, p.id)
          from public.pendiente p
         where p.evento_id = v_evento and p.estado = 'pendiente'), '[]'::jsonb),
      'sesion', (
        select jsonb_build_object(
                 'id', s.id,
                 'nombre', s.nombre,
                 'inicio_at', s.inicio_at,
                 'libera_at', s.inicio_at - make_interval(mins => e.liberacion_min))
          from public.sesion s
          join public.evento e on e.id = s.evento_id
         where s.id = v_sesion),
      'reservas', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'sede_id', r.sede_id,
                   'sede', sd.nombre,
                   'seccion', r.seccion,
                   'cantidad', r.cantidad,
                   'sentados', coalesce((
                     select sum(p.cantidad)
                       from public.pendiente p
                      where p.sesion_id = r.sesion_id
                        and p.sede_id = r.sede_id
                        and p.seccion = r.seccion
                        and p.estado = 'sentado'), 0))
                 order by sd.nombre, array_position(array['izquierda', 'centro', 'derecha'], r.seccion))
          from public.reserva r
          join public.sede sd on sd.id = r.sede_id
         where r.sesion_id = v_sesion), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.obtener_estado_salon(text) from public, anon, authenticated;
grant execute on function public.obtener_estado_salon(text) to anon, authenticated;

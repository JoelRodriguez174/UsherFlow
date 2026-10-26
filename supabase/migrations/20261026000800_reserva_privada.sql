-- F4: `reserva` deja de ser legible con la anon key (mostraba cantidades y sectores de todas las sedes sin clave).
-- Las pantallas ya la leen por obtener_estado_salon / RPC de pastor (security definer, con clave).
revoke select on table public.reserva from anon, authenticated;
drop policy reserva_select_anon on public.reserva;
drop policy reserva_select_authenticated on public.reserva;

-- Sin SELECT no hay eventos realtime de `reserva`: se saca de la publicación y, para que las pantallas
-- abiertas sigan resincronizando al cambiar una reserva, un trigger por sentencia toca `sesion`
-- (mismo truco que guardar_liberacion: un update sin cambios dispara el evento de `sesion`).
alter publication supabase_realtime drop table public.reserva;

create or replace function private.avisar_cambio_reserva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sesion set inicio_at = inicio_at;
  return null;
end;
$$;

create trigger reserva_avisa_cambio
  after insert or update or delete on public.reserva
  for each statement execute function private.avisar_cambio_reserva();

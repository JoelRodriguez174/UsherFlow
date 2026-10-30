-- Borrar una sesión (cascada a `reserva`) devolvía 400: el trigger de aviso hacía un UPDATE sin WHERE y
-- Supabase lo rechaza para las llamadas por API (pg_safeupdate: "UPDATE requires a WHERE clause").
-- Mismo efecto (un update sin cambios que dispara el evento realtime de `sesion`), ahora con WHERE.
create or replace function private.avisar_cambio_reserva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sesion set inicio_at = inicio_at where true;
  return null;
end;
$$;

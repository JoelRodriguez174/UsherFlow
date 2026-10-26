-- UsherFlow Etapa 1 / Tarea 6: salón (fila, tramo, pendiente, registro), RLS de solo lectura,
-- Realtime, private.aplicar_plantilla y public.obtener_estado_salon.

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
create table public.fila (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.evento (id) on delete cascade,
  seccion text not null check (seccion in ('izquierda', 'centro', 'derecha')),
  numero integer not null check (numero > 0),
  fragmentada boolean not null default false,
  verificada_en timestamptz,
  unique (evento_id, seccion, numero)
);

create table public.tramo (
  id bigint generated always as identity primary key,
  fila_id bigint not null references public.fila (id) on delete cascade,
  orden integer not null check (orden > 0),
  tipo text not null check (tipo in ('publico', 'reservado')),
  capacidad integer not null check (capacidad > 0),
  ocupados integer not null default 0 check (ocupados >= 0 and ocupados <= capacidad),
  etiqueta text,
  -- Un tramo reservado siempre lleva etiqueta visible.
  check (tipo <> 'reservado' or (etiqueta is not null and length(btrim(etiqueta)) > 0)),
  unique (fila_id, orden)
);
-- Redundante con unique (fila_id, orden) para las búsquedas por fila_id, pero lo pide el diseño.
create index tramo_fila_id_idx on public.tramo (fila_id);

create table public.pendiente (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.evento (id) on delete cascade,
  seccion text not null check (seccion in ('izquierda', 'centro', 'derecha')),
  cantidad integer not null check (cantidad > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'sentado', 'cancelado')),
  creado_en timestamptz not null default clock_timestamp(),
  resuelto_en timestamptz
);
create index pendiente_evento_id_estado_idx on public.pendiente (evento_id, estado);

-- Registro interno (auditoría). Sólo lo escriben/leen las funciones SECURITY DEFINER.
create table public.registro (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.evento (id) on delete cascade,
  tipo text not null,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default clock_timestamp()
);
create index registro_evento_id_idx on public.registro (evento_id);

-- ---------------------------------------------------------------------------
-- 2. RLS y privilegios
--    Supabase otorga ALL a anon/authenticated sobre tablas nuevas de public: se revoca todo y se
--    devuelve sólo SELECT donde corresponde. Toda escritura pasa por RPC SECURITY DEFINER.
-- ---------------------------------------------------------------------------
alter table public.fila enable row level security;
alter table public.tramo enable row level security;
alter table public.pendiente enable row level security;
alter table public.registro enable row level security;

revoke all on table public.fila, public.tramo, public.pendiente, public.registro
  from public, anon, authenticated;
revoke all on sequence public.fila_id_seq, public.tramo_id_seq, public.registro_id_seq
  from public, anon, authenticated;

-- Lectura abierta (los datos del salón no contienen información personal; Realtime la necesita).
grant select on table public.fila, public.tramo, public.pendiente to anon, authenticated;

create policy fila_select_anon on public.fila for select to anon using (true);
create policy fila_select_authenticated on public.fila for select to authenticated using (true);
create policy tramo_select_anon on public.tramo for select to anon using (true);
create policy tramo_select_authenticated on public.tramo for select to authenticated using (true);
create policy pendiente_select_anon on public.pendiente for select to anon using (true);
create policy pendiente_select_authenticated on public.pendiente for select to authenticated using (true);
-- Sin policies de escritura. registro: RLS activada y sin ninguna policy.

-- ---------------------------------------------------------------------------
-- 3. Realtime: filas completas en UPDATE/DELETE (el cliente necesita evento_id/estado/fila_id)
-- ---------------------------------------------------------------------------
alter table public.fila replica identity full;
alter table public.tramo replica identity full;
alter table public.pendiente replica identity full;

alter publication supabase_realtime add table public.fila, public.tramo, public.pendiente;

-- ---------------------------------------------------------------------------
-- 4. private.aplicar_plantilla
--    Sólo INSERTA filas y tramos; NO borra las existentes. Si el evento ya tiene una fila con el
--    mismo (seccion, numero) falla con unique_violation. La función pública de la Tarea 9 borra todo
--    el salón antes de llamar a ésta.
--    Forma de p_plantilla (tipo Plantilla del cliente):
--      {"izquierda":[{"numero":1,"tramos":[{"tipo":"publico","capacidad":3},
--                                          {"tipo":"reservado","capacidad":2,"etiqueta":"Mamás"}]}],
--       "centro":[...], "derecha":[...]}
--    Cualquier entrada inválida lanza PLANTILLA_INVALIDA (el detalle va en DETAIL) y, al ser un
--    error sin capturar, deshace todo lo insertado por la llamada.
--    Límites: numero y capacidad enteros entre 1 y 1000; cada fila necesita al menos un tramo.
-- ---------------------------------------------------------------------------
create function private.aplicar_plantilla(p_evento uuid, p_plantilla jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_seccion text;
  v_filas jsonb;
  v_fila jsonb;
  v_tramo jsonb;
  v_numero numeric;
  v_capacidad numeric;
  v_tipo text;
  v_etiqueta text;
  v_fila_id bigint;
  v_orden integer;
  v_vistos text[] := '{}';
  v_clave text;
begin
  if p_plantilla is null or jsonb_typeof(p_plantilla) <> 'object' then
    raise exception 'PLANTILLA_INVALIDA' using detail = 'La plantilla debe ser un objeto JSON.';
  end if;

  for v_seccion, v_filas in select e.key, e.value from jsonb_each(p_plantilla) e loop
    if v_seccion not in ('izquierda', 'centro', 'derecha') then
      raise exception 'PLANTILLA_INVALIDA' using detail = format('Sección desconocida: %s.', v_seccion);
    end if;
    if jsonb_typeof(v_filas) <> 'array' then
      raise exception 'PLANTILLA_INVALIDA' using detail = format('La sección %s debe ser un arreglo.', v_seccion);
    end if;

    for v_fila in select e.value from jsonb_array_elements(v_filas) e loop
      if jsonb_typeof(v_fila) <> 'object' or jsonb_typeof(v_fila -> 'numero') is distinct from 'number' then
        raise exception 'PLANTILLA_INVALIDA' using detail = format('Fila inválida en %s.', v_seccion);
      end if;
      v_numero := (v_fila -> 'numero')::numeric;
      if v_numero <> trunc(v_numero) or v_numero < 1 or v_numero > 1000 then
        raise exception 'PLANTILLA_INVALIDA'
          using detail = format('Número de fila inválido en %s: %s.', v_seccion, v_numero);
      end if;
      v_clave := v_seccion || ':' || v_numero::integer;
      if v_clave = any (v_vistos) then
        raise exception 'PLANTILLA_INVALIDA'
          using detail = format('Número de fila repetido en %s: %s.', v_seccion, v_numero);
      end if;
      v_vistos := v_vistos || v_clave;

      if jsonb_typeof(v_fila -> 'tramos') is distinct from 'array'
         or jsonb_array_length(v_fila -> 'tramos') = 0 then
        raise exception 'PLANTILLA_INVALIDA'
          using detail = format('La fila %s de %s necesita al menos un tramo.', v_numero, v_seccion);
      end if;

      insert into public.fila (evento_id, seccion, numero)
      values (p_evento, v_seccion, v_numero::integer)
      returning id into v_fila_id;

      v_orden := 0;
      for v_tramo in select e.value from jsonb_array_elements(v_fila -> 'tramos') e loop
        v_orden := v_orden + 1;

        if jsonb_typeof(v_tramo) <> 'object' then
          raise exception 'PLANTILLA_INVALIDA' using detail = 'Tramo inválido.';
        end if;

        v_tipo := case when jsonb_typeof(v_tramo -> 'tipo') = 'string' then v_tramo ->> 'tipo' end;
        if v_tipo is null or v_tipo not in ('publico', 'reservado') then
          raise exception 'PLANTILLA_INVALIDA' using detail = format('Tipo de tramo inválido: %s.', v_tramo -> 'tipo');
        end if;

        if jsonb_typeof(v_tramo -> 'capacidad') is distinct from 'number' then
          raise exception 'PLANTILLA_INVALIDA' using detail = 'La capacidad debe ser un número.';
        end if;
        v_capacidad := (v_tramo -> 'capacidad')::numeric;
        if v_capacidad <> trunc(v_capacidad) or v_capacidad < 1 or v_capacidad > 1000 then
          raise exception 'PLANTILLA_INVALIDA' using detail = format('Capacidad inválida: %s.', v_capacidad);
        end if;

        if jsonb_typeof(v_tramo -> 'etiqueta') not in ('string', 'null') and v_tramo ? 'etiqueta' then
          raise exception 'PLANTILLA_INVALIDA' using detail = 'La etiqueta debe ser texto.';
        end if;
        v_etiqueta := v_tramo ->> 'etiqueta';
        if v_tipo = 'reservado' and (v_etiqueta is null or length(btrim(v_etiqueta)) = 0) then
          raise exception 'PLANTILLA_INVALIDA' using detail = 'Un tramo reservado requiere etiqueta.';
        end if;

        insert into public.tramo (fila_id, orden, tipo, capacidad, ocupados, etiqueta)
        values (v_fila_id, v_orden, v_tipo, v_capacidad::integer, 0, v_etiqueta);
      end loop;
    end loop;
  end loop;
end;
$$;

revoke all on function private.aplicar_plantilla(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.obtener_estado_salon
--    Acepta clave de ujier o de supervisor. Una sola sentencia SQL => una sola instantánea
--    consistente de filas, tramos y pendientes. VOLATILE porque usa clock_timestamp().
--    Orden de filas: sección (izquierda, centro, derecha) y luego número.
-- ---------------------------------------------------------------------------
create function public.obtener_estado_salon(p_clave text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid := private.evento_de_clave(p_clave);
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
                   'creado_en', p.creado_en)
                 order by p.creado_en, p.id)
          from public.pendiente p
         where p.evento_id = v_evento and p.estado = 'pendiente'), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.obtener_estado_salon(text) from public, anon, authenticated;
grant execute on function public.obtener_estado_salon(text) to anon, authenticated;

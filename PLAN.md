> **Nota (2026-10-22):** este documento es el plan original y quedó superado. El diseño vigente es el de `docs/superpowers/specs/2026-10-22-usherflow-rediseno-y-reservas-design.md` y el plan implementado (Etapa 1) es `docs/superpowers/plans/2026-10-22-usherflow-etapa-1.md`.

---

# ⛪ UsherFlow — Sistema de Ruteo y Ocupación en Tiempo Real para Auditorios

## 1. Contexto y Objetivo del Proyecto
Aplicación web móvil en tiempo real (Mobile-First) diseñada para el equipo de ujieres/acomodadores en conferencias de iglesia (~700+ personas). 
- **Problema:** Las sillas no están numeradas, son móviles y se agregan filas nuevas de ~8 asientos sobre la marcha a medida que se llena el salón. Las reservas individuales generan huecos vacíos ("efecto queso gruyere").
- **Solución:** Un sistema de **Grilla Elástica por Bloques (Filas)** operado exclusivamente por el equipo de voluntarios, dividido en dos vistas sincronizadas en vivo (<200ms) vía WebSockets.

---

## 2. Stack Tecnológico
- **Frontend:** React (Vite o Next.js App Router), Tailwind CSS, Lucide Icons (`lucide-react`).
- **Backend / Realtime:** Supabase (PostgreSQL + Supabase Realtime `postgres_changes` + Funciones RPC en `plpgsql`).
- **UX / Dispositivo Objetivo:** Smartphones de 6.1" a 6.7" en orientación vertical, operados con **una sola mano (zona del pulgar)**, alto contraste en **Modo Oscuro** (`slate-950`) y feedback háptico (`navigator.vibrate`).

---

## 3. Protocolo de Ejecución en 2 Fases (Exclusivo Gemini Flash High)

Este proyecto se construye en dos etapas estrictas dentro del mismo contexto:

### Fase 1: Modo Arquitecto (Diseño de Contratos y Casos Borde)
- **Objetivo:** Razonar sobre concurrencia, desconexión móvil y estructura modular antes de tirar código.
- **Restricción Estricta:** PROHIBIDO escribir código JSX o componentes de React en esta fase.
- **Entregables de la Fase 1:**
  1. Árbol de archivos modular (`src/...`).
  2. Resolución de 4 casos borde críticos:
     - Dos orquestadores enviando un grupo a la misma fila en el mismo segundo (Overbooking en tránsito).
     - Desfase de reloj entre el servidor de Supabase y un celular con la hora mal configurada (Cálculo de TTL).
     - Reconciliación del estado Optimista si falla la llamada RPC por micro-corte de Wi-Fi/4G en el salón.
     - Reseteo limpio del salón o cambio de capacidad máxima de una fila (`max` de 8 a 7 o 9) en vivo.
  3. Definición exacta de las interfaces de datos / estado y firmas de las funciones RPC.

### Fase 2: Modo Constructor (Implementación Completa)
- **Objetivo:** Escribir el código de producción basándose 100% en la arquitectura aprobada en la Fase 1.
- **Regla de Calidad:** Cero placeholders (`// ...resto del código`), cero `TODOs`. Todo el SQL y los componentes de React deben entregarse completos.

---

## 4. Reglas de Negocio Críticas (Core Logic)

### A. Dos Roles en la misma Interfaz
1. **Modo Acomodador de Pasillo ("El que vigila"):**
   - Ve **1 sola sección** a la vez (`Izquierda`, `Centro` o `Derecha`).
   - Tarjetas grandes con botones en el borde derecho (zona del pulgar): **`[-1]`**, **`[-2]`** y **`[LLENAR (0)]`**.
   - **Auto-colapso:** Cuando una fila llega a `0 libres`, se colapsa en una tirita gris para no ocupar espacio ni obligar a hacer *scroll*.
   - **Botón inferior fijo:** `[+ Nueva Fila al Fondo (8 sillas)]` para crear filas *on-the-fly* cuando logística agrega sillas.

2. **Modo Orquestador de Puerta ("Vista Radar"):**
   - Ve las **3 columnas en paralelo** en formato compacto.
   - **Filtro de Tamaño de Grupo en zona del pulgar:** `[1+] [2+] [3+] [4+] [6+]`. Apaga visualmente las filas donde no entra el grupo junto.
   - **Acción de Despacho:** Botón `[Mandar X ->]` que crea una reserva en tránsito temporal.

### B. Envíos en Tránsito con Expiración Perezosa (TTL = 2 minutos)
- Cuando la puerta envía un grupo de $X$ personas a una fila, se crea un registro en `envios_transito` con `expira_en = now() + 2 minutes`.
- **Cálculo de Disponibilidad Real:**
  $$\text{Libres Disponibles} = \text{max} - \text{ocupados} - \sum (\text{en\_camino donde } \text{expira\_en} > \text{AHORA})$$
- **Sin Cronjobs:** El reloj del cliente (`setInterval` cada 1s) y las consultas SQL ignoran automáticamente los envíos cuyo `expira_en` ya venció. Si la familia se sentó en otra fila y nunca llegó, a los 120 segundos los asientos vuelven a estar disponibles solos.
- **Regla Anti-Doble Descuento:** Si una fila tiene un envío `'en_camino'` activo y el acomodador de pasillo toca manualmente `[-1]` o `[-2]` (olvidando tocar `✅ Llegaron`), la función RPC debe absorber/descontar primero los asientos del envío en tránsito activo.

### C. Fragmentación ("Efecto Queso Gruyere") y Abandono
- **Estado `fragmentada` (Boolean):** Indica que quedan asientos libres en la fila, pero están separados entre sí (solo sirven para personas individuales, no para grupos).
- **Gatillo por Abandono:** Si el acomodador toca el número central de una fila llena o casi llena ($\ge 4$ ocupados) para sumar `+1 libre` porque alguien se retiró, la fila pasa automáticamente a `fragmentada = true` (color Ámbar `⚠️ Compactar`).
- **Impacto en el Radar:** Si `fragmentada = true`, el máximo grupo contiguo que admite esa fila en la vista del Orquestador es `1`, bloqueándola para filtros de `2+`, `3+`, `4+` hasta que el acomodador de pasillo junte a la gente y toque `[✅ Juntos]`.

### D. Recalibración Visual Directa
- Si el conteo de la app se desfasa de la realidad física, el acomodador puede abrir un selector rápido del `0` al `8` en la fila y tocar directamente cuántas sillas vacías ve con sus ojos (`ocupados = max - libres_vistos`).

---

## 5. Esquema de Base de Datos y RPCs (Supabase)

### Tablas
- `public.filas`:
  - `id` (bigint, PK)
  - `evento_id` (uuid, opcional para multi-evento)
  - `seccion` (`'izquierda'` | `'centro'` | `'derecha'`)
  - `numero` (int)
  - `max` (int, default 8)
  - `ocupados` (int, default 0)
  - `fragmentada` (boolean, default false)
- `public.envios_transito`:
  - `id` (uuid, PK)
  - `fila_id` (bigint, FK -> `filas.id` ON DELETE CASCADE)
  - `cantidad` (int)
  - `estado` (`'en_camino'` | `'confirmado'` | `'cancelado'`)
  - `creado_en` (timestamptz)
  - `expira_en` (timestamptz, default `now() + interval '2 minutes'`)

### Funciones RPC Requeridas (Atómicas)
1. `sentar_personas(p_fila_id, p_cantidad)` -> Absorbe envíos activos `FOR UPDATE` + incrementa `ocupados`.
2. `liberar_asiento(p_fila_id)` -> Decrementa `ocupados` + activa `fragmentada = true` si `ocupados >= 4`.
3. `llenar_fila(p_fila_id)` -> Confirma envíos activos + `ocupados = max` + `fragmentada = false`.
4. `confirmar_envio(p_envio_id)` -> Pasa envío a `'confirmado'` + suma `cantidad` a `filas.ocupados`.
5. `agregar_fila_al_fondo(p_seccion, p_max)` -> Calcula `COALESCE(MAX(numero), 0) + 1` e inserta fila nueva.

---

## 6. Checklist de Entregables (Roadmap de Implementación)

- [ ] **Paso 1 (Arquitectura - Opus):** Revisión de casos borde (reconexión en `visibilitychange`, manejo de errores de red en el salón, creación/reseteo de sesión de evento) y definición de la estructura de carpetas.
- [ ] **Paso 2 (Base de Datos - Flash High):** Script SQL idempotente con tablas, índices, políticas RLS, publicación Realtime y las 5 funciones RPC.
- [ ] **Paso 3 (Capa de Datos - Flash High):** Custom Hook `useSupabaseUshers.js` con estado optimista, suscripción a canales Realtime y resincronización automática al desbloquear la pantalla del móvil.
- [ ] **Paso 4 (UI Pasillo & Radar - Flash High):** Componentes modulares en React + Tailwind (`HeaderGlobal`, `PasilloView`, `FilaCard`, `OrquestadorRadarView`, `CalibradorModal`).
- [ ] **Paso 5 (Acceso Rápido / Admin - Flash High):** Pantalla o modal para "Reiniciar Salón / Nuevo Evento" y generación de código QR para que los voluntarios entren sin login.
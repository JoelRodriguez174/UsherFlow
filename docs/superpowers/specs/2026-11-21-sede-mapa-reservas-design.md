# Reservas por sede sobre el mapa (estilo Movistar Arena)

**Fecha:** 2026-11-21  
**Estado:** Aprobado  
**Alcance:** Ruta `/sede` (pastor de sede), componente `MapaSalon` y RPC `obtener_mapa_sede`.

## Intención

Reemplazar el flujo partido de `/sede` (donde el mapa solo marcaba preferencias y las reservas se cargaban en desplegables separados) por una experiencia visual e interactiva sobre el mapa del salón, similar a reservar sectores en el Movistar Arena, manteniendo intacta la realidad física del salón (**sillas móviles sin numerar**).

## Decisiones

1. **Granularidad por sectores (no butacas individuales):** la unidad sigue siendo `sede + sector + cantidad + sesión`. No se numeran sillas.
2. **Reserva directa en `/sede`:** tocar un sector en el mapa permite elegir cuántos lugares reservar ahí. Se elimina el formulario de desplegables (`ReservasSede`) y se deja de usar `guardar_preferencias` desde `/sede` (la RPC y tabla se conservan en la base por compatibilidad).
3. **Visibilidad sin exponer otras sedes:** cada sector muestra su disponibilidad real para la sesión elegida (`capacidad` y `disponibles = capacidad - reservas_de_otras_sedes`), sin revelar jamás nombres ni desglose de otras sedes.
4. **Carrito por sesión (Enfoque 1):** el pastor arma su distribución en el mapa para la sesión activa, ve el resumen de sectores y total de lugares en tiempo real, y confirma en un solo envío atómico a `guardar_reservas_sede`.

## Diseño

### Backend (`obtener_mapa_sede`)
- Migración `20261121000100_mapa_sede_disponibles.sql` que extiende cada ítem de `sesiones[].sectores` con `capacidad` y `disponibles` (`greatest(0, capacidad - (total - propio))`).
- `guardar_reservas_sede` no cambia: sigue validando clave, fecha límite y capacidades de sector y sección en Postgres.

### Dominio (`src/domain/reservasMapa.ts`)
- Cálculo puro de libres restantes del sector, estado visual (`disponible`, `pocos` cuando quedan ≤ 20% libres, `agotado`, `asignado`), detección de cambios sin confirmar, resumen de sesión y armado de filas para `guardar_reservas_sede`.

### UI (`MapaSalon`, `EditorSector`, `SedePanel`)
- **Mapa:** escenario destacado arriba, 3 columnas (`Izquierda`, `Centro`, `Derecha`) con pasillos claros, altura de bloque suavemente proporcional a sus filas, barra de ocupación, texto + color para cada estado y soporte retrocompatible para `MapaSupervisor`.
- **Editor de sector:** stepper `- / cantidad / +` con input numérico editable y botón rápido `+5` cuando entra, topeado en `disponibles`, más `Aplicar` y `Quitar reserva`. En móvil abre dentro de `Modal`; en escritorio vive en el panel lateral derecho.
- **Carrito:** barra fija inferior en móvil (`sticky bottom-0 safe-bottom`) con acceso al detalle y botón `Confirmar`; tarjeta lateral en escritorio.
- **Bordes y concurrencia:** aviso inline al cambiar de sesión con cambios sin guardar; si el servidor rechaza por `RESERVAS_INVALIDAS`, muestra el motivo, refresca disponibilidad y conserva el borrador; si falla el polling con mapa ya cargado, muestra un aviso discreto.

# UsherFlow

UsherFlow es una aplicación web móvil en tiempo real para el equipo de ujieres de un auditorio con sillas móviles (~700 personas). La Puerta manda grupos a una fila de una sección (izquierda, centro, derecha), la Sección los recibe y los confirma, y el Supervisor ve el salón completo y administra la plantilla de filas. Todo se sincroniza en vivo entre los teléfonos. El acceso es por enlace con clave secreta, sin cuentas ni contraseñas.

## Stack

- Next.js (App Router) + React 19 + Tailwind CSS v4
- Supabase local (PostgreSQL + Realtime + funciones RPC en `plpgsql`), acceso por clave y no por Auth
- Vitest + Testing Library para el cliente, `supabase test db` (pgTAP) para la base

## Cómo correrlo en local

Requisitos: Node.js y Docker (la base local de Supabase corre en contenedores).

```bash
npm install
npx supabase start      # necesita Docker corriendo; aplica las migraciones de supabase/migrations/
npm run dev
```

Copiá `.env.example` a `.env.local` y completá las variables con los valores de `npx supabase status`:

```
NEXT_PUBLIC_SUPABASE_URL=<API URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

## Verificaciones

```bash
npm run lint       # ESLint: 0 errores y 0 advertencias
npm test           # tests del cliente (Vitest)
npm run test:db    # tests de la base (necesita la pila de Supabase levantada)
npm run build      # build de producción de Next.js
```

## Crear el primer evento y entrar

La app no puede crear eventos: la función `crear_evento` solo la puede ejecutar el rol de servicio. Se crea como administrador desde el SQL editor de Supabase (Studio) o con `psql`:

```sql
select public.crear_evento('Nombre del evento');
```

Devuelve las dos claves del evento (`clave_ujier` y `clave_supervisor`). Después:

1. Abrí `/entrar?k=<clave_supervisor>&rol=supervisor`.
2. En el panel del supervisor usá "Aplicar plantilla" para generar las filas del salón.
3. Compartí los códigos QR del panel con la Puerta y con cada Sección.

## Seguridad / operación

- El enlace del ujier lleva una clave secreta. Si se filtra, renovála desde el panel del supervisor con "Renovar claves".
- Renovar las claves corta el acceso por RPC de los enlaces viejos, pero las tablas del salón siguen siendo legibles por cualquiera que tenga la anon key pública. Esto está aceptado en la Etapa 1; no se guardan datos personales.
- Nunca habilites el registro de sentencias o parámetros en la base (`log_statement = 'all'`, pgaudit, auto_explain con parámetros): las llamadas RPC llevan la clave como parámetro y quedaría en los logs.
- Las migraciones de `supabase/migrations/` son destructivas desde la primera (borran el esquema viejo). Aplicalas solo en un proyecto de desarrollo descartable o en uno nuevo y vacío. Subirlas a un proyecto hospedado es decisión del dueño del proyecto y no está automatizado.
- La Etapa 2 (reservas por sede) está construida; falta la prueba manual en celular.

## Pendientes

- Confirmar con el equipo la sesión del jueves, los tiempos de liberación y los topes de reservas (Etapa 2).
- Cargar los números reales de la plantilla del salón (hoy `src/config/plantilla.ts` es un ejemplo).
- Reemplazar el logo por uno de alta resolución para los íconos (`public/icon-512.png` está agrandado desde un original de 147 px).

## Documentación

- Diseño vigente: `docs/superpowers/specs/2026-10-22-usherflow-rediseno-y-reservas-design.md`
- Plan de la Etapa 1: `docs/superpowers/plans/2026-10-22-usherflow-etapa-1.md`
- `PLAN.md` es el plan original, superado.

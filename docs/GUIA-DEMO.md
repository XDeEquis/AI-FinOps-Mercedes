# Guía de configuración para la demo — AI FinOps Proxy

Guía paso a paso para dejar la IA local funcionando **mañana antes de la presentación**.

---

## Resumen rápido (5 minutos antes de la demo)

```powershell
# 1. Docker + modelos locales
cd material
docker compose up -d
docker exec ollama-provider-a ollama list
docker exec ollama-provider-b ollama list

# 2. Backend
cd ..\backend
npm install
npm start

# 3. Frontend (otra terminal)
cd ..\frontend
npm install
npm run dev
```

| Servicio | URL |
|----------|-----|
| Chat | http://localhost:5173 |
| Dashboard React | http://localhost:5173/dashboard |
| API Backend | http://localhost:3000 |

---

## Requisitos previos

| Herramienta | Para qué |
|-------------|----------|
| **Docker Desktop** (con WSL2 en Windows) | Ejecutar Llama y Mistral en local |
| **Node.js 18+** | Backend y frontend |
| **npm** | Dependencias del proyecto |

Comprueba que Docker está corriendo:

```powershell
docker ps
```

---

## Paso 1 — Levantar los proveedores de IA (Ollama)

Desde la carpeta `material/`:

```powershell
cd material
docker compose up -d
```

Deberías ver dos contenedores:

| Contenedor | Modelo | Puerto |
|------------|--------|--------|
| `ollama-provider-a` | `llama3.2:3b` | **11434** |
| `ollama-provider-b` | `mistral:7b` | **11435** |

### Descargar modelos (solo la primera vez, o tras `docker compose down -v`)

```powershell
docker exec ollama-provider-a ollama pull llama3.2:3b
docker exec ollama-provider-b ollama pull mistral:7b
```

> La descarga total ronda **6–7 GB**. Hazlo la noche anterior si puedes.

### Verificar que responden

```powershell
# Provider A (Llama)
curl http://localhost:11434/api/tags

# Provider B (Mistral)
curl http://localhost:11435/api/tags
```

En PowerShell también puedes usar:

```powershell
Invoke-WebRequest -Uri http://localhost:11434/api/tags -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:11435/api/tags -UseBasicParsing
```

---

## Paso 2 — Configurar el backend

### 2.1 Crear el archivo `.env`

```powershell
cd backend
copy .env.example .env
```

Edita `backend/.env` y deja **como mínimo** esto:

```env
PORT=3000

# ⚠️ OBLIGATORIO para respuestas reales (no simuladas)
ENABLE_REAL_PROVIDERS=true

# Mistral en CPU puede tardar 2-3 min. No bajar de 300000.
FINOPS_PROVIDER_TIMEOUT_MS=300000

FINOPS_DEFAULT_BUDGET_USD=5.0
```

> **Importante:** no dupliques claves en el `.env`. Si aparece `ENABLE_REAL_PROVIDERS` dos veces (una `true` y otra `false`), gana la primera y puede quedar mal configurado.

### 2.2 Instalar dependencias y arrancar

```powershell
cd backend
npm install
npm start
```

Deberías ver:

```
🚀 ¡Backend corriendo con éxito en http://localhost:3000!
[DB] SQLite inicializada correctamente (finops.db).
```

### 2.3 Comprobar que la IA real está activa

```powershell
curl http://localhost:3000/
```

Respuesta esperada:

```json
{
  "status": "ok",
  "real_providers_enabled": true,
  ...
}
```

Si `real_providers_enabled` es `false`, revisa el `.env` y reinicia el backend.

---

## Paso 3 — Levantar el frontend

En **otra terminal**:

```powershell
cd frontend
npm install
npm run dev
```

Abre **http://localhost:5173**

---

## Paso 4 — Probar antes de la demo

### Prueba rápida (Llama, ~30–60 s)

1. Entra con nombre + departamento **Ingeniería**
2. Escribe: `Hola, ¿qué es FinOps?`
3. Debe enrutar a **llama3.2:3b** y responder con texto real (no "Respuesta simulada...")

### Prueba de razonamiento (Mistral, ~1–3 min)

1. Escribe: `Analiza la peste negra`
2. La palabra **"analiza"** activa Mistral (`mistral:7b`)
3. Verás los tres puntitos y un contador de espera — **es normal**. No cierres la pestaña.
4. La primera respuesta de Mistral puede tardar **hasta 3 minutos** en CPU.

### Prueba del dashboard

Abre http://localhost:5173/dashboard y comprueba que cargan KPIs, gráficos y tablas.

---

## Cómo funciona el enrutamiento (para explicar en la demo)

| Tipo de petición | Modelo | Velocidad | Cuándo |
|------------------|--------|-----------|--------|
| Pregunta simple | `llama3.2:3b` | Rápida | Por defecto |
| Palabras como *analiza, programa, código, SQL...* | `mistral:7b` | Lenta | Razonamiento |
| Prompt muy largo | `llama3.2:3b` | Rápida | Guardrail de coste |
| Presupuesto > 90% | `llama3.2:3b` | Rápida | Guardrail de presupuesto |

Tarifas (por 1M tokens):

| Modelo | Input | Output |
|--------|-------|--------|
| llama3.2:3b | $0.06 | $0.06 |
| mistral:7b | $0.24 | $0.24 |

---

## Guion sugerido para la demo en vivo

### 1. Visibilidad de costes
- Entra como **Marketing** → envía 2–3 mensajes cortos
- Muestra el sidebar: gasto, modelo usado, coste por mensaje

### 2. Routing inteligente
- Cambia a **Ingeniería**
- Mensaje simple: `Resume qué es Docker` → Llama (rápido)
- Mensaje de código: `Analiza este algoritmo de ordenación` → Mistral (lento pero mejor calidad)

### 3. Control de presupuesto
- Sigue enviando mensajes hasta acercarte al 80% → alerta warning
- Sigue hasta el 100% → bloqueo con HTTP 403 y banner rojo

### 4. Dashboard
- Abre `/dashboard` → muestra gasto por equipo, routing, proyección y alertas

### Consejos para que no falle en directo

- **Calienta Mistral antes**: envía un mensaje con "analiza" 5 minutos antes de la demo para que el modelo ya esté cargado en memoria.
- **Ten un mensaje rápido de reserva** por si Mistral tarda: `¿Qué es la peste negra?` (sin "analiza" → va a Llama).
- **No reinicies el backend dos veces**: si el puerto 3000 está ocupado, mata el proceso anterior antes de volver a arrancar.

---

## Ajustes útiles durante la demo

### Cambiar presupuesto de un equipo

```http
PATCH http://localhost:3000/v1/consumers/equipo-marketing/budget
Content-Type: application/json

{ "monthly_budget_usd": 10 }
```

Equipos disponibles:

| Departamento | ID del consumidor |
|--------------|-------------------|
| Marketing | `equipo-marketing` |
| Ingeniería | `equipo-ingenieria` |
| Ventas | `equipo-ventas` |
| Soporte | `equipo-soporte` |

### Resetear gasto de un equipo (solo demo)

```http
PATCH http://localhost:3000/v1/consumers/equipo-marketing/spend
Content-Type: application/json

{ "current_spend_usd": 0 }
```

> El gasto **no puede superar** el presupuesto. El backend rechaza datos inconsistentes.

---

## Solución de problemas

### "Respuesta simulada generada desde..."

| Causa | Solución |
|-------|----------|
| `ENABLE_REAL_PROVIDERS=false` | Ponlo a `true` en `backend/.env` y reinicia |
| Docker apagado | `cd material && docker compose up -d` |
| Modelos no descargados | `docker exec ollama-provider-a ollama pull llama3.2:3b` (y lo mismo para B) |
| Timeout del proxy | Sube `FINOPS_PROVIDER_TIMEOUT_MS=300000` |
| Ollama local en 11434 | Para el Ollama de Windows si choca: cierra la app Ollama |

### Los tres puntitos no terminan nunca

- **Mistral tarda mucho en CPU** — espera hasta 3 minutos mirando el contador.
- Mira la consola del backend: si ves `[PROVIDER ERROR]`, lee el motivo (timeout, conexión rechazada...).
- Prueba directo: `curl http://localhost:11435/v1/chat/completions` con un mensaje corto.

### `Port 3000 is already in use`

```powershell
# Ver qué proceso usa el puerto
netstat -ano | findstr :3000

# Matar el proceso (sustituye PID)
taskkill /PID <PID> /F

# Volver a arrancar
cd backend
npm start
```

### Contenedores `unhealthy` en Docker

Suele ser el healthcheck sin `curl` dentro del contenedor. Si `http://localhost:11434/api/tags` responde 200, **puedes ignorarlo**.

### El frontend no conecta con el backend

- Backend debe estar en `http://localhost:3000`
- Si cambias el puerto, define `VITE_API_URL` en `frontend/.env`

---

## Checklist del día de la demo

- [ ] Docker Desktop abierto
- [ ] `docker ps` muestra `ollama-provider-a` y `ollama-provider-b`
- [ ] `ollama list` en ambos contenedores muestra los modelos
- [ ] `backend/.env` con `ENABLE_REAL_PROVIDERS=true`
- [ ] `curl http://localhost:3000/` → `real_providers_enabled: true`
- [ ] Frontend en http://localhost:5173
- [ ] Prueba rápida con Llama OK
- [ ] Mistral precalentado (opcional pero recomendado)
- [ ] Dashboard carga en `/dashboard`
- [ ] Presupuestos ajustados para la demo

---

## Estructura del proyecto

```
AI-FindOps-Mercedes/
├── backend/          # Proxy FinOps (Node.js + Express + SQLite)
├── frontend/         # Chat + Dashboard React (Vite)
├── material/         # Docker Compose con Ollama (proveedores A y B)
└── docs/             # Documentación
```

---

## Comandos de referencia

```powershell
# Parar proveedores IA (mantiene modelos descargados)
cd material
docker compose down

# Parar todo y borrar modelos (libera ~7 GB)
docker compose down -v

# Ver logs del backend en tiempo real
# (en la terminal donde corre npm start)

# Ver logs de Ollama
docker logs ollama-provider-a --tail 50
docker logs ollama-provider-b --tail 50
```

---

**Mercedes-Benz Hackathon — AI FinOps Proxy**  
*Do more intelligence with less cost.*

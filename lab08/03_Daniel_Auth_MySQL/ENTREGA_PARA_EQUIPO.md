# GUIA DE ENTREGA Y OPERACION PARA EL EQUIPO TECNICO
## Integracion de Autenticacion/Autorizacion MQTT (Lab 08) y Clientes Web (Lab 07)

**Proyecto:** *Monitoreo y prediccion de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresion*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Modulo:** Seguridad Perimetral MQTT y Clientes Web de Telemetria  
**Responsable:** Daniel  
**Destinatarios:** Alexis (Frontend/Dashboard), Mario (QA/Validacion), Jeanfranco (Infraestructura/Persistencia)  
**Rama de Entrega:** `feat/daniel-lab07-lab08`  
**Fecha:** 18 de Octubre de 2026  

---

> [!IMPORTANT]
> **ALCANCE Y ENTORNO DE PRUEBAS:**  
> Esta guia documenta el procedimiento probado y verificado en la estacion de trabajo de Daniel sobre Windows 11 con Docker Desktop, PowerShell 5.1 / 7 y Node.js. Diferencia explicitamente el estado verificado localmente respecto a una instalacion desde cero en las computadoras de otros integrantes. **No se afirma haber probado una instalacion limpia en una maquina virgen independiente; el equipo debe seguir este procedimiento para reproducir el despliegue.**

---

## 1. ¡ADVERTENCIA CRITICA: CLIENTES ANONIMOS DESHABILITADOS!

A partir de la integracion del Laboratorio 08:
1. **EMQX rechaza categoricamente cualquier intento de conexion anonima** (sin `username` o con contrasena vacia/invalida):
   - En **MQTT 3.1.1**, retorna CONNACK con codigo de retorno `4` (`0x04`: *Bad user name or password*).
   - En **MQTT 5.0**, retorna CONNACK con codigo de razon `0x86` (`134`: *Bad user name or password*).
2. **La politica predeterminada de autorizacion es `no_match: deny`**. Si un cliente autenticado intenta publicar o suscribirse en un topico no concedido explicitamente en `mqtt_acl`:
   - En publicaciones: el broker descarta o ignora la publicacion.
   - En suscripciones: retorna SUBACK con codigo `128` (`0x80`: *Failure / Subscription denied* en MQTT 3.1.1/5.0) o `135` (`0x87`: *Not authorized* en MQTT 5.0).
3. **Cualquier cliente previo sin credenciales dejara de conectar.** Todos los modulos (dashboard, simulador, herramientas de prueba) deben utilizar las credenciales descritas a continuacion.

---

## 2. Requisitos Previos y Orden Estricto de Preparacion

### 2.1. Requisitos del Sistema
- **Docker Desktop** (con Compose v2 habilitado y motor Linux activo).
- **PowerShell 7+** o **Windows PowerShell 5.1** (en Windows) o cliente bash con `curl` y `jq`.
- **Node.js v18+** y **npm** (para ejecutar la suite protocolar de clientes web del Lab 07).
- **Navegador web moderno** (Chrome, Edge o Firefox).
- **Git** configurado en la rama `feat/daniel-lab07-lab08`.

### 2.2. Orden Estricto de Preparacion
Siga cuidadosamente esta secuencia para evitar condiciones de carrera o fallos de inyeccion:
```text
1. Clonar rama y posicionarse en la raiz del repositorio
   ↓
2. Copiar env.template a .env en la raiz
   ↓
3. Ejecutar provision_auth_db.ps1 (crea tablas, genera contrasenas y sincroniza MySQL)
   ↓
4. Iniciar o recrear contenedores con 'docker compose up -d' (para inyectar variables de .env)
   ↓
5. Verificar disponibilidad real de puertos (MySQL 3307/3306 y EMQX API 18083)
   ↓
6. Ejecutar configure_emqx_auth.ps1 (activa Authn/Authz MySQL y no_match: deny en EMQX)
   ↓
7. Ejecutar suites de aceptacion y regresion
```

> [!WARNING]
> **REINICIO VS RECREACION DE CONTENEDORES:**  
> Docker Compose inyecta las variables de entorno de `.env` en los contenedores **unicamente al momento de crearlos**. Si modifica o genera valores en `.env`, ejecutar `docker compose restart` **NO** recarga las nuevas variables. Es indispensable ejecutar `docker compose up -d` (o `docker compose up -d --force-recreate virtual_nodes`).

> [!NOTE]
> **ESTADO DE SALUD EN DOCKER COMPOSE:**  
> El archivo `docker-compose.yml` base no define directivas de `healthcheck` de Docker para los servicios. Por lo tanto, los contenedores permaneceran en estado `Up`, sin cambiar a `healthy`. No espere un estado `healthy`; verifique la disponibilidad real mediante conexiones efectivas (ver seccion 4).

---

## 3. Gestion de Secretos y Variables de Entorno

Por directiva del proyecto, el archivo `.env` local contiene secretos reales y **esta estrictamente excluido del control de versiones por `.gitignore`**. Ningun integrante debe solicitar ni compartir su archivo `.env`.

### 3.1. Variables Requeridas en `.env` (Raiz del Proyecto)
El archivo `.env` debe coincidir con los nombres exactos utilizados por los scripts y Compose:

| Variable | Rol / Ambito | Descripcion |
| :--- | :--- | :--- |
| `DB_HOST` | Red Docker | Host interno de MySQL (`mysql_server`). |
| `DB_PORT` | Red Docker | Puerto interno de MySQL (`3306`). |
| `DB_NAME` | Base de Datos | Nombre de la BD relacional (`emqx_db`). |
| `EMQX_RO_DB_USER` | Consulta EMQX | Usuario de solo lectura para el broker (`emqx_ro_user`). |
| `EMQX_RO_DB_PASS` | Consulta EMQX | Contrasena para `emqx_ro_user` (generada automaticamente). |
| `MQTT_USER_PUB` | Identidad MQTT | Usuario del publicador web (`web_pub_daniel`). |
| `MQTT_PASS_PUB` | Identidad MQTT | Contrasena para `web_pub_daniel` (generada automaticamente). |
| `MQTT_USER_SUB` | Identidad MQTT | Usuario del suscriptor web (`web_sub_daniel`). |
| `MQTT_PASS_SUB` | Identidad MQTT | Contrasena para `web_sub_daniel` (generada automaticamente). |
| `MQTT_USER_NODES` | Identidad MQTT | Usuario para los 4 nodos simuladores (`esp32_nodes`). |
| `MQTT_PASS_NODES` | Identidad MQTT | Contrasena para `esp32_nodes` (generada automaticamente). |
| `MQTT_USER_BACKEND` | Identidad MQTT | Usuario del motor de reglas (`backend_rules`). |
| `MQTT_PASS_BACKEND` | Identidad MQTT | Contrasena para `backend_rules` (generada automaticamente). |

### 3.2. Cuentas de MySQL en la Infraestructura
- **`root` (Administrativa):** Configurada en `docker-compose.yml` (`MYSQL_ROOT_PASSWORD: rootpass`). Utilizada exclusivamente por `provision_auth_db.ps1` para aplicar DDL y conceder permisos.
- **`emqx_user` (Aplicacion / Telemetria):** Configurada en `docker-compose.yml` (`MYSQL_USER: emqx_user`, `MYSQL_PASSWORD: emqx_pass`). Utilizada por `virtual_simulator/simulator.py` para almacenar series temporales en `telemetria`.
- **`emqx_ro_user` (Consulta Operativa de Seguridad):** Creada en MySQL por `provision_auth_db.ps1`. Posee permiso exclusivo de `SELECT` sobre `mqtt_user` y `mqtt_acl`. **Tiene estrictamente denegado el acceso a la tabla `telemetria` y permisos de escritura**.
- **Nota de Terminologia:** Las contrasenas en la tabla `mqtt_user` **no se cifran** (el cifrado es reversible); se almacenan mediante una **funcion hash criptografica unidireccional SHA-256 con sal aleatoria (salt suffix)**: `SHA256(password + salt)`.

---

## 4. Despliegue y Puesta en Marcha Paso a Paso

### Paso 1: Preparar `.env` y Aprovisionar Base de Datos
```powershell
# 1. Copiar plantilla si no existe .env
if (-not (Test-Path .env)) { Copy-Item lab08\03_Daniel_Auth_MySQL\env.template .env }

# 2. Aprovisionar tablas, usuarios y generar credenciales seguras
.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1
```
*El script preservara cualquier variable ajena existente en `.env`, detectara si existen contrasenas vacias o con marcadores `CAMBIAR_POR_...` y las sustituira por contrasenas criptograficas seguras.*

### Paso 2: Iniciar y Recrear Contenedores
```powershell
docker compose up -d
```
Verifique que los 5 contenedores esten operativos (`Up`):
```powershell
docker compose ps
```

### Paso 3: Comprobar Disponibilidad Real de Servicios
Antes de configurar EMQX, compruebe que los servicios respondan:
```powershell
# Comprobar MySQL
docker exec mysql_server mysqladmin ping -u emqx_user -pemqx_pass

# Comprobar API de EMQX
curl -s http://localhost:18083/api/v5/status
```

### Paso 4: Configurar Seguridad en EMQX
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1
```
*El script es 100% idempotente: registra `password_based:mysql` y `authz:mysql`, deshabilita la fuente `file`, establece `no_match: deny` y no interrumpe conexiones activas.*

Para verificar el estado configurado en cualquier momento:
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -StatusOnly
```

---

## 5. Endpoints y URLs Locales

| Servicio / Modulo | URL / Endpoint | Protocolo / Puerto | Credenciales |
| :--- | :--- | :--- | :--- |
| **Cliente Web Publicador** | `http://localhost:8085/publicador.html` | HTTP / 8085 | Formulario web (`web_pub_daniel`) |
| **Cliente Web Suscriptor** | `http://localhost:8085/suscriptor.html` | HTTP / 8085 | Formulario web (`web_sub_daniel`) |
| **Broker MQTT WebSocket** | `ws://localhost:8083/mqtt` | WS / 8083 | Autenticacion requerida |
| **Broker MQTT TCP** | `localhost:1883` | TCP / 1883 | Clientes externos / simuladores |
| **Dashboard EMQX** | `http://localhost:18083` | HTTP / 18083 | `admin` / `public` |
| **phpMyAdmin** | `http://localhost:8080` | HTTP / 8080 | `emqx_user` / `emqx_pass` o `root` |
| **MySQL Externo** | `localhost:3307` | TCP / 3307 | Expuesto para DBeaver / Workbench |

---

## 6. Guia para Integrantes del Equipo

### 6.1. Para Alexis (Dashboard / Visualizacion Web / Suscriptores)
- **Identidad Asignada:** `web_sub_daniel` (contrasena en `.env`: `MQTT_PASS_SUB`).
- **Topicos Autorizados para Suscripcion:**
  - `cistern/+/telemetry`: Telemetria en tiempo real de todos los tanques simulados.
  - `cistern/+/alerts`: Alertas emitidas por el motor de reglas offline.
  - `cistern/lab07/prueba`: Topico aislado de prueba de laboratorio.
- **Ejemplo de Conexion MQTT.js (v5):**
  ```javascript
  const client = mqtt.connect('ws://localhost:8083/mqtt', {
      clientId: 'alexis_dash_' + Math.random().toString(16).substring(2, 10),
      username: process.env.MQTT_USER_SUB || 'web_sub_daniel',
      password: process.env.MQTT_PASS_SUB,
      clean: true,
      protocolVersion: 5
  });
  ```
- **Control de Error de Autenticacion:** Si el broker retorna rechazo (`0x86` / `4`), capture `client.on('error', ...)` y llame a `client.end(true)` para evitar bucles infinitos de reconexion.

### 6.2. Para Mario (QA y Automatizacion de Pruebas)
Se han dispuesto ejecutores reproducibles que no exponen contrasenas en linea de comandos ni distribuyen `.env` completo en los contenedores:

#### A. Suite Breve de Aceptacion (4 Controles Clave)
Ejecuta la verificacion de paridad pub/sub, rechazo de contrasena, denegacion ACL, auditoria real de 5 sesiones en EMQX y crecimiento de telemetria en MySQL:
```powershell
powershell -ExecutionPolicy Bypass -File .\lab08\03_Daniel_Auth_MySQL\tests\run_tests_docker.ps1 -Suite Acceptance
```

#### B. Matriz Completa de Regresion Protocolar (Casos A - I)
Verifica exhaustivamente cada combinacion de permisos para todas las identidades:
```powershell
powershell -ExecutionPolicy Bypass -File .\lab08\03_Daniel_Auth_MySQL\tests\run_tests_docker.ps1 -Suite Matrix
```

#### C. Suite de Pruebas de Transporte WebSockets (Lab 07)
Ejecuta las pruebas de protocolo MQTT v5 sobre WebSockets (P01–P10):
```powershell
# Instalar paquete mqtt si no esta instalado
npm install --no-save mqtt

# Ejecutar suite
node lab07/03_Daniel_Clientes_Web/tests/test_suite_lab07.js
```

#### D. Prueba Unitaria de Preservacion de `.env`
Verifica sobre un archivo temporal aislado que `provision_auth_db.ps1` preserva variables ajenas, no altera credenciales existentes y sustituye marcadores de plantilla (Casos A–F):
```powershell
powershell -ExecutionPolicy Bypass -File .\lab08\03_Daniel_Auth_MySQL\tests\test_provision_env_logic.ps1
```

#### E. Pruebas Negativas del Propio Verificador de Aceptacion
Demuestra que el verificador detecta sesiones faltantes, usuarios incorrectos, desconexiones o falta de crecimiento en telemetria:
```powershell
docker exec -i iot_virtual_nodes python /app/test_acceptance_phase6.py --test-verifier-negatives
```

---

## 7. Procedimiento de Recuperacion y Rollback

### 7.1. Recuperacion tras Recreacion de EMQX
El volumen nombrado `emqx_data` y el nombre estatico `emqx@node1.emqxnet` preservan la configuracion en Mnesia y `cluster.hocon`. Si se recrea el contenedor con `docker compose up -d --force-recreate emqx`, el broker se recupera en ~4 segundos conservando Authn y Authz sin requerir scripts adicionales.

### 7.2. Recuperacion si se Pierde el Volumen o la Base de Datos
Si se destruyen los volumenes (`docker compose down -v`):
1. `docker compose up -d`
2. `.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1`
3. `docker compose up -d --force-recreate virtual_nodes`
4. `.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1`

### 7.3. Rollback a Modo Abierto / Anonimo (Solo Emergencias de QA)
Si se necesita desactivar temporalmente la seguridad para pruebas con clientes legados:
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -Rollback
```
Para volver a activar la seguridad obligatoria:
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1
```

---

## 8. Politicas de Operacion Segura

1. **Nunca ejecutar `docker compose down -v`**, ya que destruira el historico de telemetria en `mysql_data` y la configuracion de EMQX en `emqx_data`.
2. Para detener temporalmente el stack: `docker compose stop`.
3. Para reanudar el stack: `docker compose start`.
4. Para consultar el recuento de telemetria en cualquier momento:
   ```powershell
   docker exec -i mysql_server mysql -u emqx_user -pemqx_pass emqx_db -e "SELECT NOW(), COUNT(*), MAX(fecha_hora) FROM telemetria;"
   ```

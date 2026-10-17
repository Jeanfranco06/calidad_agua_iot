# GUÍA DE ENTREGA Y OPERACIÓN PARA EL EQUIPO TÉCNICO
## Integración de Autenticación/Autorización MQTT (Lab 08) y Clientes Web (Lab 07)

**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Módulo:** Seguridad Perimetral MQTT y Clientes Web de Telemetría  
**Responsable:** Daniel  
**Destinatarios:** Alexis (Frontend/Dashboard), Mario (QA/Validación), Jeanfranco (Infraestructura/Persistencia)  
**Rama de Entrega:** `feat/daniel-lab07-lab08`  
**Fecha:** 17 de Octubre de 2026  

---

> [!IMPORTANT]
> **ALCANCE Y ENTORNO DE PRUEBAS:**  
> Esta guía documenta el procedimiento probado y verificado en la estación de trabajo de Daniel sobre Windows 11 con Docker Desktop y PowerShell. Diferencia explícitamente el estado ya verificado localmente respecto a una instalación desde cero en las computadoras de otros integrantes. **No asuma que este procedimiento se ejecutó en una máquina virgen de prueba.**

---

## 1. ¡ADVERTENCIA CRÍTICA: CLIENTES ANÓNIMOS DESHABILITADOS!

A partir de la integración del Laboratorio 08:
1. **EMQX rechaza categóricamente cualquier intento de conexión anónima** (sin `username` o con contraseña vacía/inválida), retornando un código protocolar de rechazo (`CONNACK 0x86` / Código 4 en MQTT 3.1.1 / MQTT 5.0).
2. **La política predeterminada de autorización es `no_match: deny`**. Si un cliente autenticado intenta publicar o suscribirse en un tópico que no esté explícitamente concedido en la tabla `mqtt_acl` de MySQL, el broker ignorará la publicación silenciosamente o retornará fallo (`SUBACK 0x80 / 128` en suscripciones).
3. **Cualquier script previo o herramienta de pruebas (MQTTX, scripts Python de simulación previa, Mosquitto CLI) que se conecte sin credenciales dejará de funcionar.** Todos los clientes deben migrarse a conexiones autenticadas según las identidades descritas en esta guía.

---

## 2. Requisitos Previos y Orden de Preparación

### 2.1. Requisitos del Sistema
- **Docker Desktop** (versión reciente con Compose v2 habilitado y motor Linux activo).
- **PowerShell 7+** o **Windows PowerShell 5.1** (en entornos Windows) o cliente bash con soporte `curl` y `jq` (si adaptan las llamadas API de los scripts `.ps1`).
- **Navegador web moderno** (Chrome, Edge o Firefox) para acceder a los clientes web y consolas de administración.
- **Git** configurado para clonar la rama de trabajo.

### 2.2. Orden Estricto de Preparación
Para evitar condiciones de carrera o fallos de conexión, siga estrictamente esta secuencia:
```text
1. Clonar rama y posicionarse en la raíz del repositorio
   ↓
2. Crear y configurar archivo .env propio desde env.template
   ↓
3. Levantar contenedores base (docker compose up -d)
   ↓
4. Esperar que MySQL y EMQX alcancen estado 'healthy'
   ↓
5. Aprovisionar tablas, usuarios y ACLs en MySQL (provision_auth_db.ps1)
   ↓
6. Configurar y activar autenticación/autorización en EMQX (configure_emqx_auth.ps1)
   ↓
7. Reiniciar virtual_nodes si se modificaron credenciales en .env
   ↓
8. Verificar telemetría y pruebas funcionales de aceptación
```

---

## 3. Aprovisionamiento Seguro sin Distribuir Secretos

Por directiva de seguridad del proyecto, el archivo `.env` local contiene contraseñas reales y **está estrictamente excluido del control de versiones por `.gitignore`**. Ningún integrante debe solicitar ni compartir el archivo `.env` de otro compañero.

### 3.1. Creación del Archivo `.env` Propio
En la raíz del proyecto, copie la plantilla base provista por Daniel:
```powershell
Copy-Item lab08\03_Daniel_Auth_MySQL\env.template .env
```

### 3.2. Variables de Entorno Requeridas
El archivo `.env` debe definir las siguientes variables (completar con contraseñas seguras generadas localmente):

| Variable | Tipo de Credencial | Descripción y Propósito |
| :--- | :--- | :--- |
| `MYSQL_ROOT_PASSWORD` | Administrativa | Contraseña del superusuario `root` de MySQL (usada para DDL/DCL inicial). |
| `MYSQL_DATABASE` | Base de Datos | Nombre de la BD relacional (`emqx_db`). |
| `MYSQL_USER` | Aplicación | Usuario para persistencia de telemetría (`calidad_user`). |
| `MYSQL_PASSWORD` | Aplicación | Contraseña de `calidad_user`. |
| `MYSQL_EMQX_USER` | Consulta Operativa | Cuenta de mínimo privilegio de EMQX (`emqx_ro_user`). |
| `MYSQL_EMQX_PASSWORD` | Consulta Operativa | Contraseña de `emqx_ro_user` (solo lectura en `mqtt_user` y `mqtt_acl`). |
| `MQTT_USER_NODES` | Identidad MQTT | Usuario para los 4 nodos simuladores (`esp32_nodes`). |
| `MQTT_PASS_NODES` | Identidad MQTT | Contraseña para `esp32_nodes`. |
| `MQTT_USER_BACKEND` | Identidad MQTT | Usuario del motor de reglas (`backend_rules`). |
| `MQTT_PASS_BACKEND` | Identidad MQTT | Contraseña para `backend_rules`. |
| `MQTT_USER_WEB_PUB` | Identidad MQTT | Usuario del cliente web publicador (`web_pub_daniel`). |
| `MQTT_PASS_WEB_PUB` | Identidad MQTT | Contraseña para `web_pub_daniel`. |
| `MQTT_USER_WEB_SUB` | Identidad MQTT | Usuario del cliente web suscriptor (`web_sub_daniel`). |
| `MQTT_PASS_WEB_SUB` | Identidad MQTT | Contraseña para `web_sub_daniel`. |
| `EMQX_DEFAULT_USER` | Dashboard EMQX | Administrador web de EMQX (`admin`). |
| `EMQX_DEFAULT_PASSWORD` | Dashboard EMQX | Contraseña del panel web de EMQX. |

### 3.3. Distinción Vital de Cuentas
- **Credencial Administrativa (`root`):** Se utiliza única y exclusivamente durante el aprovisionamiento de la base de datos para crear tablas, otorgar privilegios mínimos y poblar datos iniciales. **Nunca debe usarse dentro de la configuración de EMQX.**
- **Credencial Operativa del Broker (`emqx_ro_user`):** Es la cuenta que EMQX utiliza para consultar `mqtt_user` y `mqtt_acl`. Posee únicamente permisos `SELECT` sobre esas dos tablas y tiene denegada cualquier operación de escritura o acceso a las tablas de telemetría.
- **Credenciales de Clientes MQTT:** Son identidades operativas de transporte, con contraseñas cifradas en MySQL mediante `SHA-256(password + salt)`.

---

## 4. Despliegue y Configuración Automatizada

### Paso 1: Levantar los Contenedores
```powershell
docker compose up -d
```
Verifique que los 5 contenedores estén operativos:
```powershell
docker compose ps
```
Los servicios son: `emqx_broker`, `mysql_server`, `phpmyadmin_gui`, `iot_virtual_nodes`, `web_clients_gui`.

### Paso 2: Aprovisionar la Base de Datos MySQL
Ejecute el script de aprovisionamiento en modo normal. El script creará las tablas `mqtt_user` y `mqtt_acl`, la cuenta `emqx_ro_user`, y preservará las contraseñas que haya definido en su `.env`:
```powershell
.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1
```
*(Opcional: Si desea que el script genere automáticamente contraseñas criptográficas seguras y calcule sus sales y hashes SHA-256 en MySQL actualizando su `.env`, ejecute: `.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1 -RotateCredentials`).*

### Paso 3: Configurar Seguridad en EMQX
Ejecute el script de configuración de autenticación y autorización en el broker:
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1
```
El script es completamente **idempotente**:
- Crea o actualiza la fuente `password_based:mysql` apuntando a `emqx_ro_user`.
- Crea o actualiza la fuente `authz:mysql` con las consultas exactas y `emqx_ro_user`.
- Deshabilita la fuente de autorización por archivo (`file`) para evitar ACLs predeterminadas permisivas.
- Establece la política global `no_match: deny`.
- Verifica que no existan autenticadores secundarios ni bypasses anónimos.
- Su ejecución repetida no duplica fuentes ni desconecta las sesiones existentes de los clientes.

### Paso 4: Comprobar el Estado Efectivo
Para auditar la configuración activa en EMQX sin modificar nada:
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -StatusOnly
```

---

## 5. URLs Locales y Parámetros de Adaptación

### 5.1. Endpoints en la Máquina Local
| Servicio / Módulo | URL / Endpoint | Protocolo / Puerto | Credenciales |
| :--- | :--- | :--- | :--- |
| **Cliente Web Publicador** | `http://localhost:8085/publicador.html` | HTTP / 8085 | Formulario en pantalla (`web_pub_daniel`) |
| **Cliente Web Suscriptor** | `http://localhost:8085/suscriptor.html` | HTTP / 8085 | Formulario en pantalla (`web_sub_daniel`) |
| **Broker MQTT WebSocket** | `ws://localhost:8083/mqtt` | WS / 8083 | Subprotocolo `mqttv3.1` o `mqttv5.0` |
| **Broker MQTT TCP** | `localhost:1883` | TCP / 1883 | Clientes externos (MQTTX, ESP32) |
| **Broker MQTT Red Docker** | `emqx_broker:1883` | TCP / 1883 | Usado por `virtual_nodes` |
| **Dashboard EMQX** | `http://localhost:18083` | HTTP / 18083 | `admin` / `$EMQX_DEFAULT_PASSWORD` |
| **phpMyAdmin** | `http://localhost:8080` | HTTP / 8080 | `root` o `calidad_user` |
| **MySQL Externo** | `localhost:3307` | TCP / 3307 | Puerto expuesto para herramientas de escritorio |

### 5.2. Adaptación para Acceso Remoto desde Otro Equipo en la Misma LAN
Si se despliega en una máquina servidora (ej. `192.168.1.50`) y otro integrante accede desde su laptop:
1. En el navegador del cliente remoto, abrir `http://192.168.1.50:8085/publicador.html` y `http://192.168.1.50:8085/suscriptor.html`.
2. En el campo **"Broker URL"** de la interfaz web, reemplazar `ws://localhost:8083/mqtt` por `ws://192.168.1.50:8083/mqtt`.
3. Ingresar el usuario y contraseña correspondientes de su `.env`.
4. En Windows, asegurar que el Firewall permita conexiones entrantes en los puertos `8085` (HTTP Nginx) y `8083` (WebSocket EMQX).

---

## 6. Guía de Integración para Integrantes

### 6.1. Para Alexis (Dashboard / Visualización Web / Suscriptores)
- **Identidad Asignada para Clientes Web:** Utilizar `web_sub_daniel` (o solicitar a Daniel/Jeanfranco el registro de un nuevo usuario como `web_sub_alexis` mediante `02_permissions_data.sql`).
- **Tópicos Autorizados para Suscripción:**
  - `cistern/+/telemetry`: Permite recibir la telemetría de todos los tanques simulados (`cistern/ESP32_FISICO_UNT/telemetry`, `cistern/ESP32_V1_BLOQUE_A/telemetry`, etc.).
  - `cistern/+/alerts`: Para recibir alertas emitidas por el motor de reglas offline.
  - `cistern/lab07/prueba`: Para pruebas de control e integración de laboratorio.
- **Configuración MQTT.js Recomendada:**
  ```javascript
  const client = mqtt.connect('ws://localhost:8083/mqtt', {
      clientId: 'alexis_dash_' + Math.random().toString(16).substring(2, 10),
      username: process.env.MQTT_USER_WEB_SUB || 'web_sub_daniel',
      password: process.env.MQTT_PASS_WEB_SUB,
      clean: true,
      protocolVersion: 5 // MQTT v5.0 recomendado
  });
  ```
- **Manejo de Errores de Autenticación:**
  Si el broker rechaza la conexión con código `0x86` (bad user/pass), el cliente no debe ciclar reconexiones automáticamente. Debe capturar el evento `client.on('error', ...)` o revisar el código del `connack` y llamar a `client.end(true)`.

### 6.2. Para Mario (QA / Validación de Seguridad y Regresión)
Se dispone de dos suites de prueba automatizadas listas para su ejecución:

#### A. Suite Breve de Aceptación (Fase 6)
Verifica los 4 controles fundamentales (paridad pub/sub, rechazo de clave errónea, rechazo de tópico denegado y telemetría de nodos):
```powershell
docker exec -i iot_virtual_nodes python /app/lab08/03_Daniel_Auth_MySQL/tests/test_acceptance_phase6.py
```
*Salida esperada:*
- `[CONTROL A PASS]`: Publicación y recepción idénticas en `cistern/lab07/prueba`.
- `[CONTROL B PASS]`: Contraseña incorrecta rechazada (`CONNACK 4 / 0x86`).
- `[CONTROL C PASS]`: Permiso denegado verificado (`SUBACK 128 / 0x80`).
- `[CONTROL D PASS]`: Nodos y backend activos con crecimiento de telemetría.
- `TODOS LOS CONTROLES DE LA FASE 6 PASARON CON EXITO`.

#### B. Matriz Completa de Regresión Protocolar (Casos A - I)
Audita exhaustivamente cada permiso de publicación y suscripción de cada una de las 4 identidades:
```powershell
docker exec -i iot_virtual_nodes python /app/lab08/03_Daniel_Auth_MySQL/tests/test_matrix_phase5.py
```

#### C. Verificación Manual de Permisos Denegados
Para evidenciar que las ACLs están funcionando:
1. Conectar con `web_pub_daniel` e intentar suscribirse a `cistern/+/telemetry`. El broker retornará `SUBACK 128` (0x80, suscripción rechazada).
2. Conectar con `web_sub_daniel` e intentar publicar en `cistern/lab07/prueba`. La publicación será descartada por el broker (o rechazada si se usa QoS 1/2).
3. Intentar conectar sin usuario o con contraseña errónea: rechazo inmediato con `CONNACK 0x86`.

---

## 7. Procedimiento de Recuperación y Rollback

### 7.1. Recuperación tras Pérdida de Contenedor EMQX
Si el contenedor de EMQX es eliminado o recreado (`docker compose up -d --force-recreate emqx`), **la configuración de autenticación y autorización se preserva automáticamente** porque reside en el volumen nombrado persistente `emqx_data:/opt/emqx/data` y el nodo posee un FQDN estático (`emqx@node1.emqxnet`).
- No es necesario ejecutar ningún script de reconfiguración.
- El broker se restablece en menos de 5 segundos y los clientes reanudan su conexión.

### 7.2. Recuperación si se Pierde el Volumen de Datos
Si se ejecutó `docker compose down -v` o se dañó el volumen `emqx_data`:
1. Levantar el stack: `docker compose up -d`
2. Reaprovisionar la base MySQL si se perdió: `.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1`
3. Reconfigurar EMQX en caliente: `.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1`
4. Reiniciar `virtual_nodes` para que restablezca suscripciones: `docker compose restart virtual_nodes`

### 7.3. Procedimiento de Rollback a Modo Anónimo (Solo Emergencias de QA)
Si Mario o el equipo necesitan realizar temporalmente pruebas con herramientas antiguas que no soportan autenticación:
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -Rollback
```
Este comando:
- Deshabilita la autenticación MySQL en EMQX.
- Deshabilita la autorización MySQL.
- Restaura la política de autorización a `no_match: allow`.
- Permite conexiones anónimas inmediatas.

Para volver a activar la seguridad obligatoria:
```powershell
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1
```

---

## 8. Políticas de Persistencia y Cuidado de Datos

1. **Nunca ejecutar `docker compose down -v`** en entornos de trabajo compartidos, ya que destruirá tanto el historial de telemetría en `mysql_data` como la configuración de EMQX en `emqx_data`.
2. Para detener los servicios de forma segura use:
   ```powershell
   docker compose stop
   ```
3. Para reanudarlos:
   ```powershell
   docker compose start
   ```
4. El contenedor `iot_virtual_nodes` genera registros en la base de datos a un ritmo aproximado de 1 a 2 inserciones por segundo divididas entre los 4 nodos simuladores. La tabla `telemetria` supera los 22,000 registros verificados. Para consultar el recuento en cualquier momento:
   ```powershell
   docker exec -i mysql_server mysql -u calidad_user -p emqx_db -e "SELECT COUNT(*) AS total_telemetria FROM telemetria;"
   ```

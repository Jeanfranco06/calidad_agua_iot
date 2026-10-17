# AUTENTICACIÓN Y AUTORIZACIÓN MQTT RESPALDADA POR MYSQL (LABORATORIO 08)

**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Responsable:** Daniel  
**Módulo:** `lab08/03_Daniel_Auth_MySQL/`  
**Broker de Mensajería:** EMQX 5.8.0 Open Source  
**Motor de Base de Datos:** MySQL 8.0 Community Server  
**Fecha de Implementación:** 17 de Octubre de 2026  

---

## 1. Alcance y Arquitectura de Seguridad

En el marco del Laboratorio 08, el objetivo técnico consiste en dotar a la plataforma IoT de control de acceso perimetral respaldado por almacenamiento relacional. Para ello se diseñó e implementó la capa de datos y privilegios para:

1. **Autenticación (Authn):** Determinar la identidad del cliente que solicita conectarse al broker mediante verificación criptográfica de usuario y contraseña hasheada con salt.
2. **Autorización (Authz / ACL):** Delimitar de forma estricta los tópicos a los que cada identidad tiene permiso de publicar o suscribirse, bajo el principio de mínimo privilegio (*Principle of Least Privilege*).
3. **Cuenta de Consulta de Mínimo Privilegio (`emqx_ro_user`):** Separar la cuenta con la que el broker EMQX inspecciona la base de datos de las cuentas operativas del simulador y de administración.

> **Importante:** La configuración activa dentro del broker EMQX y la verificación de rechazo de conexiones se abordarán en la Fase 5. En esta Fase 4 se preparó, aplicó y auditó la base de datos MySQL de forma no destructiva.

---

## 2. Fuentes Oficiales Consultadas y Decisiones de Diseño

Para asegurar compatibilidad estricta con **EMQX 5.8.0** y evitar obsolescencias:

| Componente | Documentación Oficial de Referencia | Decisiones Técnicas y Justificación |
|---|---|---|
| **Authn (MySQL)** | [EMQX 5.8 MySQL Password Authentication](https://docs.emqx.com/en/emqx/v5.8/access-control/authn/mysql.html) | Se adoptó el mecanismo nativo `password_based:mysql` de EMQX 5. Se descartó la sintaxis del plugin heredado `emqx_auth_mysql` de EMQX 4.x. Se seleccionó el algoritmo `sha256` con `salt_position: "suffix"` por su compatibilidad nativa con la función `SHA2()` de MySQL 8.0. |
| **Authz (MySQL)** | [EMQX 5.8 MySQL Data Source Authorization](https://docs.emqx.com/en/emqx/v5.8/access-control/authz/mysql.html) | Se estructuró la tabla `mqtt_acl` con columnas `username`, `clientid`, `action`, `permission` y `topic`. Se configuró la consulta de evaluación en orden ascendente con regla comodín `$all` para denegación por defecto. |
| **Diferenciación Conceptual** | *Arquitectura de Control de Acceso* | **No se denomina RBAC** a esta implementación dado que opera mediante listas de control de acceso (ACL) directas por usuario y cliente, sin abstracción de roles intermedios. |

---

## 3. Estructura de Archivos del Módulo

```text
lab08/03_Daniel_Auth_MySQL/
├── 01_schema_auth.sql          # DDL: Creación de tablas mqtt_user y mqtt_acl (idempotente)
├── 02_permissions_data.sql     # DML: Población de identidades y reglas ACL mínimas
├── 03_emqx_queries.sql         # Especificación técnica de consultas parametrizadas para EMQX 5.8
├── 04_create_emqx_ro_user.sql  # DCL: Creación de cuenta MySQL de solo lectura para el broker
├── env.template                # Plantilla de variables de entorno seguras (sin credenciales reales)
├── provision_auth_db.ps1       # Script de aprovisionamiento repetible y automatizado
├── MATRIZ_VERIFICACION_BD.md   # Matriz de pruebas y auditoría de la base de datos
└── README.md                   # Este documento de ingeniería
```

---

## 4. Estructura de Tablas Relacionales

### 4.1. Tabla `mqtt_user` (Autenticación)
Almacena las credenciales de los clientes autorizados a establecer sesión en el broker:

| Campo | Tipo | Nulo | Clave | Descripción |
|---|---|:---:|:---:|---|
| `id` | `INT` | NO | PRI | Identificador único autoincremental |
| `username` | `VARCHAR(100)` | NO | UNI | Identificador único del cliente MQTT (CONNECT) |
| `password_hash` | `VARCHAR(255)` | NO | | Hash SHA-256 de la contraseña + salt |
| `salt` | `VARCHAR(64)` | SÍ | | Sal criptográfica añadida al final de la clave |
| `is_superuser` | `TINYINT(1)` | SÍ | | Indicador de privilegios de superusuario (0 = regular) |
| `created_at` | `TIMESTAMP` | SÍ | | Marca temporal de auditoría de creación |

### 4.2. Tabla `mqtt_acl` (Autorización)
Define las reglas de permiso para las operaciones de publicación y suscripción:

| Campo | Tipo | Nulo | Clave | Descripción |
|---|---|:---:|:---:|---|
| `id` | `INT` | NO | PRI | Identificador autoincremental de la regla |
| `username` | `VARCHAR(100)` | NO | MUL | Usuario destinatario de la regla (o `$all`) |
| `clientid` | `VARCHAR(100)` | SÍ | | Client ID específico opcional para restricción |
| `action` | `ENUM('publish','subscribe','all')` | NO | | Operación MQTT evaluada |
| `permission` | `ENUM('allow','deny')` | NO | | Decisión de control de acceso |
| `topic` | `VARCHAR(255)` | NO | | Filtro de tópicos (admite comodines `+` y `#`) |
| `created_at` | `TIMESTAMP` | SÍ | | Marca temporal de creación |

---

## 5. Matriz de Identidades y Reglas de Mínimo Privilegio

Se definieron 4 identidades operativas sin otorgar superusuarios (`is_superuser = 0` en todas):

| Identidad / Usuario | Rol en la Arquitectura | Tópicos Autorizados | Acciones Permitidas | Justificación Técnica |
|---|---|---|---|---|
| **`web_pub_daniel`** | Publicador Web (Lab 07) | `cistern/lab07/prueba` | `publish` (allow) | Aislamiento estricto: no puede publicar en telemetría de campo ni suscribirse. |
| **`web_sub_daniel`** | Suscriptor Web (Lab 07) | `cistern/lab07/prueba`<br>`cistern/+/telemetry` | `subscribe` (allow)<br>`subscribe` (allow) | Monitoreo pasivo: puede inspeccionar la telemetría y pruebas sin capacidad de emitir datos. |
| **`esp32_nodes`** | Nodos Sensores Simulados | `cistern/+/telemetry`<br>`cistern/+/commands` | `publish` (allow)<br>`subscribe` (allow) | **Alcance documentado:** Los 4 nodos (`ESP32_FISICO_UNT`, `ESP32_V1_BLOQUE_A`, `ESP32_V2_BLOQUE_B` y `ESP32_V3_INCIDENTE`) comparten esta cuenta en el contenedor para emisión de telemetría y recepción de órdenes. |
| **`backend_rules`** | Motor de Reglas Offline | `cistern/+/telemetry`<br>`cistern/+/commands` | `subscribe` (allow)<br>`publish` (allow) | Procesamiento reactivo: ingesta de telemetría y despacho de comandos de control (`STANDBY`, `INTENSIVE_SAMPLING`). |
| **`$all`** | Regla Global de Cierre | `#` | `all` (deny) | **Default Deny:** Cualquier operación sobre tópicos no contemplados explícitamente es rechazada. |

---

## 6. Separación de Cuentas MySQL

Se implementó una separación estricta entre las cuentas del motor de base de datos MySQL:

1. **`root`:** Administración exclusiva del motor relacional; no se utiliza en servicios operativos.
2. **`emqx_user`:** Cuenta de desarrollo/operación utilizada por `phpmyadmin` y por el simulador `iot_virtual_nodes` para persistir lecturas en `telemetria`.
3. **`emqx_ro_user` (Nueva Cuenta de Consulta):**
   - Creada específicamente para la conexión del broker EMQX.
   - Privilegios otorgados: `GRANT SELECT ON emqx_db.mqtt_user` y `GRANT SELECT ON emqx_db.mqtt_acl`.
   - Privilegios revocados: `INSERT, UPDATE, DELETE, DROP, ALTER, CREATE`.
   - Consecuencia: El broker EMQX no puede alterar registros, modificar contraseñas ni corromper las series temporales de la base de datos bajo ninguna circunstancia.

---

## 7. Ejecución Repetible y Rotación de Secretos

El aprovisionamiento de la base de datos se gestiona mediante el script automatizado:

```powershell
# Ejecución normal idempotente (preserva credenciales y reglas sin duplicación)
.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1

# Rotación explícita de credenciales (reemplaza contraseñas y recalcula hashes SHA-256)
.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1 -RotateCredentials
```

- **Manejo Seguro de Secretos:** Las contraseñas en texto plano se generan localmente con entropía criptográfica y se almacenan exclusivamente en `.env` (ignorado por Git).
- **Higiene de Archivos Versionables:** Ningún archivo rastreado por el repositorio contiene contraseñas reales ni valores predeterminados reutilizables.
- **Idempotencia Garantizada:** Claves únicas `uq_mqtt_user_username` y `uq_acl_rule` con cláusulas `ON DUPLICATE KEY UPDATE` aseguran exactamente **4 usuarios** y **8 reglas ACL**.

---

## 8. Integración con EMQX 5.8 (Fase 5)

### 8.1. Configuración de Autenticación y Autorización
La configuración del broker se automatiza mediante el script:

```powershell
# Aplicar configuración reproducible (Authn + Authz MySQL)
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1

# Consultar estado activo
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -StatusOnly

# Procedimiento de Reversión / Rollback (Restaura modo abierto de contingencia)
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -Rollback
```

- **Authn (`password_based:mysql`):**
  - Servidor: `mysql_server:3306` (red interna `emqxnet`).
  - Base de datos: `emqx_db` con usuario de consulta `emqx_ro_user`.
  - Algoritmo: SHA-256 con salt al final (`salt_position: "suffix"`).
  - Consulta: `SELECT password_hash, salt, is_superuser FROM mqtt_user WHERE username = ${username} LIMIT 1`.
- **Authz (`authz:mysql`):**
  - Política por defecto: `no_match = "deny"` (lista blanca estricta).
  - Consulta segura contra suplantación:
    `SELECT action, permission, topic FROM mqtt_acl WHERE (username = ${username} OR username = '$all') AND (clientid IS NULL OR clientid = '' OR clientid = ${clientid}) ORDER BY id ASC`.
  - Fuentes elusivas eliminadas: La fuente basada en archivo (`file` con `{allow, all}`) queda deshabilitada (`enable = false`) para evitar cualquier bypass de la política MySQL.

### 8.2. Persistencia y Topología de Nodos
- **Volumen Persistente:** Se configuró el volumen Docker nombrado `emqx_data:/opt/emqx/data` en `docker-compose.yml`, preservando la base de datos Mnesia y los cambios de configuración en `cluster.hocon`.
- **Nombre de Nodo Estable (FQDN):** Se fijó `hostname: node1.emqxnet` y `EMQX_NODE_NAME=emqx@node1.emqxnet` para asegurar compatibilidad Erlang y consistencia de clúster tras recreaciones.

### 8.3. Adaptación de Clientes
- **Clientes Web (`publicador.html`, `suscriptor.html`):**
  - Campos de entrada para usuario y contraseña con enmascaramiento visual (`type="password"`).
  - Supresión de bucles de reconexión infinita ante rechazo permanente de credenciales (códigos de retorno CONNACK >= 128).
  - Cero persistencia en `localStorage` o bitácoras de consola.
- **Simulador Python (`virtual_simulator/simulator.py`):**
  - Inyección de credenciales desde variables de entorno (`MQTT_USER_NODES`, `MQTT_PASS_NODES`, `MQTT_USER_BACKEND`, `MQTT_PASS_BACKEND`).
  - Restablecimiento automático de suscripciones en callback `on_connect` tras reinicios del broker.

---

## 9. Análisis de Riesgos y Limitaciones

> [!WARNING]
> **Transporte sin Cifrado TLS:** En este entorno de laboratorio, las comunicaciones MQTT y WebSockets operan sobre texto plano (`ws://` en puerto 8083 y TCP en puerto 1883).
> 
> **La autenticación y autorización aquí implementadas NO proporcionan cifrado de transporte.** Las credenciales y los paquetes de datos viajan sin cifrar a nivel de red. En un entorno de producción, es mandatorio habilitar TLS/SSL (`wss://` puerto 8084 y `mqtts://` puerto 8883) con certificados X.509 válidos.

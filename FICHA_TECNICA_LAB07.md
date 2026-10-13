# FICHA TÉCNICA DE INFRAESTRUCTURA — LABORATORIO 07
**Proyecto:** Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Responsable de Infraestructura:** Anthony García Ventura  
**Fecha de Despliegue:** 13 de Octubre de 2026  
**Estado:** Operativo y Verificado (100% Funcional)  

---

## 1. Resumen del Entorno de Ejecución (Host)

* **Sistema Operativo Host:** Windows 11 / WSL2 Linux Kernel `6.6.87.2-microsoft-standard-WSL2`
* **Motor de Contenedores:** Docker Desktop `29.4.0` (build `9d7ad9f`)
* **Orquestador:** Docker Compose `v5.1.2`
* **Driver de Red:** Docker Bridge Network (`emqxnet`)
* **Driver de Almacenamiento:** OverlayFS / Snapshotter v1

---

## 2. Matriz de Contenedores y Servicios Desplegados

| Servicio Compose | Nombre Contenedor | Imagen Base | Versión / Tag | Estado Runtime | Política Restart |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`emqx`** | `emqx_broker` | `emqx/emqx` | `5.8.0 (Open Source)` | `Up (healthy)` | `always` |
| **`mysql`** | `mysql_server` | `mysql` | `8.0` | `Up (healthy)` | `always` |
| **`phpmyadmin`** | `phpmyadmin_gui` | `phpmyadmin/phpmyadmin` | `latest` | `Up (healthy)` | `always` |
| **`virtual_nodes`** | `iot_virtual_nodes` | `calidad_agua_iot-virtual_nodes` | `local-build (python:3.11-slim)` | `Up (healthy)` | `always` |

---

## 3. Topología de Red y Mapeo de Puertos

### 3.1. Red Interna de Docker (`emqxnet`)
* **Nombre de Red:** `emqxnet`
* **Driver:** `bridge`
* **Subred Asignada:** `172.27.0.0/16`
* **Contenedores Conectados:**
  * `emqx_broker` (`172.27.0.2`)
  * `mysql_server` (`172.27.0.3`)
  * `iot_virtual_nodes` (`172.27.0.4`)
  * `phpmyadmin_gui` (`172.27.0.5`)

### 3.2. Mapeo de Puertos Host $\leftrightarrow$ Contenedor

| Protocolo / Función | Puerto Contenedor | Puerto Host Expuesto | URL / Endpoint Local | Destinatario Principal |
| :--- | :--- | :--- | :--- | :--- |
| **MQTT TCP (M2M)** | `1883/tcp` | `1883` | `mqtt://localhost:1883` | Sensores físicos / scripts Python |
| **MQTT WebSocket (WS)** | `8083/tcp` | `8083` | `ws://localhost:8083/mqtt` | Frontend React / Jeanfranco |
| **EMQX Web Dashboard** | `18083/tcp` | `18083` | `http://localhost:18083` | Consola de Monitoreo / Anthony |
| **phpMyAdmin Web GUI** | `80/tcp` | `8080` | `http://localhost:8080` | Inspección de Datos / Anthony |
| **MySQL Relacional** | `3306/tcp` | `3307` | `localhost:3307` | Conexiones DB externas / Workbench |

> **Nota Técnica sobre el Puerto 3307:** El puerto externo de MySQL en el host se expone en `3307` para evitar colisión con el servicio nativo `MySQL80` (puerto 3306) del sistema operativo Windows. La comunicación interna entre contenedores permanece intacta en el puerto estándar `mysql:3306`.

---

## 4. Estado de los Listeners de EMQX 5.8.0

Verificado vía CLI (`emqx ctl listeners`) y Web Dashboard (`http://localhost:18083/#/listener`):

| Nombre Listener | Tipo | Interfaz y Puerto | Estado | Conexiones Actuales / Capacidad | Acceptors |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`default`** | `tcp` | `0.0.0.0:1883` | **Running (Enabled)** | `5 / Infinity` | `16` |
| **`default`** | `ws` | `0.0.0.0:8083` | **Running (Enabled)** | `0 / Infinity` | `16` |
| **`default`** | `ssl` | `0.0.0.0:8883` | **Running (Enabled)** | `0 / Infinity` | `16` |
| **`default`** | `wss` | `0.0.0.0:8084` | **Running (Enabled)** | `0 / Infinity` | `16` |
| **`dashboard`**| `http`| `:18083` | **Running (Enabled)** | N/A | Default |

---

## 5. Clientes MQTT Registrados y Activos

Todos los clientes están conectados con protocolo MQTT v3.1.1, QoS 1 y `CleanSession=true`:

| Client ID | Tipo de Nodo | Tópico de Publicación | Tópico de Suscripción | Comportamiento |
| :--- | :--- | :--- | :--- | :--- |
| **`ESP32_FISICO_UNT`** | Prototipo Real | `cistern/ESP32_FISICO_UNT/telemetry` | `cistern/ESP32_FISICO_UNT/commands` | Telemetría nominal cada 5 s |
| **`ESP32_V1_BLOQUE_A`**| Virtual Docker | `cistern/ESP32_V1_BLOQUE_A/telemetry` | `cistern/ESP32_V1_BLOQUE_A/commands` | Régimen nominal cada 3 s |
| **`ESP32_V2_BLOQUE_B`**| Virtual Docker | `cistern/ESP32_V2_BLOQUE_B/telemetry` | `cistern/ESP32_V2_BLOQUE_B/commands` | Degradación progresiva (+0.04 NTU) |
| **`ESP32_V3_INCIDENTE`**| Virtual Docker | `cistern/ESP32_V3_INCIDENTE/telemetry` | `cistern/ESP32_V3_INCIDENTE/commands` | Inyección de fallas / puesto en STANDBY |
| **`BACKEND_RULES_ENGINE`**| Motor de Reglas | `cistern/+/commands` | `cistern/+/telemetry` | Procesamiento offline y persistencia MySQL |

---

## 6. Almacenamiento y Persistencia

* **Volumen Docker:** `calidad_agua_iot_mysql_data` (Driver: `local`).
* **Base de Datos:** `emqx_db` (MySQL 8.0, UTF-8 Unicode).
* **Tablas Creadas e Inicializadas:**
  1. `dispositivos`: Catálogo ciberfísico (4 registros precargados).
  2. `telemetria`: Series temporales de temperatura, turbidez (NTU), voltaje y estado de alerta.
  3. `bitacora_ordenes_mqtt`: Registro de auditoría de comandos automáticos (`STANDBY`, `INTENSIVE_SAMPLING`).

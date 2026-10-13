# LABORATORIO 07 — GUÍA OPERATIVA Y BITÁCORA DE INFRAESTRUCTURA

**Autor:** Anthony García Ventura  
**Rol:** Primer Responsable del Laboratorio 07 (DevOps & Infraestructura IoT)  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Ubicación de Trabajo:** `C:\Users\Anthony Garcia\calidad_agua_iot`  

---

## 1. Alcance de la Responsabilidad de Anthony

En este laboratorio se cubrieron al 100% los apartados **4.1.1** y **4.1.2** del plan de trabajo:
1. **Apartado 4.1.1 (Verificación de Infraestructura):** Comprobación del host, orquestación de servicios en Docker Compose, validación de estado operativo (`Up`), revisión de logs y topología de red.
2. **Apartado 4.1.2 (Acceso al Dashboard EMQX y Listeners):** Verificación de conectividad a los puertos `1883` (TCP), `8083` (WebSocket) y `18083` (Dashboard), acceso a la consola de administración, auditoría de listeners y verificación de clientes activos.
3. **Consolidación de Evidencias:** Generación y catalogación de capturas de pantalla auténticas numeradas del `L07_P01` al `L07_P07`.
4. **Hand-off Técnico:** Entrega de la infraestructura verificada al siguiente compañero (**Jeanfranco**), quien desarrollará las pruebas de publicación/suscripción mediante WebSockets.

---

## 2. Diagnóstico Inicial e Incidencias Resueltas

### 2.1. Diagnóstico del Entorno
* Se comprobó la disponibilidad de Docker Desktop `29.4.0` y Docker Compose `v5.1.2` en Windows 11 sobre WSL2.
* Se validaron los puertos `1883`, `8083`, `18083` y `8080`, encontrándose completamente libres.

### 2.2. Incidencia Detectada y Solución Técnica Aplicada
* **Incidencia:** El puerto `3306` se encontraba ocupado en el host por el servicio nativo de Windows `MySQL80` (PID 7412, `mysqld`). Intentar levantar el contenedor de MySQL vinculándolo al puerto `3306:3306` provocaría un error fatal de enlace (`bind: address already in use`).
* **Solución DevOps:** Se ajustó el mapeo del host en [`docker-compose.yml`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/docker-compose.yml) a `"3307:3306"`.
  * **Efecto Interno:** Cero impacto. La red interna de Docker (`emqxnet`) continúa comunicando `phpmyadmin` (`PMA_HOST: mysql:3306`) y `iot_virtual_nodes` (`DB_HOST: mysql_server:3306`) en el puerto 3306 estándar.
  * **Efecto Externo:** Permite acceder a MySQL desde el host (ej. MySQL Workbench) mediante el puerto `3307` sin entrar en conflicto con la instalación previa de MySQL de Windows.

---

## 3. Secuencia de Comandos Ejecutados

### Paso 1: Validación de Sintaxis de Docker Compose
```powershell
docker compose config
```
* **Resultado:** Manifiesto validado exitosamente sin errores de sintaxis ni interpolación.

### Paso 2: Construcción y Despliegue de los Servicios
```powershell
docker compose up -d --build
```
* **Resultado:** Red `emqxnet` y volumen `calidad_agua_iot_mysql_data` creados; imagen de nodos virtuales construida; 4 contenedores iniciados en segundo plano.

### Paso 3: Comprobación de Estado Operativo de Contenedores
```powershell
docker compose ps
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```
* **Resultado:** Los 4 contenedores (`emqx_broker`, `mysql_server`, `phpmyadmin_gui`, `iot_virtual_nodes`) en estado `Up`.

### Paso 4: Inspección de Registros Operativos (Logs)
```powershell
docker logs --tail 25 emqx_broker
docker logs --tail 30 iot_virtual_nodes
```
* **Resultado:** EMQX confirmó el inicio de los listeners `tcp:default` (1883), `ws:default` (8083) y `http:dashboard` (18083). El simulador confirmó la conexión de los 4 nodos y la persistencia de telemetría limpia en MySQL.

### Paso 5: Verificación de Red y Puertos en el Host
```powershell
Test-NetConnection -ComputerName localhost -Port 18083
Test-NetConnection -ComputerName localhost -Port 1883
Test-NetConnection -ComputerName localhost -Port 8083
Test-NetConnection -ComputerName localhost -Port 8080
```
* **Resultado:** `TcpTestSucceeded : True` confirmado en los 4 puertos evaluados.

### Paso 6: Auditoría Interna de Listeners y Clientes en EMQX
```powershell
docker exec emqx_broker emqx ctl listeners
docker exec emqx_broker emqx ctl clients list
```
* **Resultado:** 4 listeners habilitados (`running : true`); 5 clientes activos conectados (`ESP32_FISICO_UNT`, `ESP32_V1_BLOQUE_A`, `ESP32_V2_BLOQUE_B`, `ESP32_V3_INCIDENTE`, `BACKEND_RULES_ENGINE`).

---

## 4. Catálogo Oficial de Evidencias Generadas

Las capturas auténticas se encuentran archivadas en [`capturas/`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas):

| Código | Archivo de Evidencia | Descripción del Entregable |
| :--- | :--- | :--- |
| **L07_P01** | [`L07_P01_docker_compose_ps.png`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas/L07_P01_docker_compose_ps.png) | Terminal de salida demostrando los 4 contenedores del stack en estado `Up` con sus puertos y nombres. |
| **L07_P02** | [`L07_P02_docker_logs_infra.png`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas/L07_P02_docker_logs_infra.png) | Terminal de registros confirmando arranque de listeners en EMQX y telemetría/reglas offline en `iot_virtual_nodes`. |
| **L07_P03** | [`L07_P03_emqx_dashboard_login.png`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas/L07_P03_emqx_dashboard_login.png) | Pantalla de inicio de sesión de EMQX Dashboard en `http://localhost:18083`. |
| **L07_P04** | [`L07_P04_emqx_dashboard_overview.png`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas/L07_P04_emqx_dashboard_overview.png) | Panel general (Cluster Overview) mostrando el nodo `emqx@172.27.0.2`, 5 conexiones vivas y tasa de mensajes. |
| **L07_P05** | [`L07_P05_emqx_listeners_status.png`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas/L07_P05_emqx_listeners_status.png) | Panel de Listeners (`/#/listener`) mostrando los puertos `1883` (TCP) y `8083` (WS) habilitados y operativos. |
| **L07_P06** | [`L07_P06_emqx_clients_connected.png`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas/L07_P06_emqx_clients_connected.png) | Panel de Clientes (`/#/clients`) evidenciando los 5 clientes conectados con sus identificadores de sesión. |
| **L07_P07** | [`L07_P07_phpmyadmin_servicios.png`](file:///C:/Users/Anthony%20Garcia/calidad_agua_iot/capturas/L07_P07_phpmyadmin_servicios.png) | Interfaz web de phpMyAdmin (`http://localhost:8080`) con las lecturas persistidas en la tabla `telemetria`. |

---

## 5. Instrucciones de Transferencia para Jeanfranco (Hand-off)

Estimado Jeanfranco, la infraestructura inicial ha sido desplegada, auditada y certificada para tu fase de pruebas:

* **Dirección del Broker (Host):** `localhost` (o la IP local del equipo en la LAN).
* **Puerto WebSocket:** `8083`
* **Ruta de Conexión WebSocket:** `ws://localhost:8083/mqtt`
* **Subprotocolo WebSocket:** `mqtt`
* **Credenciales EMQX Dashboard (Monitoreo):**
  * URL: `http://localhost:18083`
  * Usuario: `admin`
  * Contraseña inicial: `public`
* **Tópicos Activos para Pruebas de Pub/Sub:**
  * **Telemetría entrante (Suscripción):** `cistern/+/telemetry`
  * **Telemetría por nodo específico:** `cistern/ESP32_V1_BLOQUE_A/telemetry`
  * **Comandos remotos (Publicación):** `cistern/<device_id>/commands` (ej. `cistern/ESP32_V2_BLOQUE_B/commands`)
* **Formato de Carga Útil (Payload de Órdenes):**
  ```json
  {
    "target_device": "ESP32_V2_BLOQUE_B",
    "set_sampling_rate": 2,
    "action": "NORMAL_MONITORING"
  }
  ```
* **phpMyAdmin (Inspección de BD):** `http://localhost:8080` (Base de datos: `emqx_db`).

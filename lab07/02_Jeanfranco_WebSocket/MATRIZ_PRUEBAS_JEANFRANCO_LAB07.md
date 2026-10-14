# MATRIZ DE PRUEBAS — LABORATORIO 07 (Jeanfranco)

**Fecha de ejecución:** 14 de octubre de 2026  
**Entorno:** EMQX 5.8.0 en Docker (`emqx_broker`), host `localhost`, red `emqxnet`  
**Herramienta de prueba:** WebSocket Client integrado de EMQX Dashboard (`http://localhost:18083/#/websocket`) + verificación complementaria por CLI (`emqx ctl`) y API REST (`/api/v5`)

| ID | Prueba | Entrada | Resultado esperado | Resultado obtenido | Estado | Evidencia |
|----|--------|---------|--------------------|--------------------|--------|-----------|
| P01 | Listener WebSocket | EMQX (`#/listener`, `emqx ctl listeners`, `GET /api/v5/listeners`) | 8083 habilitado | Listener `ws:default` en `0.0.0.0:8083`, Enable=true, Running=true, 0/Infinity conexiones (baseline previo a la prueba) | CONFORME | `01_Listener_WebSocket.png` |
| P02 | Conexión WS | Cliente MQTT: host `localhost`, port `8083`, path `/mqtt`, MQTT 5, keepalive 60, clean start true, expiry 0, TLS false, sin credenciales, Client ID `lab07_jeanfranco_sub` | Connected | Conexión establecida; notificación "lab07_jeanfranco_sub is Connected"; botón cambió a *Disconnect*; detalle del cliente confirma Protocolo MQTT v5.0 y Listener `ws:default` | CONFORME | `02_Conexion_WebSocket.png` |
| P03 | Suscripción | Tópico `cistern/lab07/prueba`, QoS 0 | Suscripción activa | Fila de suscripción visible con acción *Cancel* (equivale a suscripción vigente); API `/api/v5/subscriptions` devuelve `topic=cistern/lab07/prueba, qos=0` para `lab07_jeanfranco_sub` | CONFORME | `03_Suscripcion_MQTT.png` |
| P04 | Publicación | Payload JSON de laboratorio (7 campos), QoS 0, Retain false | Mensaje publicado | Tabla *Published* muestra `cistern/lab07/prueba` con el payload JSON completo (publicación 18:05:48) | CONFORME | `04_Publicacion_JSON.png` |
| P05 | Recepción | Bucle pub/sub sobre `cistern/lab07/prueba` | Mensaje recibido sin alteración | Tabla *Received* registra dos recepciones (18:05:48 y 18:05:53) con el payload idéntico al publicado; verificados campo a campo: `device_id`, `tipo`, `mensaje`, `valor`, `unidad`, `origen`, `estado` sin cambios | CONFORME | `05_Recepcion_MQTT.png` |
| P06 | Dos clientes | Suscriptor `lab07_jeanfranco_sub` y publicador `lab07_jeanfranco_pub` en sesiones independientes | Comunicación correcta PUB→SUB | El publicador envió el JSON a las 17:52:11 y el suscriptor independiente lo recibió a las 17:52:12 en su tabla *Received*; ambas sesiones *Connected* simultáneamente | CONFORME | `06_Dos_Clientes_WebSocket.png` (compuesta: suscriptor / publicador) |
| P07 | Clients EMQX | Client IDs `lab07_jeanfranco_sub`, `lab07_jeanfranco_pub` | Connected | Ambos listados como `Connected` con IP `172.18.0.1:<puerto>`, keepalive 60, clean start true, session expiry 0; API confirma `proto_name=MQTT`, `proto_ver=5` | CONFORME | `07_Clientes_EMQX.png` |
| P08 | Topic EMQX | Tópico `cistern/lab07/prueba` | Visible | Visible en la página Subscriptions/Topics del Dashboard con el suscriptor `lab07_jeanfranco_sub` y QoS 0; también listado por `emqx ctl topics list` (`cistern/lab07/prueba -> emqx@172.18.0.4`) | CONFORME | `08_Topico_EMQX.png` |
| P09 | Listener activo | WebSocket, con ambas sesiones vivas | Conexiones activas | `ws:default` (`0.0.0.0:8083`) reporta `2/Infinity` conexiones (antes de la prueba: `0/Infinity`); CLI y API coinciden | CONFORME | `09_Listener_Con_Conexion.png` |
| P10 | Telemetría real | Suscripción de solo lectura `cistern/+/telemetry` (QoS 0, sin publicar) | Mensaje real identificado | Mensajes recibidos de `ESP32_FISICO_UNT`, `ESP32_V1_BLOQUE_A` y `ESP32_V2_BLOQUE_B` con payload JSON completo (`device_id`, `location`, `timestamp`, `hardware_health`, `metrics.turbidity_ntu`, `metrics.temperature_c`, `metrics.pin_voltage_v`). `ESP32_V3_INCIDENTE` no emite: permanece en `STANDBY` por orden del motor de reglas | CONFORME | `10_Telemetria_Real.png` |

## Notas de ejecución

1. **Baseline del listener WebSocket:** al iniciar la etapa, `ws:default` tenía `0` conexiones (coherente con el hand-off de Anthony). Durante la prueba con dos clientes simultáneos alcanzó `2`.
2. **Búsqueda en Clients:** el filtro "Exact Query" del Dashboard no coincide con subcadenas (`lab07` devolvió *No Data*); la evidencia se tomó con el listado general, donde ambos clientes aparecen en las primeras filas.
3. **Página de tópicos:** en EMQX 5.8 la vista de tópicos es una pestaña dentro de `/#/subscriptions` (la ruta `/#/topics` devuelve 404).
4. **No se modificó** el simulador, el motor de reglas, la base de datos, listeners, autenticación, ACL, Docker Compose ni credenciales. No se publicó en tópicos reales de telemetría.

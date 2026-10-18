# MATRIZ DE PRUEBAS FUNCIONALES Y AUDITORÍA — LABORATORIO 07 (APARTADO 4.1.4)

**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Responsable:** Daniel  
**Entorno Evaluado:** Clientes Web MQTT en `lab07/03_Daniel_Clientes_Web/` servidos vía `http://localhost:8085`  
**Broker de Mensajería:** EMQX 5.8.0 Open Source (`ws://localhost:8083/mqtt`)  
**Fecha de Ejecución:** 17 de Octubre de 2026  

---

## 1. Resumen Ejecutivo de la Auditoría

Se ejecutó la totalidad de la matriz de pruebas (P01 a P10) sobre los clientes web `publicador.html` y `suscriptor.html` empleando `mqtt.js 5.10.3` sobre WebSockets. Todas las pruebas funcionales resultaron **APROBADAS (10/10)**, confirmando la estabilidad del ciclo de vida de conexión, la bidireccionalidad en tópicos aislados de laboratorio, el manejo de QoS 0 y QoS 1 con acuse de recibo de protocolo, la validación sintáctica previa al despacho y el renderizado seguro contra inyecciones XSS.

| ID | Prueba Auditada | Entrada / Parámetros Clave | Resultado Esperado | Resultado Observado | Estado |
|---|---|---|---|---|:---:|
| **P01** | Conexión Independiente | URL `ws://localhost:8083/mqtt`, prefijos `web_pub_daniel` y `web_sub_daniel` | Sesiones simultáneas con Client ID únicos en EMQX | Ambos conectados con IDs distintos; 2 sesiones activas en broker | **APROBADA** |
| **P02** | Envío/Recepción QoS 0 | Tópico `cistern/lab07/prueba`, payload `TEST_P02_QOS0_AUDIT`, QoS 0 | Despacho local confirmado y recepción idéntica con QoS 0 | Confirmación local emitida; mensaje capturado con QoS 0 | **APROBADA** |
| **P03** | Envío/Recepción QoS 1 | Tópico `cistern/lab07/prueba`, payload `TEST_P03_QOS1_AUDIT`, QoS 1 | SUBACK concedido QoS 1, acuse PUBACK en publicador, entrega con QoS 1 | SUBACK QoS 1 observado, paquete PUBACK recibido (MessageId 1955), entrega QoS 1 | **APROBADA** |
| **P04** | Validación JSON Inválido | Payload malformado: `{ "test_id": "TEST_P04_INVALID", "mensaje": }` | Bloqueo local de publicación y reporte visual de error | Error sintáctico detectado; publicación abortada; 0 fugas al suscriptor | **APROBADA** |
| **P05** | Cancelar Suscripción | UNSUBSCRIBE en `cistern/lab07/prueba`, envío de `TEST_P05_UNSUB_BLOCKED` | UNSUBACK confirmado; supresión de mensajes; re-suscripción exitosa | UNSUBACK recibido; 0 mensajes en ventana de 3s; re-suscripción recibió `TEST_P05_RESUB_OK` | **APROBADA** |
| **P06** | Desconexión Manual | Cierre voluntario mediante botón Desconectar | Desaparición de sesiones en EMQX y ausencia de reconexión automática | Sesiones eliminadas en EMQX; 0 reconexiones tras 10 segundos | **APROBADA** |
| **P07** | Fallo y Recuperación WS | Interrupción abrupta de socket (`stream.destroy`) sin alterar broker | Secuencia `close`/`offline` -> `reconnect` -> `connect` con restauración de tópicos | Reconexión automática a los 3s; tópico restaurado; recepción post-corte OK | **APROBADA** |
| **P08** | Doble Pulsación / Instancias | Clicks repetidos en Conectar y apertura de múltiples pestañas | Control de debounce activo y Client IDs pseudo-aleatorios únicos | Intentos concurrentes bloqueados (1 conexión efectiva); IDs divergentes | **APROBADA** |
| **P09** | Lectura de Telemetría | Suscripción a comodín `cistern/+/telemetry` (solo lectura) | Captura de telemetría continua de los nodos simulados | Recepción de `ESP32_V1_BLOQUE_A`, `ESP32_V2_BLOQUE_B` y `ESP32_FISICO_UNT` | **APROBADA** |
| **P10** | Renderizado Seguro e Historial | Inyección HTML `<img src=x onerror=...>`, payload texto plano, 65 msgs | Inserción como texto seguro (`textContent`), soporte no-JSON y límite de 50 msgs | Etiquetas renderizadas literalmente; texto plano soportado; historial podado a 50 | **APROBADA** |

---

## 2. Detalle Exhaustivo de las Pruebas

### P01 — Conexión Independiente
- **Objetivo:** Verificar que el publicador y el suscriptor puedan conectarse de manera concurrente al broker EMQX sin interferencias, colisiones de identificador ni sobrescritura de sesiones.
- **Configuración y Entrada:**
  - Broker URL: `ws://localhost:8083/mqtt`
  - Publicador ID: `web_pub_daniel_cad20f`
  - Suscriptor ID: `web_sub_daniel_699270`
  - Protocolo: MQTT v5.0 (`protocolVersion: 5`), Clean Start: `true`, Keepalive: 60s.
- **Resultado Esperado:** Dos conexiones simultáneas registradas con estado `connected: true` en la tabla de clientes de EMQX.
- **Resultado Observado:** Inspección en EMQX CLI (`emqx ctl clients list`) confirmó:
  ```text
  Client(web_sub_daniel_699270, username=undefined, peername=172.26.0.1:48320, clean_start=true, connected=true)
  Client(web_pub_daniel_cad20f, username=undefined, peername=172.26.0.1:48324, clean_start=true, connected=true)
  ```
- **Estado:** **APROBADA**
- **Limitaciones:** Conexiones anónimas permitidas de forma deliberada en esta fase (autenticación MySQL se implementa en Lab 08).

---

### P02 — Envío y Recepción con QoS 0
- **Objetivo:** Evaluar el flujo básico de publicación y suscripción no confirmada (At most once) en el tópico aislado de pruebas.
- **Configuración y Entrada:**
  - Tópico: `cistern/lab07/prueba`
  - QoS solicitado: `0`
  - Retain: `false`
  - Payload:
    ```json
    {
      "test_id": "TEST_P02_QOS0_AUDIT",
      "device_id": "LAB07_TEST",
      "mensaje": "Prueba QoS 0 exitosa",
      "valor": 25.5,
      "unidad": "NTU",
      "estado": "TEST"
    }
    ```
- **Resultado Esperado:** El publicador debe registrar la confirmación local del despacho (sin indicar erróneamente entrega al destinatario). El suscriptor debe capturar el payload idéntico con `packet.qos = 0`.
- **Resultado Observado:**
  - Publicador: Registró `[CONFIRMACIÓN LOCAL OK] | Tópico: cistern/lab07/prueba | QoS: 0 | Retain: false`.
  - Suscriptor: Reportó `[MENSAJE RECIBIDO] | Tópico: cistern/lab07/prueba | QoS: 0 | Retain: false` con el contenido íntegro y `test_id: TEST_P02_QOS0_AUDIT`.
- **Estado:** **APROBADA**

---

### P03 — Envío y Recepción con QoS 1 (con Acuse PUBACK)
- **Objetivo:** Auditar la entrega garantizada al menos una vez (At least once), verificando el acuse de recibo de nivel de protocolo entre el publicador y el broker, y la entrega al suscriptor.
- **Configuración y Entrada:**
  - Suscriptor: Solicitud de suscripción con `QoS 1`.
  - Publicador: Envío con `QoS 1`, Retain: `false`, Payload con `test_id: "TEST_P03_QOS1_AUDIT"`.
- **Resultado Esperado:** 
  1. El suscriptor recibe `SUBACK` con código de concesión `1`.
  2. El cliente publicador genera un identificador de paquete (`MessageId`) para el mensaje `PUBLISH` saliente con QoS 1, y el broker EMQX devuelve dicho identificador dentro del paquete de control `PUBACK` para correlacionar y acreditar la recepción.
  3. El suscriptor recibe el mensaje con `qos: 1`.
- **Resultado Observado:**
  - Suscriptor: `granted[0].qos: 1` confirmado en callback y paquete `suback`.
  - Publicador: Paquete `puback` capturado por `client.on('packetreceive')` conteniendo el `MessageId: 1955` asignado originalmente al despacho.
  - Suscriptor: Mensaje recibido con `packet.qos: 1`.
- **Aclaración Técnica:** QoS 1 garantiza entrega *al menos una vez* hacia el broker y hacia el suscriptor activo mediante el intercambio `PUBLISH` -> `PUBACK`; no constituye entrega *exactamente una vez* (QoS 2) ni garantiza persistencia offline tras desconexión (dado que `clean: true`).
- **Estado:** **APROBADA**

---

### P04 — Validación y Bloqueo de JSON Inválido
- **Objetivo:** Comprobar que el publicador valide la sintaxis del payload antes de intentar emitirlo hacia el broker, evitando despachos truncados o corruptos.
- **Configuración y Entrada:**
  - Payload ingresado en editor: `{ "test_id": "TEST_P04_INVALID", "mensaje": }` (sintaxis rota intencional).
  - Acción: Pulsación de `Publicar Mensaje`.
- **Resultado Esperado:** La función de validación detecta el error de parseo (`SyntaxError`), actualiza el banner visual de error en la UI, registra el fallo en la bitácora local y **aborta** la llamada a `client.publish()`. El suscriptor no debe recibir nada.
- **Resultado Observado:**
  - Publicador: Banner rojo desplegado con texto: `No se puede publicar: JSON inválido (Unexpected token '}', ..."mensaje": }" is not valid JSON)`.
  - Bitácora: `[RECHAZO LOCAL] Intento de publicación abortado: error de sintaxis en JSON`.
  - Suscriptor: 0 mensajes recibidos. Fuga de datos descartada.
- **Estado:** **APROBADA**

---

### P05 — Cancelación de Suscripción (Unsubscribe)
- **Objetivo:** Verificar la revocación efectiva de la suscripción y el cese de recepción de eventos telemétricos en el suscriptor web.
- **Configuración y Entrada:**
  - Suscriptor ejecuta `cancelarSuscripcion()` sobre `cistern/lab07/prueba`.
  - Publicador envía mensaje de prueba `TEST_P05_UNSUB_BLOCKED`.
  - Ventana de observación: 3.0 segundos.
  - Suscriptor vuelve a suscribirse y publicador envía `TEST_P05_RESUB_OK`.
- **Resultado Esperado:** Recepción de paquete `unsuback`; ningún mensaje recibido durante la ventana de desuscripción; reanudación normal tras re-suscribir.
- **Resultado Observado:**
  - Paquete `unsuback` recibido y registrado.
  - El mensaje `TEST_P05_UNSUB_BLOCKED` fue descartado por el broker hacia este cliente (0 recepciones).
  - Tras re-suscribir, `TEST_P05_RESUB_OK` fue recibido de inmediato.
- **Estado:** **APROBADA**

---

### P06 — Desconexión Manual y Control de Ciclo de Vida
- **Objetivo:** Auditar la finalización voluntaria de la sesión, la destrucción de sockets y la supresión de reconexiones automáticas no solicitadas.
- **Configuración y Entrada:**
  - Pulsación del botón `Desconectar` en ambos clientes (`client.end(true)`).
  - Ventana de monitoreo: 10 segundos continuos.
- **Resultado Esperado:** Desaparición inmediata de las sesiones en la tabla de clientes de EMQX; badge en estado `DESCONECTADO`; bloqueo del botón publicar; ausencia de reconexiones automáticas.
- **Resultado Observado:**
  - Clientes removidos de `emqx ctl clients list` a los 1.5 s.
  - Tras 10.0 segundos, ninguna sesión de Daniel reapareció en el broker (`noAutoReconnectAfter10s: true`).
  - Al pulsar publicar con el cliente desconectado, la interfaz despliega: `Error: Debes conectarte al broker antes de publicar.`
- **Estado:** **APROBADA**

---

### P07 — Fallo y Recuperación de Transporte WebSocket
- **Objetivo:** Evaluar la resiliencia del cliente web ante una caída abrupta del canal WebSocket y la capacidad de restaurar automáticamente las suscripciones activas al restablecerse el enlace.
- **Configuración y Entrada:**
  - Suscriptor conectado y suscrito a `cistern/lab07/prueba`.
  - Se fuerza la destrucción del socket subyacente mediante `client.stream.destroy()` sin detener el contenedor de EMQX ni interferir en los demás servicios.
  - Periodo de reconexión configurado en mqtt.js: 3000 ms.
- **Resultado Esperado:** Disparo secuencial de eventos `close` y `reconnect`; reconexión automática exitosa (`connect`); re-suscripción transparente sin duplicar listeners; recepción de un nuevo mensaje `TEST_P07_RECONNECT`.
- **Resultado Observado:**
  - Evento `close` registrado: `Canal WebSocket cerrado inesperadamente. El cliente intentará reconectar.`
  - Evento `reconnect` registrado a los 3 segundos.
  - Evento `connect` disparado con éxito; el callback re-suscribió a `cistern/lab07/prueba`.
  - El publicador emitió `TEST_P07_RECONNECT` y el suscriptor lo recibió de forma íntegra (`postRecoveryMessageReceived: true`).
- **Estado:** **APROBADA**

---

### P08 — Prevención de Doble Pulsación y Múltiples Instancias
- **Objetivo:** Comprobar la protección contra pulsaciones repetidas en los botones de conexión y garantizar que múltiples pestañas del navegador operen con Client IDs independientes.
- **Configuración y Entrada:**
  - Simulación de pulsaciones triples concurrentes sobre el botón `Conectar`.
  - Generación de Client IDs para dos pestañas paralelas mediante `generateClientId()`.
- **Resultado Esperado:** La bandera `isConnecting` y la desactivación del botón deben filtrar pulsaciones redundantes; los IDs deben ser estrictamente distintos.
- **Resultado Observado:**
  - Clicks repetidos ignorados: 1 solo socket instanciado (`attemptsWithDebounce: 1`).
  - IDs generados: `web_sub_daniel_699270` y `web_sub_daniel_2e91b4` (divergencia garantizada por sufijo hexadecimal).
- **Estado:** **APROBADA**

---

### P09 — Lectura de Telemetría Real (Solo Lectura)
- **Objetivo:** Verificar la capacidad del suscriptor web para inspeccionar las tramas telemétricas emitidas por los nodos virtualizados bajo la jerarquía `cistern/+/telemetry`, garantizando que no se publiquen datos falsos en dicho canal.
- **Configuración y Entrada:**
  - Tópico: `cistern/+/telemetry`
  - Ventana de escucha pasiva: 6.0 segundos.
- **Resultado Esperado:** Captura de telemetría de al menos 2 dispositivos distintos con métricas de turbidez, temperatura y voltaje, sin intervención sobre los simuladores.
- **Resultado Observado:**
  - Se capturaron 9 tramas telemétricas en 6 segundos.
  - Dispositivos observados: `ESP32_V1_BLOQUE_A`, `ESP32_V2_BLOQUE_B` y `ESP32_FISICO_UNT`.
  - Valores representativos: Turbidez entre 1.49 NTU y 135 NTU (acorde a la degradación programada de V2).
- **Aclaración Crítica de Auditoría:**  
  Tal como se demostró en la Fase 1, **`ESP32_FISICO_UNT` es un nodo simulado por software** que corre dentro del contenedor `iot_virtual_nodes` (`simulator.py`). Su nombre es un identificador de catálogo, no una prueba de instrumentación física activa en este host.
- **Estado:** **APROBADA**

---

### P10 — Renderizado Seguro contra Inyecciones e Historial Acotado
- **Objetivo:** Verificar la neutralización de ataques XSS en los payloads recibidos, el manejo robusto de tramas que no corresponden a formato JSON y la restricción de memoria en el DOM.
- **Configuración y Entrada:**
  - Payload 1: JSON con campo `mensaje: "<img src=x onerror=alert('XSS')> <b>Texto Negrita</b> <script>alert(1)</script>"`.
  - Payload 2: Cadena de texto plano `TEXTO_PLANO_NO_JSON_TEST_AUDIT` emitida al tópico de pruebas.
  - Búfer: Inserción de 65 mensajes continuos en el flujo.
- **Resultado Esperado:**
  1. El código HTML/script no debe ejecutarse ni interpretarse como elementos del DOM; debe renderizarse como texto puro (`textContent`).
  2. El payload no-JSON debe mostrarse íntegro sin generar excepciones en `JSON.parse`.
  3. El historial visible en pantalla debe podarse a un máximo estricto de 50 entradas.
- **Resultado Observado:**
  - Las etiquetas `<img ...>` y `<script>` se mostraron textualmente como cadenas de caracteres sin interactividad.
  - El texto plano se desplegó correctamente en el registro sin romper la aplicación.
  - Tras emitir 65 mensajes, el contenedor mantuvo exactamente 50 nodos hijos (`historyTrimmedToMax: true`).
- **Estado:** **APROBADA**

---

## 3. Instrucciones para la Toma de Capturas Manuales

Las siguientes capturas oficiales deben guardarse en el directorio [`evidencias/daniel/lab07/`](file:///c:/Users/Daniel/Downloads/calidad_agua_iot/evidencias/daniel/lab07/):

1. **`L07_DAN_03_envio_recepcion.png`:**
   - **Momento:** Con ambos clientes conectados y el suscriptor suscrito a `cistern/lab07/prueba`.
   - **Procedimiento:** Publica un mensaje con `test_id: "TEST_L07_CAPTURA_03"`. Toma la captura de pantalla dividida mostrando a la izquierda la confirmación local del publicador y a la derecha el mensaje recibido en el suscriptor con el mismo `test_id`.
2. **`L07_DAN_04_reconexion.png`:**
   - **Momento:** En `suscriptor.html`, con sesión conectada y suscrita.
   - **Procedimiento:** Pulsa el botón `⚡ Simular Corte WS (P07)`. Espera 3 segundos a que la reconexión automática se complete y se restaure la suscripción. Captura la bitácora del ciclo de vida donde se aprecie la secuencia: `[SIMULACIÓN P07]` -> `[EVENTO: close]` -> `[EVENTO: reconnect]` -> `[EVENTO: connect]` -> `[RESTAURACIÓN]`.
3. **`L07_DAN_05_clientes_emqx.png`:**
   - **Momento:** Con el publicador y el suscriptor conectados simultáneamente.
   - **Procedimiento:** Abre la consola de administración de EMQX en `http://localhost:18083/#/clients` (o ejecuta `docker exec emqx_broker emqx ctl clients list` en terminal). Captura la lista evidenciando las sesiones vivas de `web_pub_daniel_...` y `web_sub_daniel_...` junto a los nodos sensores.
4. **`L07_DAN_06_qos1.png`:**
   - **Momento:** Tras ejecutar una publicación con `QoS 1`.
   - **Procedimiento:** Captura la bitácora del publicador mostrando la línea verde `[MQTT PACKET: PUBACK]` con su respectivo `MessageId`, y en el suscriptor la cabecera `[MENSAJE RECIBIDO] ... | QoS: 1`.
5. **`L07_DAN_07_json_invalido.png`:**
   - **Momento:** En `publicador.html`.
   - **Procedimiento:** Borra una llave o valor en el editor JSON y pulsa `Publicar Mensaje`. Captura la interfaz mostrando el banner rojo superior de advertencia `No se puede publicar: JSON inválido` y la entrada correspondiente en la bitácora.

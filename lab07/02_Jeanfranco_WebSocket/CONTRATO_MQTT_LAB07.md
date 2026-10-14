# CONTRATO MQTT LAB 07

**Responsable de la validación:** Jeanfranco (etapa 4.1.3 — Verificación de comunicación MQTT mediante WebSocket)  
**Fecha de validación:** 14 de octubre de 2026  
**Estado:** Validado sobre infraestructura desplegada por Anthony García Ventura (4.1.1 / 4.1.2)

---

## 1. Broker

- **Plataforma:** EMQX Open Source
- **Versión:** 5.8.0
- **Host:** `localhost` (equipo anfitrión Windows; broker contenido en Docker, red `emqxnet`)
- **MQTT TCP:** `1883`
- **MQTT WebSocket:** `8083`
- **Dashboard:** `http://localhost:18083`

## 2. WebSocket

- **URL:** `ws://localhost:8083/mqtt`
- **Host:** `localhost`
- **Port:** `8083`
- **Path:** `/mqtt`
- **TLS:** `false` (sin cifrado; el listener WSS `8084` está habilitado pero no fue utilizado)
- **MQTT Version:** `MQTT 5` (`proto_name=MQTT`, `proto_ver=5` confirmado vía API EMQX y ficha de detalle del cliente)
- **Keepalive:** `60`
- **Clean Start:** `true`
- **Session Expiry:** `0`

## 3. Autenticación

- **Dashboard:** requiere usuario y contraseña (credenciales del despliegue inicial; ver `README_LAB07.md` de Anthony — no se reproducen aquí)
- **MQTT:** **no requiere autenticación** — la conexión se realizó con usuario y contraseña vacíos (cliente anónimo)
- **ACL:** política por defecto de EMQX sin restricciones aplicadas: suscripción y publicación permitidas en `cistern/lab07/prueba` y en `cistern/+/telemetry`
- **Estado de validación:** CONFIRMADO mediante conexión, suscripción, publicación y recepción exitosas sin credenciales MQTT

## 4. Clientes de prueba

- **Subscriber Client ID:** `lab07_jeanfranco_sub`
- **Publisher Client ID:** `lab07_jeanfranco_pub`

Ambos Client ID fueron observados como `Connected` simultáneos en el Dashboard EMQX (ruta `#/clients`), con protocolo MQTT v5 y listener `ws:default`.

## 5. Tópico de prueba

```
cistern/lab07/prueba
```

Tópico aislado de laboratorio. No corresponde a telemetría real.

## 6. QoS

`0`

## 7. Retain

`false`

## 8. Payload de prueba

```json
{
  "device_id": "LAB07_TEST",
  "tipo": "prueba_websocket",
  "mensaje": "Prueba MQTT WebSocket exitosa",
  "valor": 25.5,
  "unidad": "NTU",
  "origen": "Jeanfranco",
  "estado": "TEST"
}
```

Declaración expresa: `LAB07_TEST` **no** representa un dispositivo real; `25.5` **no** representa una lectura real; `TEST` identifica el mensaje como de laboratorio.

## 9. Tópicos reales confirmados

Observados en el entorno operativo (suscripciones activas, lista `emqx ctl topics list` y recepción directa):

| Tópico | Dirección | Estado de observación |
|---|---|---|
| `cistern/ESP32_FISICO_UNT/telemetry` | nodo → broker | CONFIRMADO (mensajes recibidos en ventana de observación) |
| `cistern/ESP32_V1_BLOQUE_A/telemetry` | nodo → broker | CONFIRMADO (mensajes recibidos) |
| `cistern/ESP32_V2_BLOQUE_B/telemetry` | nodo → broker | CONFIRMADO (mensajes recibidos; emisión a ~1 msg/s por orden `INTENSIVE_SAMPLING`) |
| `cistern/ESP32_V3_INCIDENTE/telemetry` | nodo → broker | TÓPICO DECLARADO EN EL SIMULADOR; sin mensajes observados en la ventana de validación porque el nodo permanece en `STANDBY` (orden del motor de reglas) |
| `cistern/<device_id>/commands` | backend → nodo | CONFIRMADO (suscripciones activas de los 4 nodos y de `BACKEND_RULES_ENGINE` publicando a `cistern/+/commands`) |
| `cistern/+/telemetry` | suscripción del backend | CONFIRMADO (suscripción activa de `BACKEND_RULES_ENGINE`) |

## 10. Payload real confirmado

Capturado el 14/10/2026 mediante suscripción de solo lectura a `cistern/+/telemetry` sobre WebSocket:

```json
{"device_id": "ESP32_FISICO_UNT", "location": "Cisterna Comedor UNT", "timestamp": 1792018262, "hardware_health": "OK", "metrics": {"turbidity_ntu": 1.9, "temperature_c": 21.81, "pin_voltage_v": 2.997}}
```

Estructura observada (sin modificar nombres ni tipos):

| Clave | Tipo observado | Unidad / descripción |
|---|---|---|
| `device_id` | string | identificador del nodo |
| `location` | string | ubicación de la cisterna |
| `timestamp` | integer | epoch Unix (segundos) |
| `hardware_health` | string | `OK` (valores observados en ventana nominal) |
| `metrics.turbidity_ntu` | float / null | turbidez en NTU (null en escenario de falla del V3, según simulador) |
| `metrics.temperature_c` | float | temperatura en °C |
| `metrics.pin_voltage_v` | float | voltaje del sensor en V |

Frecuencia aproximada observada: `ESP32_FISICO_UNT` ≈ 5 s; `ESP32_V1_BLOQUE_A` ≈ 3 s; `ESP32_V2_BLOQUE_B` ≈ 1 s (regimen acelerado autónomo); `ESP32_V3_INCIDENTE` sin emisión (STANDBY).

## 11. Resultados

| Elemento | Resultado |
|---|---|
| Listener WebSocket | CONFORME — `ws:default` en `0.0.0.0:8083`, Enabled/Running, 0 conexiones al inicio (baseline) y 2 conexiones durante la prueba |
| Conexión | CONFORME — `lab07_jeanfranco_sub` y `lab07_jeanfranco_pub` conectados vía `ws://localhost:8083/mqtt`, MQTT 5 |
| Suscripción | CONFORME — `cistern/lab07/prueba` QoS 0 activa |
| Publicación | CONFORME — payload JSON publicado en `cistern/lab07/prueba` (tabla *Published*) |
| Recepción | CONFORME — mensaje recibido íntegro (tabla *Received*), campos sin alterar |
| Dos clientes | CONFORME — publicador independiente → suscriptor independiente recibió el mensaje |
| Clients EMQX | CONFORME — ambos Client ID `Connected` en `#/clients` y en `GET /api/v5/clients` |
| Topics EMQX | CONFORME — `cistern/lab07/prueba` visible con suscriptor asociado (pestaña Topics/Subscriptions) |
| Telemetría real | CONFORME — identificada y capturada por suscripción de solo lectura (ver secciones 9 y 10) |

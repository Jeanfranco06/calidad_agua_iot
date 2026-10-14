# ENTREGA PARA DANIEL — LABORATORIO 07

**De:** Jeanfranco (validación MQTT sobre WebSocket, etapa 4.1.3)  
**Para:** Daniel (implementación de `publicacion.php` y `suscritor.php`)  
**Fecha:** 14 de octubre de 2026  
**Objeto:** parámetros y contratos técnicos CONFIRMADOS experimentalmente para el desarrollo de los componentes web PHP.

---

## A. PARÁMETROS DE CONEXIÓN

| Parámetro | Valor | Estado |
|---|---|---|
| Host del broker | `localhost` | CONFIRMADO |
| URL WebSocket | `ws://localhost:8083/mqtt` | CONFIRMADO |
| Puerto | `8083` | CONFIRMADO |
| Path | `/mqtt` | CONFIRMADO |
| Subprotocolo WebSocket | `mqtt` | CONFIRMADO (usado por el cliente integrado de EMQX) |
| MQTT Version | `MQTT 5` | CONFIRMADO (`proto_ver=5` en API y ficha de cliente) |
| TLS | `false` (WS plano; WSS `8084` existe pero sin validar) | CONFIRMADO |
| QoS recomendado | `0` (probado); `1` y `2` disponibles en el broker | CONFIRMADO para QoS 0 |
| Retain | `false` | CONFIRMADO |
| Keepalive | `60` | CONFIRMADO |
| Clean Start | `true` | CONFIRMADO |
| Session Expiry Interval | `0` | CONFIRMADO |
| Autenticación MQTT | **No requerida** (usuario y contraseña vacíos) | CONFIRMADO |
| ACL | Por defecto de EMQX, sin restricciones aplicadas | CONFIRMADO |

## B. CLIENTES MQTT RECOMENDADOS

| Rol | Client ID recomendado | Notas |
|---|---|---|
| Publicador web (`publicacion.php`) | `web_pub_daniel` (o `php_pub_<n>`) | **No reutilizar** `lab07_jeanfranco_pub` para evitar desconexiones por colisión de Client ID |
| Suscriptor web (`suscritor.php`) | `web_sub_daniel` (o `php_sub_<n>`) | **No reutilizar** `lab07_jeanfranco_sub` |

Cada pestaña/instancia PHP debe usar un Client ID único.

## C. TÓPICOS

### C.1 Tópico de prueba de laboratorio (aislado)

```
cistern/lab07/prueba
```

Útil para smoke tests de tus páginas sin tocar telemetría real.

### C.2 Estructura JSON de prueba (validada end-to-end)

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

### C.3 Tópicos reales CONFIRMADOS

- Telemetría: `cistern/ESP32_FISICO_UNT/telemetry`, `cistern/ESP32_V1_BLOQUE_A/telemetry`, `cistern/ESP32_V2_BLOQUE_B/telemetry` (y comodín de suscripción `cistern/+/telemetry`).
- Comandos: `cistern/<device_id>/commands` (los nodos se suscriben con QoS 1; el motor de reglas publica con QoS 1).
- `cistern/ESP32_V3_INCIDENTE/telemetry` existe en el simulador, pero el nodo está en `STANDBY` y no emite en este momento.

### C.4 Payload real CONFIRMADO (telemetría)

```json
{"device_id": "ESP32_FISICO_UNT", "location": "Cisterna Comedor UNT", "timestamp": 1792018262, "hardware_health": "OK", "metrics": {"turbidity_ntu": 1.9, "temperature_c": 21.81, "pin_voltage_v": 2.997}}
```

Tipos: `device_id` string; `location` string; `timestamp` integer (epoch s); `hardware_health` string; `metrics.turbidity_ntu` float (NTU); `metrics.temperature_c` float (°C); `metrics.pin_voltage_v` float (V).

**Advertencia:** no publiques payloads falsos en `cistern/+/telemetry` ni en tópicos `.../telemetry` por dispositivo: contaminarías el motor de reglas y la base de datos. Para pruebas usa `cistern/lab07/prueba`.

## D. EVENTOS QUE DANIEL DEBE MANEJAR

Implementar al menos los cuatro eventos del cliente MQTT (patrón mqtt.js / librería equivalente en PHP+JS):

| Evento | Acción sugerida |
|---|---|
| `connect` | Marcar estado "Conectado" en la UI; habilitar botones de publicar/suscribir; opcionalmente suscribir automáticamente |
| `reconnect` | Reintento automático con backoff; indicar "Reconectando…" en la UI (el broker no exige nada especial) |
| `error` | Mostrar el error (código de desconexión, payload inválido, tópico inválido); no publicar en tópicos reales si hay duda |
| `message` | Decodificar payload (JSON), mostrar tópico + payload + hora; validar JSON antes de renderizar |

En EMQX 5.8, el WebSocket del Dashboard usó exactamente estos parámetros y funcionó; una librería cliente estándar (mqtt.js con `protocol: 'mqtt'`) debe replicar el comportamiento.

## E. AUTENTICACIÓN (resumen)

- **MQTT/WS:** sin usuario ni contraseña. CONFIRMADO.
- **Dashboard EMQX:** requiere credenciales (no necesarias para `publicacion.php`/`suscritor.php`; solo para monitoreo). Credenciales del despliegue en `README_LAB07.md` (Anthony).
- **API REST EMQX (`/api/v5`):** requiere API key/secret o token vía `POST /api/v5/login`; el login del Dashboard no sirve como Basic Auth para la API. CONFIRMADO.

## F. PENDIENTE DE VALIDACIÓN

1. Payload observado de mensajes de comando en `cistern/<device_id>/commands`: no capturado en esta etapa (estructura prevista en el simulador: `target_device`, `action`, `set_sampling_rate`, `reason` — verificar durante integración).
2. WSS (`8084`) y SSL (`8883`): listeners activos pero sin pruebas ni certificados configurados.
3. Compatibilidad MQTT 3.1.1 desde PHP: el broker la soporta; no fue probada en esta etapa (la prueba se hizo con MQTT 5).
4. Persistencia de sesión (`Clean Start=false`, Session Expiry>0) para suscriptores web: no probada.
5. Comportamiento ante reconexión del suscriptor web y mensajes perdidos (QoS 0 no garantiza entrega): definir con el equipo durante integración.

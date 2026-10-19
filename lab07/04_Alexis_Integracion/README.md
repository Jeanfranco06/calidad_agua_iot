# LAB 07 â€” IntegraciÃ³n de clientes MQTT con la simulaciÃ³n

**Responsable:** Vigo HuayÃ¡n, Alexis Gean Gerardo
**Apartado asignado:** 4.1.5, integraciÃ³n con la simulaciÃ³n del proyecto
**Fecha de verificaciÃ³n:** 18 de octubre de 2026

## Objetivo y alcance

Comprobar que el suscriptor web definido por Daniel puede observar, mediante MQTT sobre WebSocket, la telemetrÃ­a generada por los nodos del proyecto. La verificaciÃ³n cruza tres puntos del flujo: recepciÃ³n MQTT, presencia de clientes y tÃ³picos en EMQX, y persistencia de lecturas en MySQL.

El publicador de pruebas usa exclusivamente `cistern/lab07/prueba`. La telemetrÃ­a de `cistern/+/telemetry` se observa en modo de solo lectura; no se inyectan mensajes ficticios en los tÃ³picos de los nodos.

## Componentes integrados

| Componente | FunciÃ³n comprobada |
|---|---|
| `virtual_simulator/simulator.py` | Publica JSON de cuatro identidades de nodo y ejecuta el motor de reglas. |
| EMQX 5.8.0 | Expone MQTT sobre WebSocket en `ws://localhost:8083/mqtt`. |
| `lab07/03_Daniel_Clientes_Web/suscriptor.html` | Permite suscribirse a `cistern/+/telemetry`. |
| `lab07/03_Daniel_Clientes_Web/publicador.html` | Publica Ãºnicamente en el tÃ³pico aislado de prueba. |
| MySQL `emqx_db` | Guarda las lecturas vÃ¡lidas en `telemetria`. |

## Procedimiento reproducible

Con Docker y el aprovisionamiento de LAB 08 activos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\lab07\04_Alexis_Integracion\run_verification.ps1
node lab07/03_Daniel_Clientes_Web/tests/test_suite_lab07.js
```

`run_verification.ps1` copia temporalmente al contenedor el verificador Python y solo las credenciales del suscriptor. El script conecta con MQTT 5 sobre WebSocket, genera un `client_id` Ãºnico, solicita `cistern/+/telemetry` con QoS 1, valida la estructura JSON y comprueba que el total de filas en MySQL aumenta. El archivo temporal con la contraseÃ±a se elimina al terminar. La salida JSON no contiene secretos.

Para la observaciÃ³n manual, abrir `http://localhost:8085/suscriptor.html`, introducir las credenciales locales del suscriptor, conectar y seleccionar `cistern/+/telemetry`. En `http://localhost:18083` revisar *Clients* y *Topics*.

## Matriz de resultados observados

| Control | Resultado del 18/10/2026 | Estado |
|---|---|---|
| ConexiÃ³n autenticada MQTT 5 sobre WebSocket | `CONNACK Success` con `client_id` `alexis_integracion_3aa13b5680` | Aprobado |
| SuscripciÃ³n a telemetrÃ­a | `SUBACK 1` en `cistern/+/telemetry` | Aprobado |
| JSON y correspondencia tÃ³pico/dispositivo | Siete muestras vÃ¡lidas, ninguna muestra invÃ¡lida | Aprobado |
| Nodos activos observados | `ESP32_FISICO_UNT`, `ESP32_V1_BLOQUE_A` y `ESP32_V2_BLOQUE_B` | Aprobado |
| Persistencia durante la ventana | `telemetria`: 12 287 â†’ 12 294 filas | Aprobado |
| Clientes y tÃ³picos en EMQX | Cinco clientes de servicio conectados y cinco filtros/tÃ³picos registrados | Aprobado |
| Suite WebSocket de Daniel | Ocho controles ejecutados por el script, todos aprobados | Aprobado |

El nodo `ESP32_V3_INCIDENTE` permanece conectado para recibir Ã³rdenes, pero estÃ¡ en `STANDBY` y no debe exigirse telemetrÃ­a continua de Ã©l.

## Evidencias

- [RecepciÃ³n WebSocket y comparaciÃ³n con MySQL](../../evidencias/alexis/L07_ALEXIS_01_telemetria_websocket_mysql.json): payload de muestra por nodo, QoS, conteos y comprobaciones.
- [Clientes y tÃ³picos de EMQX](../../evidencias/alexis/L07_ALEXIS_02_clientes_topicos_emqx.txt): salida directa de `emqx ctl`.
- [Suite del LAB 07](../../evidencias/alexis/L07_ALEXIS_03_pruebas_websocket.txt): conexiÃ³n, QoS 0/1, JSON invÃ¡lido, unsubscribe, reconexiÃ³n, telemetrÃ­a y desconexiÃ³n.

Los archivos anteriores son evidencia generada en el sistema local en ejecuciÃ³n. No son capturas de pantalla. Para la entrega que exige figuras, aÃºn se deben tomar capturas del suscriptor con telemetrÃ­a visible y de las vistas *Clients* y *Topics* de EMQX; pueden nombrarse `L07_P15_Alexis_telemetria.png`, `L07_P16_Alexis_clients.png` y `L07_P17_Alexis_topics.png`.

## LÃ­mites y observaciones

- `ESP32_FISICO_UNT` es un hilo simulado por software en este despliegue; su nombre no acredita un sensor fÃ­sico conectado.
- La turbidez del nodo de degradaciÃ³n `ESP32_V2_BLOQUE_B` crece sin lÃ­mite en la simulaciÃ³n actual. La muestra guardada durante esta ejecuciÃ³n llegÃ³ a 317,33 NTU tras horas de operaciÃ³n. Esta lectura demuestra el flujo tÃ©cnico, pero no debe presentarse como mediciÃ³n real de una cisterna ni como validaciÃ³n de potabilidad.
- La suite automÃ¡tica de ocho controles verifica el protocolo y la lÃ³gica de transporte. La inspecciÃ³n visual de las pÃ¡ginas en un navegador queda pendiente de capturas.

## Archivos de esta entrega

- `verify_telemetry.py`: comprobaciÃ³n integrada de MQTT WebSocket, contrato JSON y MySQL.
- `run_verification.ps1`: ejecuciÃ³n reproducible y manejo temporal de credenciales.
- `README.md`: mÃ©todo, resultados, lÃ­mites y evidencia para entregar a Mario.

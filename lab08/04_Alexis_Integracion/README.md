# LAB 08 â€” Clientes autenticados e integraciÃ³n de telemetrÃ­a

**Responsable:** Vigo HuayÃ¡n, Alexis Gean Gerardo
**Apartados asignados:** 5.1.6, adaptaciÃ³n de clientes autenticados; 5.1.7, integraciÃ³n y validaciÃ³n final
**Fecha de verificaciÃ³n:** 18 de octubre de 2026

## Objetivo y entrada recibida

La entrada de esta etapa son los clientes web de Daniel, las identidades y reglas ACL en MySQL, y el autenticador `password_based:mysql` configurado en EMQX. Los formularios de `publicador.html` y `suscriptor.html` ya aceptan usuario y contraseÃ±a y generan `client_id` Ãºnicos. La contribuciÃ³n de integraciÃ³n consiste en comprobarlos junto con los nodos y dejar evidencia de conexiones permitidas, rechazadas y telemetrÃ­a persistida.

Las identidades usadas son `web_pub_daniel` para publicar en `cistern/lab07/prueba`, `web_sub_daniel` para suscribirse a ese tÃ³pico y a `cistern/+/telemetry`, `esp32_nodes` para los nodos y `backend_rules` para el motor de reglas. Las contraseÃ±as permanecen en el `.env` local excluido de Git.

## Procedimiento reproducible

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -StatusOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\lab08\03_Daniel_Auth_MySQL\tests\run_tests_docker.ps1 -Suite Acceptance
powershell -NoProfile -ExecutionPolicy Bypass -File .\lab08\03_Daniel_Auth_MySQL\tests\run_tests_docker.ps1 -Suite Matrix
powershell -NoProfile -ExecutionPolicy Bypass -File .\lab07\04_Alexis_Integracion\run_verification.ps1
```

En la prueba manual, conectar el publicador y suscriptor desde pestaÃ±as separadas con sus respectivas credenciales, enviar un JSON de prueba en `cistern/lab07/prueba`, repetir una conexiÃ³n con contraseÃ±a errÃ³nea y luego observar `cistern/+/telemetry` desde el suscriptor. Las operaciones denegadas se ensayan solo en tÃ³picos de prueba; no se publican datos falsos en la telemetrÃ­a real del sistema.

## Matriz de resultados observados

| Control | Resultado del 18/10/2026 | Estado |
|---|---|---|
| AutenticaciÃ³n vÃ¡lida | Publicador y suscriptor conectaron; envÃ­o QoS 1 y recepciÃ³n byte a byte idÃ©ntica | Aprobado |
| ContraseÃ±a errÃ³nea | ConexiÃ³n rechazada con cÃ³digo 4 en la prueba MQTT 3.1.1 | Aprobado |
| OperaciÃ³n no permitida | SuscripciÃ³n del publicador rechazada con `SUBACK 128`; el suscriptor no pudo publicar | Aprobado |
| RestricciÃ³n de tÃ³picos | Publicador no pudo escribir fuera de `cistern/lab07/prueba` ni suplantar un nodo | Aprobado |
| Sesiones de servicio | Cuatro nodos con `username=esp32_nodes` y motor con `username=backend_rules` conectados | Aprobado |
| TelemetrÃ­a autenticada | MySQL aumentÃ³ de 12 474 a 12 478 filas en tres segundos | Aprobado |
| PolÃ­tica EMQX | `password_based:mysql` activo, `no_match=deny`, fuente MySQL habilitada y archivo deshabilitado | Aprobado |
| Matriz protocolar | Nueve casos Aâ€“I aprobados | Aprobado |

La consulta posterior registrÃ³ 12 670 filas en `telemetria`, con registros recientes para los tres nodos emisores. `ESP32_V3_INCIDENTE` figura en `STANDBY` y existen Ã³rdenes `STANDBY` e `INTENSIVE_SAMPLING` en la bitÃ¡cora.

## Incidencia corregida durante la integraciÃ³n

El script `lab08/03_Daniel_Auth_MySQL/configure_emqx_auth.ps1` intentaba actualizar la fuente ACL de archivo enviando Ãºnicamente `enable=false`. EMQX 5.8 devolvÃ­a HTTP 500 por falta del campo `type` y dejaba activa la regla predeterminada `{allow, all}`. El script ahora lee la fuente actual y envÃ­a `type`, `rules` y `enable=false`; falla explÃ­citamente si no puede desactivarla. Se repitiÃ³ la configuraciÃ³n y `-StatusOnly` confirmÃ³ `file=False`.

## Evidencias

- [Prueba de aceptaciÃ³n](../../evidencias/alexis/L08_ALEXIS_01_aceptacion.txt): cuatro controles, incluidas credenciales vÃ¡lidas/errÃ³neas, ACL y crecimiento de MySQL.
- [Matriz de permisos](../../evidencias/alexis/L08_ALEXIS_02_permisos.txt): nueve casos Aâ€“I.
- [Estado de autenticaciÃ³n y ACL](../../evidencias/alexis/L08_ALEXIS_03_estado_auth_emqx.txt): autenticador y fuentes activas.
- [Persistencia y estado de nodos](../../evidencias/alexis/L08_ALEXIS_04_persistencia_mysql.txt): filas por nodo y Ã³rdenes.
- [IntegraciÃ³n WebSocket con telemetrÃ­a](../../evidencias/alexis/L07_ALEXIS_01_telemetria_websocket_mysql.json): cliente web autenticado y muestras recibidas.

Estas evidencias son salidas reales de ejecuciÃ³n. Para completar las figuras solicitadas por el plan del equipo aÃºn se requieren capturas visuales de cliente vÃ¡lido, rechazo de contraseÃ±a, *Clients* de EMQX con los usuarios, telemetrÃ­a del suscriptor y tabla `telemetria` en phpMyAdmin. Los nombres sugeridos son `L08_P10_Alexis_cliente_valido.png` a `L08_P14_Alexis_persistencia.png`.

## LÃ­mites

- MQTT TCP `1883` y WebSocket `8083` operan sin TLS en este laboratorio; la autenticaciÃ³n controla acceso, pero no cifra el transporte.
- El cliente llamado `ESP32_FISICO_UNT` tambiÃ©n estÃ¡ simulado en el contenedor. No se afirma una prueba con hardware fÃ­sico.
- La prueba negativa de contraseÃ±a se ejecutÃ³ con Paho MQTT 3.1.1; la conexiÃ³n y recepciÃ³n WebSocket se verificaron con MQTT 5. Las pÃ¡ginas web no se capturaron visualmente en esta sesiÃ³n.

## Entrega a Mario

Mario puede usar la matriz y los archivos de evidencia para QA y consolidaciÃ³n. Antes de insertar figuras en el informe final debe tomar las capturas visuales seÃ±aladas y verificar que no muestren contraseÃ±as.

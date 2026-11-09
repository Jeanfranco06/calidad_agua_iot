# Laboratorio 11 · MQTT Mobile

Panel web responsive para Android, servido localmente por Nginx y conectado a EMQX mediante MQTT sobre WebSockets (`mqtt.js` local). Se eligió esta opción porque el broker ya ofrece un listener WebSocket y el teléfono puede abrir el panel desde la misma red Wi-Fi sin instalar un SDK nativo ni configurar una compilación Android. La app no publica: solo se suscribe a `cistern/+/telemetry`.

## Datos confirmados en el código del proyecto

- El simulador publica en `cistern/<device_id>/telemetry`, QoS 1, JSON con `device_id`, `location`, `timestamp` Unix y `metrics`.
- `metrics` incluye `temperature_c`, `turbidity_ntu`, `turbidity_calibrated`, voltaje y estado del sensor. Los nodos simulados marcan `turbidity_calibrated: true`; el firmware físico transmite `turbidity_ntu: null`, `turbidity_estimated_ntu` y `turbidity_calibrated: false`.
- El firmware y el simulador escuchan `cistern/<device_id>/commands`; la app no solicita ese permiso.
- El Compose del proyecto declara EMQX 5.8.0, TCP publicado como `1884:1883` y WebSocket como `8084:8083`. El listener WebSocket usa `/mqtt`; el puerto host para el teléfono es `8084`.
- EMQX inicialmente no tenía autenticación activa, usaba solo ACL de archivo y permitía acciones sin regla (`no_match = allow`). Se activó `password_based:mysql`, `authz:mysql`, `no_match = deny` y se desactivó la fuente de archivo para evitar bypass. El estado quedó confirmado por la API de EMQX.
- La cuenta `mobile_monitor` se creó como no-superusuario con una sola regla ACL: `subscribe` en `cistern/+/telemetry`. La prueba MQTT confirmó que no puede suscribirse a filtros ajenos ni publicar mensajes fuera de permiso.
- La configuración/documentación actual declara transporte `ws://` sin TLS. No se deben enviar credenciales reutilizadas ni usar esta conexión fuera de una red local de confianza.

La hora del payload Unix se presenta en `America/Lima` (PET). Si un dispositivo no incluye `timestamp`, el panel usa la hora de recepción y lo etiqueta como tal. La turbidez muestra «calibrada» solo cuando el flag es `true`; en otro caso muestra el valor estimado si viene en el payload.

## Aprovisionar cuenta móvil

La cuenta `mobile_monitor` tiene únicamente permiso `subscribe` para `cistern/+/telemetry`. Con `no_match = deny` activo, publicar o suscribirse fuera de esa ACL es rechazado. El aprovisionador de la cuenta no cambia las reglas de las demás identidades; la configuración global se aplica con el script existente de EMQX.

En una instalación desde cero, desde PowerShell en la raíz del repositorio, con Docker Desktop levantado:

```powershell
docker compose up -d
.\lab08\03_Daniel_Auth_MySQL\provision_auth_db.ps1
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -EmqxApiUrl http://localhost:18084/api/v5
docker compose up -d --force-recreate virtual_nodes mobile_app
```

El aprovisionador genera las contraseñas localmente y las guarda en `.env` (ignorado por Git), escribe los hashes salados en `mqtt_user` y sincroniza ACLs. El script móvil aislado `mobile/provision_mobile_account.ps1` sirve para volver a sincronizar solo esa cuenta cuando EMQX ya usa MySQL. No se deben rotar credenciales MQTT sin recrear después los clientes que las usan.

Para ejecutar la matriz de permisos desde Windows, instala `paho-mqtt` en un entorno local y ejecuta:

```powershell
python -m pip install paho-mqtt
python .\mobile\verify_permissions.py
```

La prueba comprueba SUBACK permitido para telemetría, SUBACK denegado para un filtro ajeno, ausencia de entrega de una publicación no autorizada y recepción de telemetría del simulador. El mensaje de prueba no contiene credenciales ni se publica en una telemetría existente.

## Levantar y probar

```powershell
docker compose up -d
docker compose ps
```

1. Conecta el teléfono Android a la misma Wi-Fi que el PC que ejecuta Docker.
2. En el PC, ejecuta `ipconfig` y toma la IPv4 del adaptador Wi-Fi (no uses `localhost`, `127.0.0.1` ni la dirección Tailscale).
3. En el teléfono abre `http://<IP-DEL-PC>:8086/`. En Broker WebSocket usa `ws://<IP-DEL-PC>:8084/mqtt`.
4. Usuario: `mobile_monitor`. Consulta el valor de `MQTT_PASS_MOBILE` en el `.env` local e introdúcelo en el campo de contraseña. No lo compartas ni lo captures en una imagen.
5. Pulsa **Conectar**. Debes ver el indicador conectado y, al recibir publicaciones, tarjetas para cada dispositivo con temperatura, turbidez y hora.
6. Para comparar, ejecuta `python .\mobile\verify_permissions.py` en el PC mientras el simulador está activo.

Si Windows Firewall pregunta por permisos de red, permite el acceso privado a los puertos TCP `8086` (panel) y `8084` (WebSocket MQTT). El Compose actual no publica TLS para el listener usado por el móvil; `ws://` no cifra la contraseña ni la telemetría. Mantén la prueba en una Wi-Fi privada. Para cifrado real, EMQX debe ofrecer WSS y certificados confiables y el campo Broker WebSocket debe usar `wss://`.

Para detener el sistema: `docker compose down`. Para volver a levantarlo: `docker compose up -d`.

## Estado de verificación de esta entrega

- Código, payload y tópicos revisados en el firmware y el simulador.
- Compose ampliado con un servicio `mobile_app` en el puerto host `8086`, sin alterar los mapeos locales existentes.
- EMQX API confirmó autenticación MySQL activa, fuente ACL MySQL activa, archivo ACL desactivado y `no_match = deny`.
- La prueba desde el contenedor del simulador confirmó por MQTT/WebSocket (`/mqtt`) suscripción permitida a telemetría, denegación de suscripción a un filtro fuera de permiso, publicación fuera de ACL no entregada y recepción de publicaciones reales de los nodos virtuales.
- `docker compose ps` confirmó activos EMQX, MySQL, simulador y `water_mobile_app`; HTTP local al panel devolvió 200.
- `node --check`, `py_compile`, análisis sintáctico PowerShell y `docker compose config --quiet` finalizaron correctamente.
- Desde la red disponible del PC, `ipconfig` mostró Wi-Fi `192.168.0.102`; confirma que esa IPv4 siga siendo la misma al probar el teléfono.
- La revisión visual del navegador fue en un viewport móvil. No se conectó un teléfono físico desde este entorno.

Si el ESP32 físico vuelve a conectarse después de activar Authn, actualiza su `firmware_esp32/config.h` local con `MQTT_USER=esp32_nodes` y la contraseña `MQTT_PASS_NODES` del `.env`, y vuelve a cargar el firmware. El archivo con credenciales está ignorado por Git.

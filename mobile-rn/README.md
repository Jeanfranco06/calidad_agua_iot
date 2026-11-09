# Agua Clara Mobile (React Native)

Aplicación Android nativa de React Native que consume telemetría en vivo de EMQX por MQTT sobre WebSocket. Se usa React Native porque el laboratorio solicita APK y una app instalable; MQTT.js funciona sobre el WebSocket ya publicado por el proyecto. La clave se ingresa en pantalla y se mantiene solo durante la sesión.

## Broker y datos

- WebSocket actual: `ws://<IP-del-PC>:8084/mqtt` (sin TLS; credenciales y mensajes no están cifrados en la red).
- Usuario: `mobile_monitor`.
- Suscripción: `cistern/+/telemetry` (solo lectura, según ACL actual).
- Payload JSON del proyecto: `device_id`, `location`, `timestamp` Unix y objeto `metrics`. La pantalla lee `temperature_c` y distingue `turbidity_ntu` calibrada frente a `turbidity_estimated_ntu` estimada con `turbidity_calibrated`.
- La hora se presenta en hora de Lima (PET); si no viene `timestamp`, muestra la recepción y la etiqueta como tal.

## Requisitos para compilar

Node 22.11 o superior, JDK, Android SDK Platform 37, Build Tools 37.0.0, NDK 27.1.12297006 y licencias del SDK aceptadas por quien instala esas herramientas. No se guardan credenciales del broker en el proyecto.

Desde PowerShell, raíz del repositorio:

```powershell
cd .\mobile-rn
npm install
npx react-native start
```

En otra terminal:

```powershell
cd .\mobile-rn\android
.\gradlew.bat assembleDebug
```

APK instalable e independiente de Metro: `mobile-rn/android/app/build/outputs/apk/release/app-release.apk`. Se firma con la llave debug generada por Android Gradle para la entrega del laboratorio; no la uses para publicación en tiendas. Para instalar con un Android conectado y depuración USB autorizada: `adb install -r .\app\build\outputs\apk\release\app-release.apk` desde `mobile-rn/android`.

## Probar en el celular

1. Arranca EMQX y el simulador con `docker compose up -d` desde la raíz.
2. Conecta el teléfono y el PC a la misma Wi-Fi. Averigua la IPv4 Wi-Fi del PC con `ipconfig`.
3. Instala y abre la APK. El valor inicial refleja la IP vista durante esta entrega (`172.16.40.157`); si cambia, coloca `ws://<IP-del-PC>:8084/mqtt`. Usa el usuario `mobile_monitor` y la contraseña móvil provisionada localmente. No compartas la contraseña ni la escribas en este archivo.
4. Pulsa **Conectar al broker**. Debe indicar conectado; con una publicación del simulador aparecerá una estación con temperatura, turbidez y hora.

El listener existente no anuncia TLS/WSS. `ws://` no cifra la sesión; usa solo una red privada de confianza. Para cifrar, configura WSS/certificado confiable en EMQX y conecta a `wss://` antes de usarla fuera de la LAN.

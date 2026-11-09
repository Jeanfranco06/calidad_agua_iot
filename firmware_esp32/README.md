# GUÍA DE COMPILACIÓN Y CARGA: FIRMWARE NODO FÍSICO ESP32

Este módulo contiene el firmware de producción en C++ para integrar el microcontrolador **ESP32 DevKit V1** físico al ecosistema IoT universitario (EMQX, MySQL, Docker).

---

## 1. Requisitos de Hardware

- **Microcontrolador:** ESP32 DevKit V1 (30 pines o 38 pines).
- **Sensor de Turbidez:** TS-300B (Alimentación 5V, salida AO).
  - Pin analógico AO conectado a **GPIO 34** a través de divisor de tensión.
  - Divisor: $R_1 = 20\text{ k}\Omega$ (dos resistencias de 10k en serie) entre AO y GPIO 34; $R_2 = 20\text{ k}\Omega$ entre GPIO 34 y GND.
- **Sensor de Temperatura:** DS18B20 sumergible.
  - VCC: 3.3V, GND: GND.
  - Pin de datos conectado a **GPIO 4**.
  - Resistencia *pull-up* de $4.7\text{ k}\Omega$ entre datos (GPIO 4) y 3.3V.
- **Cable Micro-USB:** Con soporte de datos, conectado al puerto **COM3**.

---

## 2. Configuración en Arduino IDE 2.x

### Paso 1: Instalar soporte para placas ESP32
1. Abrir Arduino IDE.
2. Ir a **File -> Preferences** (Archivo -> Preferencias).
3. En el campo *Additional Boards Manager URLs*, pegar:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Ir a **Tools -> Board -> Boards Manager** (Herramientas -> Placa -> Gestor de Placas), buscar `esp32` por Espressif Systems e instalar la versión estable (2.0.x o 3.0.x).

### Paso 2: Instalar Librerías Requeridas
En **Tools -> Manage Libraries** (Gestor de Librerías), instalar:
1. `PubSubClient` (por Nick O'Leary) - Versión 2.8 o superior.
2. `OneWire` (por Paul Stoffregen) - Versión 2.3.7 o superior.
3. `DallasTemperature` (por Miles Burton) - Versión 3.9.0 o superior.

### Paso 3: Configurar Credenciales Locales
1. En esta carpeta (`firmware_esp32/`), abrir `config.h`.
2. Modificar:
   - `WIFI_SSID`: Nombre de tu red Wi-Fi (debe ser 2.4 GHz).
   - `WIFI_PASSWORD`: Contraseña de tu Wi-Fi.
   - `MQTT_BROKER_HOST`: La **dirección IPv4 LAN** de tu computadora con Docker (obtenida con `ipconfig`). **NO poner localhost ni 127.0.0.1**.
   - `MQTT_BROKER_PORT`: `1883`.

### Paso 4: Selección de Placa y Puerto
- **Placa:** `DOIT ESP32 DEVKIT V1` o `ESP32 Dev Module`.
- **Upload Speed:** `115200` o `921600`.
- **CPU Frequency:** `240MHz (WiFi/BT)`.
- **Flash Frequency:** `80MHz`.
- **Port:** Seleccionar `COM3`.

### Paso 5: Compilar y Cargar
1. Hacer clic en **Verify** (✔) para comprobar que no existan errores de compilación.
2. Hacer clic en **Upload** (➔).
   *(Nota: si el monitor muestra `Connecting........_____.....`, mantener presionado el botón **BOOT** del ESP32 durante 2 segundos hasta que comience el flasheo).*
3. Abrir el **Serial Monitor** (Ctrl + Shift + M) a **115200 baudios**.

---

## 3. Logs de Diagnóstico Esperados

Al iniciar, el Monitor Serie debe mostrar una traza similar a la siguiente:

```text
========================================================
   SISTEMA IOT DE CALIDAD DE AGUA - NODO FÍSICO ESP32    
   Universidad Nacional de Trujillo                      
========================================================
[HARDWARE] Sensores inicializados. Dispositivos DS18B20 encontrados: 1
[INICIO] Conectando a Wi-Fi: MiRed_2.4G ...
[NTP] Cliente SNTP configurado e iniciado.
[WIFI] Conectado exitosamente. IP asignada: 192.168.1.45 (RSSI: -58 dBm)
[MQTT] Intentando conexion al broker 192.168.1.100:1883 (Client ID: ESP32_FISICO_UNT)...
[MQTT] Conectado exitosamente al broker EMQX.
[MQTT] Suscrito a ordenes en: cistern/ESP32_FISICO_UNT/commands
[TELEMETRÍA TX] -> Topico: cistern/ESP32_FISICO_UNT/telemetry
  ADC: 2845 | V_pin: 2.290 V | V_sensor: 4.580 V | Temp: 21.88 °C | Est. NTU: 1.92 (No calibrado) | Salud: OK
```

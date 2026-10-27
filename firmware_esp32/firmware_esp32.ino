// =============================================================================
// PROYECTO UNIVERSITARIO: MONITOREO Y PREDICCIÓN DE TURBIDEZ EN CISTERNAS UNT
// FIRMWARE NODO FÍSICO REAL ESP32 DEVKIT V1
// Arquitectura: FreeRTOS / Arduino C++
// Sensores: Turbidez TS-300B (GPIO 34) + Temperatura DS18B20 (GPIO 4)
// Comunicación: Wi-Fi STA -> MQTT (Broker EMQX) -> Backend / MySQL
// =============================================================================

#include <WiFi.h>
#include <PubSubClient.h>
#include "config.h"
#include "sensors.h"
#include "ntp_helper.h"

// -------------------------------------------------------------
// OBJETOS Y VARIABLES GLOBALES
// -------------------------------------------------------------
static WiFiClient espWifiClient;
static PubSubClient mqttClient(espWifiClient);

static unsigned long lastTelemetryMillis = 0;
static unsigned long lastWifiRetryMillis = 0;
static unsigned long lastMqttRetryMillis = 0;

static int currentIntervalSec = DEFAULT_INTERVAL_SEC;
static bool nodeInStandby = false;

// -------------------------------------------------------------
// MANEJO DE COMANDOS ENTRANTES MQTT (cistern/<dev_id>/commands)
// -------------------------------------------------------------
void onMqttCommandReceived(char* topic, byte* payload, unsigned int length) {
    char message[256];
    if (length >= sizeof(message)) {
        length = sizeof(message) - 1;
    }
    memcpy(message, payload, length);
    message[length] = '\0';

    Serial.printf("[MQTT RX] Comando recibido en topico [%s]: %s\n", topic, message);

    // Detección de comando "set_sampling_rate"
    char* ratePtr = strstr(message, "\"set_sampling_rate\":");
    if (ratePtr) {
        int newRate = atoi(ratePtr + 20);
        if (newRate >= MIN_INTERVAL_SEC && newRate <= MAX_INTERVAL_SEC) {
            currentIntervalSec = newRate;
            Serial.printf("[CONTROL] Frecuencia de muestreo actualizada dinamicamente a %d s\n", currentIntervalSec);
        }
    }

    // Detección de órdenes de acción ("STANDBY", "RESUME", "INTENSIVE_SAMPLING")
    if (strstr(message, "\"STANDBY\"")) {
        nodeInStandby = true;
        Serial.println("[CONTROL] Nodo puesto en modo STANDBY por directiva del servidor.");
    } else if (strstr(message, "\"RESUME\"")) {
        nodeInStandby = false;
        Serial.println("[CONTROL] Nodo REACTIVADO desde STANDBY.");
    }
}

// -------------------------------------------------------------
// GESTIÓN NO BLOQUEANTE DE CONEXIÓN WI-FI
// -------------------------------------------------------------
void checkWifiConnection() {
    if (WiFi.status() == WL_CONNECTED) {
        return;
    }

    unsigned long now = millis();
    if (now - lastWifiRetryMillis >= WIFI_RECONNECT_MS) {
        lastWifiRetryMillis = now;
        Serial.printf("[WIFI] Conectando a red: %s ...\n", WIFI_SSID);
        WiFi.disconnect();
        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
}

// -------------------------------------------------------------
// GESTIÓN NO BLOQUEANTE DE CONEXIÓN MQTT
// -------------------------------------------------------------
void checkMqttConnection() {
    if (WiFi.status() != WL_CONNECTED) {
        return; // Requiere Wi-Fi activo
    }

    if (mqttClient.connected()) {
        return;
    }

    unsigned long now = millis();
    if (now - lastMqttRetryMillis >= 5000) {
        lastMqttRetryMillis = now;
        Serial.printf("[MQTT] Intentando conexion al broker %s:%d (Client ID: %s)...\n",
                      MQTT_BROKER_HOST, MQTT_BROKER_PORT, MQTT_CLIENT_ID);

        bool connected = false;
        if (strlen(MQTT_USER) > 0) {
            connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASSWORD);
        } else {
            connected = mqttClient.connect(MQTT_CLIENT_ID);
        }

        if (connected) {
            Serial.println("[MQTT] Conectado exitosamente al broker EMQX.");
            mqttClient.subscribe(TOPIC_COMMANDS, 1);
            Serial.printf("[MQTT] Suscrito a ordenes en: %s\n", TOPIC_COMMANDS);
        } else {
            Serial.printf("[MQTT] Fallo de conexion. Codigo de error rc=%d\n", mqttClient.state());
            Serial.println("  (rc=-2: Broker inalcanzable; rc=4/5: Credenciales no autorizadas)");
        }
    }
}

// -------------------------------------------------------------
// ENVÍO DE TELEMETRÍA CIBERFÍSICA
// -------------------------------------------------------------
void publishTelemetry() {
    if (!mqttClient.connected()) {
        return;
    }

    SensorData sensors = readSensors();
    unsigned long epoch = getUnixEpoch();

    // Construcción del payload JSON compatible con el contrato backend
    // metrics incluye campos nominales (turbidity_ntu, temperature_c, pin_voltage_v)
    // y metadatos de telemetría física (adc_raw, turbidity_calibrated, etc.)
    char jsonBuffer[512];
    snprintf(jsonBuffer, sizeof(jsonBuffer),
        "{"
          "\"device_id\":\"%s\","
          "\"location\":\"%s\","
          "\"timestamp\":%lu,"
          "\"hardware_health\":\"%s\","
          "\"origin\":\"%s\","
          "\"metrics\":{"
            "\"turbidity_ntu\":%.2f,"
            "\"turbidity_estimated_ntu\":%.2f,"
            "\"turbidity_calibrated\":%s,"
            "\"temperature_c\":%.2f,"
            "\"pin_voltage_v\":%.3f,"
            "\"sensor_voltage_v\":%.3f,"
            "\"adc_raw\":%d"
          "}"
        "}",
        DEVICE_ID,
        DEVICE_LOCATION,
        epoch,
        sensors.hardware_health,
        NODE_ORIGIN,
        sensors.turbidity_estimated_ntu,
        sensors.turbidity_estimated_ntu,
        sensors.turbidity_calibrated ? "true" : "false",
        sensors.temperature_c,
        sensors.pin_voltage_v,
        sensors.sensor_voltage_v,
        sensors.raw_adc
    );

    bool ok = mqttClient.publish(TOPIC_TELEMETRY, jsonBuffer, false);

    if (ok) {
        Serial.printf("[TELEMETRÍA TX] -> Topico: %s\n", TOPIC_TELEMETRY);
        Serial.printf("  ADC: %d | V_pin: %.3f V | V_sensor: %.3f V | Temp: %.2f °C | Est. NTU: %.2f (No calibrado) | Salud: %s\n",
                      sensors.raw_adc, sensors.pin_voltage_v, sensors.sensor_voltage_v,
                      sensors.temperature_c, sensors.turbidity_estimated_ntu, sensors.hardware_health);
    } else {
        Serial.printf("[TELEMETRÍA ERROR] Fallo al publicar payload (tamano: %d bytes)\n", strlen(jsonBuffer));
    }
}

// -------------------------------------------------------------
// SETUP
// -------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    delay(1500);

    Serial.println("\n========================================================");
    Serial.println("   SISTEMA IOT DE CALIDAD DE AGUA - NODO FÍSICO ESP32    ");
    Serial.println("   Universidad Nacional de Trujillo                      ");
    Serial.println("========================================================");

    // Inicialización de hardware y sensores
    initSensors();

    // Inicialización de conexión Wi-Fi (no bloqueante)
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("[INICIO] Conectando a Wi-Fi: %s ...\n", WIFI_SSID);

    // Configuración del cliente MQTT
    mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
    mqttClient.setCallback(onMqttCommandReceived);
    mqttClient.setBufferSize(512); // Ampliar buffer para soportar payload JSON completo

    // Iniciar servicio NTP para marcas temporales epoch
    initNtp();
}

// -------------------------------------------------------------
// LOOP PRINCIPAL
// -------------------------------------------------------------
void loop() {
    // 1. Mantener conectividad de red y mensajería
    checkWifiConnection();
    checkMqttConnection();
    mqttClient.loop();

    // 2. Transmisión periódica según frecuencia configurada
    unsigned long now = millis();
    if (now - lastTelemetryMillis >= (unsigned long)(currentIntervalSec * 1000)) {
        lastTelemetryMillis = now;

        if (nodeInStandby) {
            Serial.println("[ESTADO] Nodo en reposo (STANDBY). Omitiendo transmision.");
        } else {
            publishTelemetry();
        }
    }
}

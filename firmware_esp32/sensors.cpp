#include "sensors.h"
#include "config.h"
#include <OneWire.h>
#include <DallasTemperature.h>

static OneWire oneWire(PIN_DS18B20_DATA);
static DallasTemperature ds18b20(&oneWire);

void initSensors() {
    // Configurar resolución de 12 bits en ADC (0 - 4095)
    analogReadResolution(12);
    
    // Atenuación de 11dB en GPIO 34 para permitir lecturas hasta ~3.1V - 3.3V
    #if defined(ESP32)
        analogSetPinAttenuation(PIN_TURBIDEZ_ADC, ADC_11db);
    #endif

    // Inicialización del bus 1-Wire y sensor de temperatura
    ds18b20.begin();
    ds18b20.setWaitForConversion(true);

    int count = ds18b20.getDeviceCount();
    Serial.printf("[HARDWARE] Sensores inicializados. Dispositivos DS18B20 encontrados: %d\n", count);
}

SensorData readSensors() {
    SensorData data;
    memset(&data, 0, sizeof(SensorData));

    // -------------------------------------------------------------
    // 1. ADQUISICIÓN SENSOR DE TEMPERATURA DS18B20
    // -------------------------------------------------------------
    ds18b20.requestTemperatures();
    float raw_temp = ds18b20.getTempCByIndex(0);

    // Validación de integridad de la sonda DS18B20
    // -127.0 °C: cable desconectado, falla de pull-up o bus corrupto
    // +85.0 °C: valor de encendido antes de conversión térmica válida
    if (raw_temp == DEVICE_DISCONNECTED_C || raw_temp == 85.0f || raw_temp < 0.0f || raw_temp > 60.0f) {
        data.temp_valid = false;
        data.temperature_c = raw_temp;
    } else {
        data.temp_valid = true;
        data.temperature_c = raw_temp;
    }

    // -------------------------------------------------------------
    // 2. ADQUISICIÓN SENSOR DE TURBIDEZ TS-300B (GPIO 34)
    // -------------------------------------------------------------
    // Sobremuestreo (oversampling de 20 lecturas con descarte de ruido térmico)
    const int OVERSAMPLE_COUNT = 20;
    long adc_accum = 0;
    long mv_accum = 0;

    for (int i = 0; i < OVERSAMPLE_COUNT; i++) {
        adc_accum += analogRead(PIN_TURBIDEZ_ADC);
        #if defined(ESP32)
            mv_accum += analogReadMilliVolts(PIN_TURBIDEZ_ADC);
        #endif
        delay(5); // Pequeño espaciado para desacoplar ruido de conversión
    }

    data.raw_adc = adc_accum / OVERSAMPLE_COUNT;

    #if defined(ESP32)
        float avg_mv = (float)mv_accum / (float)OVERSAMPLE_COUNT;
        data.pin_voltage_v = avg_mv / 1000.0f;
    #else
        data.pin_voltage_v = (data.raw_adc * 3.3f) / 4095.0f;
    #endif

    // Reconstrucción del voltaje real a la salida del sensor TS-300B mediante el divisor de tensión:
    // V_pin = V_sensor * (R2 / (R1 + R2))
    // V_sensor = V_pin * ((R1 + R2) / R2)
    float ratio_inverso = (DIVISOR_R1_OHMS + DIVISOR_R2_OHMS) / DIVISOR_R2_OHMS;
    data.sensor_voltage_v = data.pin_voltage_v * ratio_inverso;

    // -------------------------------------------------------------
    // 3. MODELO CIENTÍFICO Y ESTIMACIÓN DE TURBIDEZ
    // -------------------------------------------------------------
    // REQUISITO CIENTÍFICO: No existe calibración con estándares formazina todavía.
    // La bandera turbidity_calibrated se mantiene en FALSE.
    data.turbidity_calibrated = false;

    // Estimación teórica basada en la función de transferencia del fabricante adaptada
    // V_pin nominal en agua pura ~ 3.25V; decrece al aumentar partículas suspendidas.
    float turb_calc = (3.25f - data.pin_voltage_v) / 0.13f;
    if (turb_calc < 0.1f) turb_calc = 0.1f;
    if (turb_calc > 50.0f) turb_calc = 50.0f;
    data.turbidity_estimated_ntu = turb_calc;

    // -------------------------------------------------------------
    // 4. DIAGNÓSTICO DE SALUD DE HARDWARE
    // -------------------------------------------------------------
    if (!data.temp_valid && (raw_temp == DEVICE_DISCONNECTED_C || raw_temp < -100.0f)) {
        data.hardware_health = "PROBE_DISCONNECTED";
    } else if (data.pin_voltage_v < 0.05f) {
        data.hardware_health = "SHORT_CIRCUIT";
    } else if (data.pin_voltage_v > 3.28f) {
        data.hardware_health = "ADC_SATURATED";
    } else if (!data.temp_valid) {
        data.hardware_health = "TEMP_OUT_OF_RANGE";
    } else {
        data.hardware_health = "OK";
    }

    return data;
}

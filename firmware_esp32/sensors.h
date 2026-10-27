#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

struct SensorData {
    int raw_adc;                  // Lectura bruta ADC 12 bits (0 - 4095)
    float pin_voltage_v;          // Voltaje en el pin GPIO 34 (0.0 - 3.3 V)
    float sensor_voltage_v;       // Voltaje reconstruido del sensor TS-300B (0.0 - 5.0 V)
    float turbidity_estimated_ntu;// Estimación teórica preliminar (NO certificada)
    bool turbidity_calibrated;    // false (evidencia científica: sin calibración con patrones)
    float temperature_c;          // Temperatura en grados Celsius (°C)
    bool temp_valid;              // true si la lectura DS18B20 es válida
    const char* hardware_health;  // "OK", "PROBE_DISCONNECTED", "SHORT_CIRCUIT", "ADC_SATURATED"
};

// Inicialización de hardware de sensores
void initSensors();

// Lectura de sensores con sobremuestreo y validación de fallas
SensorData readSensors();

#endif // SENSORS_H

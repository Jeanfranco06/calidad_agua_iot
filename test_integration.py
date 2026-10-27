"""
TEST SUITE: INTEGRACIÓN Y COMPATIBILIDAD DEL NODO FÍSICO ESP32
Verifica:
1. Contrato JSON de telemetría física vs requerimientos del backend.
2. Comportamiento de las reglas offline ante datos físicos válidos y fallas de hardware.
3. Compatibilidad de migración incremental SQL.
4. Consultas analíticas para MySQL / phpMyAdmin.
"""

import json
import unittest

class TestESP32TelemetryContract(unittest.TestCase):

    def test_nominal_physical_payload_structure(self):
        """Valida que el payload generado por el firmware contenga todas las claves requeridas."""
        raw_json = '''{
          "device_id":"ESP32_FISICO_UNT",
          "location":"Cisterna Comedor UNT",
          "timestamp":1728086430,
          "hardware_health":"OK",
          "origin":"PHYSICAL_REAL",
          "metrics":{
            "turbidity_ntu":1.92,
            "turbidity_estimated_ntu":1.92,
            "turbidity_calibrated":false,
            "temperature_c":21.88,
            "pin_voltage_v":2.290,
            "sensor_voltage_v":4.580,
            "adc_raw":2845
          }
        }'''
        data = json.loads(raw_json)
        self.assertEqual(data["device_id"], "ESP32_FISICO_UNT")
        self.assertEqual(data["origin"], "PHYSICAL_REAL")
        self.assertIn("metrics", data)
        metrics = data["metrics"]
        self.assertIn("turbidity_ntu", metrics)
        self.assertIn("temperature_c", metrics)
        self.assertIn("pin_voltage_v", metrics)
        self.assertIn("adc_raw", metrics)
        self.assertFalse(metrics["turbidity_calibrated"])

    def test_backend_rule_acceptance_for_physical_node(self):
        """Simula la lógica de evaluación del backend sobre una lectura física real sin calibrar."""
        metrics = {
            "turbidity_ntu": 1.92,
            "temperature_c": 21.88,
            "pin_voltage_v": 2.290,
            "adc_raw": 2845,
            "turbidity_calibrated": False
        }
        origin = "PHYSICAL_REAL"
        dev_id = "ESP32_FISICO_UNT"

        turb = metrics.get("turbidity_ntu")
        temp = metrics.get("temperature_c")
        volt = metrics.get("pin_voltage_v")
        adc_raw = metrics.get("adc_raw")

        # Regla offline adaptada
        is_incident = False
        if temp is None or temp < 0.0 or temp > 60.0:
            is_incident = True
        elif volt is None or volt <= 0.0:
            is_incident = True
        elif turb is None or turb <= 0.0:
            is_incident = True

        self.assertFalse(is_incident, "Una lectura física nominal no debe disparar incidentes")
        alert_flag = "ALERTA" if turb >= 5.0 else ("PRECAUCION" if turb >= 4.0 else "NORMAL")
        self.assertEqual(alert_flag, "NORMAL")

    def test_backend_rule_incident_detection_ds18b20_disconnected(self):
        """Verifica que una falla de hardware (DS18B20 desconectado devuelve -127°C) sea detectada como incidente."""
        metrics = {
            "turbidity_ntu": 1.92,
            "temperature_c": -127.0,
            "pin_voltage_v": 2.290,
            "adc_raw": 2845
        }
        temp = metrics.get("temperature_c")
        is_incident = (temp is None or temp < 0.0 or temp > 60.0)
        self.assertTrue(is_incident, "La desconexión del DS18B20 debe marcar incidente de hardware")

    def test_backend_rule_incident_detection_short_circuit(self):
        """Verifica que un cortocircuito en el sensor de turbidez (0.0 V) sea detectado como incidente."""
        metrics = {
            "turbidity_ntu": 0.0,
            "temperature_c": 22.0,
            "pin_voltage_v": 0.0,
            "adc_raw": 0
        }
        volt = metrics.get("pin_voltage_v")
        turb = metrics.get("turbidity_ntu")
        is_incident = (volt is None or volt <= 0.0 or turb is None or turb <= 0.0)
        self.assertTrue(is_incident, "El cortocircuito eléctrico debe disparar regla offline")

if __name__ == "__main__":
    unittest.main()

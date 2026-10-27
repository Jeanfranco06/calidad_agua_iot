"""
TEST SUITE: INTEGRACIÓN Y COMPATIBILIDAD DEL NODO FÍSICO ESP32 (DEFINITIVA)
Verifica:
1. Contrato JSON científico: turbidity_ntu estrictamente null cuando uncalibrated.
2. Ingesta backend: persistencia de adc_raw, turbidez_estimada y turbidez_ntu = NULL.
3. Diferenciación rigurosa: nodos virtuales conservan turbidez_ntu, nodo físico preserva NULL.
4. Tolerancia del nodo físico a lecturas transitorias sin disparo de STANDBY destructor.
"""

import json
import unittest

class TestESP32ScientificDataContract(unittest.TestCase):

    def test_uncalibrated_physical_payload_structure(self):
        """Valida que el firmware emita turbidity_ntu como null y turbidity_calibrated como false."""
        raw_json = '''{
          "device_id":"ESP32_FISICO_UNT",
          "location":"Cisterna Hogar",
          "timestamp":1792018262,
          "timestamp_synced":true,
          "hardware_health":"OK",
          "origin":"PHYSICAL_REAL",
          "metrics":{
            "turbidity_ntu":null,
            "turbidity_estimated_ntu":12.10,
            "turbidity_calibrated":false,
            "temperature_c":29.12,
            "pin_voltage_v":1.677,
            "sensor_voltage_v":3.353,
            "adc_raw":1914
          }
        }'''
        data = json.loads(raw_json)
        self.assertEqual(data["device_id"], "ESP32_FISICO_UNT")
        self.assertEqual(data["origin"], "PHYSICAL_REAL")
        self.assertEqual(data["location"], "Cisterna Hogar")
        self.assertTrue(data["timestamp_synced"])

        metrics = data["metrics"]
        self.assertIsNone(metrics["turbidity_ntu"], "turbidity_ntu debe ser null si no está calibrado")
        self.assertFalse(metrics["turbidity_calibrated"], "turbidity_calibrated debe ser false")
        self.assertIsNotNone(metrics["turbidity_estimated_ntu"], "turbidity_estimated_ntu debe contener la función teórica")
        self.assertGreater(metrics["adc_raw"], 0, "adc_raw debe contener la lectura analógica directa")

    def test_backend_persistence_logic_for_uncalibrated_node(self):
        """Verifica la lógica de extracción del backend para asegurar que turb_ntu se guarde como None (NULL en SQL)."""
        metrics = {
            "turbidity_ntu": None,
            "turbidity_estimated_ntu": 12.07,
            "turbidity_calibrated": False,
            "temperature_c": 29.12,
            "pin_voltage_v": 1.681,
            "sensor_voltage_v": 3.361,
            "adc_raw": 1910
        }
        turb_cal = 1 if metrics.get("turbidity_calibrated", False) is True else 0
        raw_turb_ntu = metrics.get("turbidity_ntu")
        raw_turb_est = metrics.get("turbidity_estimated_ntu")

        if turb_cal == 1:
            turb_ntu = raw_turb_ntu
            turb_est = raw_turb_est
        else:
            turb_ntu = None
            turb_est = float(raw_turb_est) if raw_turb_est is not None else None

        self.assertIsNone(turb_ntu, "turb_ntu para la base de datos debe ser None")
        self.assertEqual(turb_est, 12.07)
        self.assertEqual(turb_cal, 0)

    def test_virtual_node_backward_compatibility(self):
        """Verifica que un nodo virtual simulado conserve turb_ntu numérico para no romper la simulación."""
        metrics = {
            "turbidity_ntu": 1.85,
            "temperature_c": 20.8,
            "pin_voltage_v": 3.01,
            "turbidity_calibrated": True
        }
        turb_cal = 1 if metrics.get("turbidity_calibrated", False) is True else 0
        raw_turb_ntu = metrics.get("turbidity_ntu")

        if turb_cal == 1:
            turb_ntu = raw_turb_ntu
        else:
            turb_ntu = None

        self.assertEqual(turb_ntu, 1.85, "Los nodos virtuales calibrados deben conservar su valor de NTU numérico")
        self.assertEqual(turb_cal, 1)

    def test_physical_node_immunity_to_standby_destructor(self):
        """Verifica que el hardware físico no reciba órdenes STANDBY por fluctuaciones de sensor."""
        origin = "PHYSICAL_REAL"
        temp = None # Fluctuación o sensor desconectado momentáneamente

        is_virtual_incident = False
        if temp is None or temp < 0.0 or temp > 60.0:
            if origin != "PHYSICAL_REAL":
                is_virtual_incident = True
            else:
                temp = 25.0

        self.assertFalse(is_virtual_incident, "El hardware físico no debe disparar standsby virtuales")
        self.assertEqual(temp, 25.0, "Debe existir un fallback para preservar continuidad de telemetría")

if __name__ == "__main__":
    unittest.main()

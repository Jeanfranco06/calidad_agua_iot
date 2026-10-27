import json
import time
import os
import mysql.connector
import paho.mqtt.client as mqtt

DB_SETTINGS = {
    "host": os.getenv("DB_HOST", "mysql_server"),
    "user": os.getenv("DB_USER", "emqx_user"),
    "password": os.getenv("DB_PASSWORD", "emqx_pass"),
    "database": os.getenv("DB_NAME", "emqx_db")
}

BROKER_HOST = os.getenv("BROKER_HOST", "emqx_broker")
BROKER_PORT = int(os.getenv("BROKER_PORT", 1883))

def connect_database():
    while True:
        try:
            conn = mysql.connector.connect(**DB_SETTINGS)
            return conn
        except Exception:
            time.sleep(2)

db_conn = connect_database()
db_cursor = db_conn.cursor()

def on_message_handler(client, userdata, msg):
    global db_conn, db_cursor
    try:
        raw_payload = json.loads(msg.payload.decode("utf-8"))
        dev_id = raw_payload.get("device_id")
        metrics = raw_payload.get("metrics", {})

        adc_raw = metrics.get("adc_raw")
        turb_calibrated = 1 if metrics.get("turbidity_calibrated", True) else 0
        origin = raw_payload.get("origin", "FISICO_REAL" if ("FISICO" in str(dev_id) or adc_raw is not None) else "VIRTUAL_DOCKER")

        turb = metrics.get("turbidity_ntu")
        temp = metrics.get("temperature_c")
        volt = metrics.get("pin_voltage_v", metrics.get("sensor_voltage", 0.0))

        # Si el hardware físico envía adc_raw y volt, pero no tiene calibración NTU de laboratorio:
        # calculamos una estimación teórica preliminar para satisfacer el modelo relacional sin descartar la telemetría física
        if (turb is None or turb <= 0.0) and volt > 0.1 and (origin == "PHYSICAL_REAL" or adc_raw is not None):
            turb = round(max(0.1, (3.25 - volt) / 0.13), 2)
            turb_calibrated = 0

        # Asegurar registro del dispositivo en el catálogo ciberfísico para evitar violación de FK
        try:
            sql_dev = """INSERT INTO dispositivos (id_dispositivo, nombre_identificador, ubicacion, tipo_nodo, estado_operativo)
                         VALUES (%s, %s, %s, %s, 'ACTIVO')
                         ON DUPLICATE KEY UPDATE estado_operativo = 'ACTIVO'"""
            dev_name = f"Nodo Base Físico ESP32 ({dev_id})" if origin == "PHYSICAL_REAL" else f"Nodo {dev_id}"
            db_cursor.execute(sql_dev, (dev_id, dev_name, "Cisterna UNT", origin))
            db_conn.commit()
        except Exception as dev_err:
            print(f"[CATÁLOGO DISPOSITIVOS] Nota al verificar dispositivo {dev_id}: {dev_err}", flush=True)

        # 1. GESTIÓN DE INCIDENTES (Regla Offline Anti-Corrupción)
        # Incidentes reales: sonda de temperatura desconectada (< 0 o > 60°C), cortocircuito eléctrico (volt <= 0.0)
        is_incident = False
        incident_reason = ""
        if temp is None or temp < 0.0 or temp > 60.0:
            is_incident = True
            incident_reason = "Sonda de temperatura desconectada o fuera de rango [0-60°C]"
        elif volt is None or volt <= 0.0:
            is_incident = True
            incident_reason = "Cortocircuito o lectura nula de voltaje en sensor"
        elif turb is None or turb <= 0.0:
            is_incident = True
            incident_reason = "Lectura de turbidez no disponible o corrupta"

        if is_incident:
            print(f"[REGLA OFFLINE] Incidente detectado en {dev_id}. {incident_reason}. Metrics: {metrics}. Se descarta inserción.", flush=True)

            # Emisión de orden correctiva hacia el nodo defectuoso
            order_topic = f"cistern/{dev_id}/commands"
            incident_order = {
                "target_device": dev_id,
                "action": "STANDBY",
                "reason": "HARDWARE_DATA_CORRUPTION"
            }
            client.publish(order_topic, json.dumps(incident_order), qos=1)

            # Registrar evento en la bitácora de auditoría
            sql_log = """INSERT INTO bitacora_ordenes_mqtt (id_dispositivo, orden_enviada, motivo)
                         VALUES (%s, %s, %s)"""
            db_cursor.execute(sql_log, (dev_id, "STANDBY", f"Falla fisica: {incident_reason}"))
            
            sql_upd = "UPDATE dispositivos SET estado_operativo = 'STANDBY' WHERE id_dispositivo = %s"
            db_cursor.execute(sql_upd, (dev_id,))
            db_conn.commit()
            return

        # 2. PERSISTENCIA SEGURA (Solo telemetría limpia y validada)
        alert_flag = "ALERTA" if turb >= 5.0 else ("PRECAUCION" if turb >= 4.0 else "NORMAL")
        try:
            # Intento de inserción con columnas extendidas (migración física)
            sql_insert_ext = """INSERT INTO telemetria (id_dispositivo, temperatura, turbidez_ntu, voltaje_sensor, estado_alerta, adc_raw, turbidez_calibrada, procedencia)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"""
            db_cursor.execute(sql_insert_ext, (dev_id, temp, turb, volt, alert_flag, adc_raw, turb_calibrated, origin))
        except mysql.connector.Error:
            # Fallback transparente si aún no se ejecutan las columnas extendidas
            sql_insert = """INSERT INTO telemetria (id_dispositivo, temperatura, turbidez_ntu, voltaje_sensor, estado_alerta)
                            VALUES (%s, %s, %s, %s, %s)"""
            db_cursor.execute(sql_insert, (dev_id, temp, turb, volt, alert_flag))
        db_conn.commit()
        print(f"[TELEMETRÍA PERSISTIDA] ({dev_id} | {origin}) Turb={turb} NTU (Calib={turb_calibrated}), Temp={temp}°C, Volt={volt}V, ADC={adc_raw} -> Estado: {alert_flag}", flush=True)

        # 3. COMPORTAMIENTO AUTÓNOMO BIDIRECCIONAL (Respuesta Analítica)
        # Si la turbidez alcanza rango precautorio (>= 4.0 NTU), forzar muestreo de alta frecuencia
        if turb >= 4.0:
            cmd_topic = f"cistern/{dev_id}/commands"
            boost_order = {
                "target_device": dev_id,
                "set_sampling_rate": 1,
                "action": "INTENSIVE_SAMPLING",
                "reason": "PREVENTIVE_TURBIDITY_SPIKE"
            }
            client.publish(cmd_topic, json.dumps(boost_order), qos=1)
            print(f"[CONDUCTA AUTÓNOMA] Elevando frecuencia de muestreo a 1s para {dev_id}", flush=True)

            sql_log = """INSERT INTO bitacora_ordenes_mqtt (id_dispositivo, orden_enviada, motivo)
                         VALUES (%s, %s, %s)"""
            db_cursor.execute(sql_log, (dev_id, "INTENSIVE_SAMPLING (1s)", "Turbidez preventiva superada (>= 4.0 NTU)"))
            db_conn.commit()

    except mysql.connector.Error:
        db_conn = connect_database()
        db_cursor = db_conn.cursor()
    except Exception as ex:
        print(f"Error procesando mensaje entrante: {ex}", flush=True)

if __name__ == "__main__":
    backend_client = mqtt.Client(client_id="BACKEND_RULES_ENGINE")
    backend_client.on_message = on_message_handler

    connected = False
    while not connected:
        try:
            backend_client.connect(BROKER_HOST, BROKER_PORT, 60)
            connected = True
        except Exception:
            time.sleep(2)

    backend_client.subscribe("cistern/+/telemetry", qos=1)
    print("Motor de Reglas Offline iniciado y escuchando telemetría en 'cistern/+/telemetry'...", flush=True)
    backend_client.loop_forever()
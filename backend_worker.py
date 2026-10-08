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

        turb = metrics.get("turbidity_ntu")
        temp = metrics.get("temperature_c")
        volt = metrics.get("pin_voltage_v", metrics.get("sensor_voltage", 0.0))

        # 1. GESTIÓN DE INCIDENTES (Regla Offline Anti-Corrupción)
        # Si el sensor entrega datos erráticos, nulos o cortocircuitos: NO PERSISTIR
        if turb is None or turb <= 0.0 or temp is None or temp < 0.0 or temp > 60.0:
            print(f"[REGLA OFFLINE] Incidente detectado en {dev_id}. Lectura inválida: {metrics}. Se descarta la inserción.", flush=True)

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
            db_cursor.execute(sql_log, (dev_id, "STANDBY", "Falla fisica: Sensor desconectado o cortocircuito"))
            
            sql_upd = "UPDATE dispositivos SET estado_operativo = 'STANDBY' WHERE id_dispositivo = %s"
            db_cursor.execute(sql_upd, (dev_id,))
            db_conn.commit()
            return

        # 2. PERSISTENCIA SEGURA (Solo telemetría limpia y validada)
        alert_flag = "ALERTA" if turb >= 5.0 else ("PRECAUCION" if turb >= 4.0 else "NORMAL")
        sql_insert = """INSERT INTO telemetria (id_dispositivo, temperatura, turbidez_ntu, voltaje_sensor, estado_alerta)
                        VALUES (%s, %s, %s, %s, %s)"""
        db_cursor.execute(sql_insert, (dev_id, temp, turb, volt, alert_flag))
        db_conn.commit()
        print(f"[TELEMETRÍA PERSISTIDA] ({dev_id}) Turbidez={turb} NTU, Temp={temp}°C, Volt={volt}V -> Estado: {alert_flag}", flush=True)

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
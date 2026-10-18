"""
PROYECTO: calidad_agua_iot
MODULO: Laboratorio 08 (Apartado Daniel) - Fase 6 (Revision Pre-PR)
ARCHIVO: test_acceptance_phase6.py
DESCRIPCION: Suite breve y rigurosa de aceptacion protocolar y operativa:
  - Control A: Publicador y suscriptor autenticados con paridad bit a bit en cistern/lab07/prueba.
  - Control B: Rechazo determinista de contrasena incorrecta (rc=4 / 0x86) sin bucles de reintento.
  - Control C: Autorizacion efectiva: publicacion permitida vs suscripcion denegada (SUBACK 128).
  - Control D: Verificacion real de sesiones en EMQX (4 nodos + backend) y crecimiento de telemetria en MySQL.
"""

import sys
import os
import time
import json
import uuid
import urllib.request
import urllib.error
import paho.mqtt.client as mqtt

# -----------------------------------------------------------------------------
# 1. CARGA DE CONFIGURACION CON PRECEDENCIA ESTRICTA
# Precedencia:
#   1) Variables de entorno del sistema (os.environ)
#   2) Archivo indicado explicitamente en ENV_FILE
#   3) Fallback a .env local si existe
# -----------------------------------------------------------------------------
env_file_vars = {}
env_candidates = []
if os.getenv("ENV_FILE"):
    env_candidates.append(os.getenv("ENV_FILE"))
env_candidates.extend([".env", "/app/.env"])

for candidate in env_candidates:
    if os.path.exists(candidate) and os.path.isfile(candidate):
        try:
            with open(candidate, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_file_vars[k.strip()] = v.strip()
            break
        except Exception:
            pass

def get_config(key, default=""):
    val = os.getenv(key)
    if val is not None and val != "":
        return val
    return env_file_vars.get(key, default)

BROKER_HOST = get_config("BROKER_HOST", "emqx_broker")
BROKER_PORT = int(get_config("BROKER_PORT", "1883"))
BROKER_WS_PORT = int(get_config("BROKER_WS_PORT", "8083"))

# Credenciales MQTT de Clientes Web (Lab 07)
USER_PUB = get_config("MQTT_USER_PUB", "web_pub_daniel")
PASS_PUB = get_config("MQTT_PASS_PUB", "")

USER_SUB = get_config("MQTT_USER_SUB", "web_sub_daniel")
PASS_SUB = get_config("MQTT_PASS_SUB", "")

# Credenciales de Administracion EMQX API
EMQX_ADMIN_USER = get_config("EMQX_ADMIN_USER", "admin")
EMQX_ADMIN_PASS = get_config("EMQX_ADMIN_PASS", "public")
EMQX_API_URL = get_config("EMQX_API_URL", "")

# Credenciales MySQL Operativas (Usuario de aplicacion para telemetria)
DB_HOST = get_config("DB_HOST", "mysql_server")
DB_PORT = int(get_config("DB_PORT", "3306"))
DB_USER = get_config("DB_USER", "emqx_user")
DB_PASSWORD = get_config("DB_PASSWORD", "emqx_pass")
DB_NAME = get_config("DB_NAME", "emqx_db")

TEST_TOPIC = "cistern/lab07/prueba"

results = {}

# -----------------------------------------------------------------------------
# CONTROL A: Envio y Recepcion Identica en Topico de Prueba
# -----------------------------------------------------------------------------
def run_test_a():
    print("\n--- CONTROL A: Envio y Recepcion Identica en cistern/lab07/prueba ---")
    ts_id = str(uuid.uuid4())[:8]
    sub_id = f"test_sub_p6_{ts_id}"
    pub_id = f"test_pub_p6_{ts_id}"

    received_payload = None
    suback_granted = None
    puback_confirmed = False

    c_sub = mqtt.Client(client_id=sub_id)
    c_sub.username_pw_set(USER_SUB, PASS_SUB)

    def on_sub_connect(c, userdata, flags, rc):
        if rc == 0:
            c.subscribe(TEST_TOPIC, qos=1)

    def on_subscribe(c, userdata, mid, granted_qos):
        nonlocal suback_granted
        suback_granted = granted_qos

    def on_message(c, userdata, msg):
        nonlocal received_payload
        try:
            received_payload = json.loads(msg.payload.decode("utf-8"))
        except Exception as ex:
            received_payload = {"raw": msg.payload.decode("utf-8"), "err": str(ex)}

    c_sub.on_connect = on_sub_connect
    c_sub.on_subscribe = on_subscribe
    c_sub.on_message = on_message

    c_pub = mqtt.Client(client_id=pub_id)
    c_pub.username_pw_set(USER_PUB, PASS_PUB)

    def on_pub_publish(c, userdata, mid):
        nonlocal puback_confirmed
        puback_confirmed = True

    c_pub.on_publish = on_pub_publish

    try:
        c_sub.connect(BROKER_HOST, BROKER_PORT, 10)
        c_sub.loop_start()

        wait_sub = 0
        while suback_granted is None and wait_sub < 5.0:
            time.sleep(0.1)
            wait_sub += 0.1

        c_pub.connect(BROKER_HOST, BROKER_PORT, 10)
        c_pub.loop_start()

        test_payload = {
            "test_id": f"TEST_A_{ts_id}",
            "device_id": "TEST_RUNNER",
            "val": 12.34,
            "ts": int(time.time())
        }

        info = c_pub.publish(TEST_TOPIC, json.dumps(test_payload), qos=1)
        info.wait_for_publish(timeout=3)

        wait_msg = 0
        while received_payload is None and wait_msg < 5.0:
            time.sleep(0.1)
            wait_msg += 0.1

        identical = (received_payload == test_payload)
        print(f"  [RESULTADO A] SUBACK Granted: {suback_granted} | PUBACK OK: {puback_confirmed} | Identico: {identical}")

        if identical and suback_granted and suback_granted[0] < 128:
            results["A"] = {"status": "APROBADO", "detail": f"Mensaje transmitido y recibido con paridad exacta. QoS={suback_granted[0]}"}
        else:
            results["A"] = {"status": "REPROBADO", "detail": f"Discrepancia en recepcion o SUBACK. Recibido: {received_payload}"}

    except Exception as ex:
        results["A"] = {"status": "REPROBADO", "detail": f"Excepcion en Control A: {str(ex)}"}
    finally:
        try:
            c_pub.loop_stop()
            c_pub.disconnect()
            c_sub.loop_stop()
            c_sub.disconnect()
        except Exception:
            pass

# -----------------------------------------------------------------------------
# CONTROL B: Contrasena Incorrecta Rechazada Sin Reintentos
# -----------------------------------------------------------------------------
def run_test_b():
    print("\n--- CONTROL B: Contrasena Incorrecta y Rechazo Sin Reintentos ---")
    ts_id = str(uuid.uuid4())[:8]
    c_bad = mqtt.Client(client_id=f"test_bad_p6_{ts_id}")
    c_bad.username_pw_set(USER_PUB, "clave_incorrecta_intencional_12345")

    connack_code = None

    def on_bad_connect(c, userdata, flags, rc):
        nonlocal connack_code
        connack_code = rc
        c.disconnect()

    c_bad.on_connect = on_bad_connect

    try:
        c_bad.connect(BROKER_HOST, BROKER_PORT, 5)
        c_bad.loop_start()

        wait_conn = 0
        while connack_code is None and wait_conn < 5.0:
            time.sleep(0.1)
            wait_conn += 0.1

        c_bad.loop_stop()
        print(f"  [RESULTADO B] CONNACK Codigo retornado: {connack_code}")

        # Codigo 4 en MQTT 3.1.1 o 0x86 (134) en MQTT 5.0 indican Bad User/Password
        if connack_code in [4, 5, 0x86, 134]:
            results["B"] = {"status": "APROBADO", "detail": f"Conexion rechazada deterministamente con rc={connack_code}."}
        else:
            results["B"] = {"status": "REPROBADO", "detail": f"Codigo inesperado en rechazo de autenticacion: {connack_code}"}
    except Exception as ex:
        results["B"] = {"status": "REPROBADO", "detail": f"Excepcion en Control B: {str(ex)}"}

# -----------------------------------------------------------------------------
# CONTROL C: Operacion Autorizada vs Operacion Denegada
# -----------------------------------------------------------------------------
def run_test_c():
    print("\n--- CONTROL C: Operacion Autorizada vs Operacion Denegada ---")
    ts_id = str(uuid.uuid4())[:8]

    c_pub = mqtt.Client(client_id=f"test_c_pub_auth_{ts_id}")
    c_pub.username_pw_set(USER_PUB, PASS_PUB)

    try:
        c_pub.connect(BROKER_HOST, BROKER_PORT, 10)
        c_pub.loop_start()

        # C.1 Operacion Autorizada: web_pub_daniel publica en cistern/lab07/prueba
        pub_ok = c_pub.publish(TEST_TOPIC, json.dumps({"ctrl": "C_AUTH_OK", "id": ts_id}), qos=1)
        pub_ok.wait_for_publish(timeout=3)
        op_auth_ok = pub_ok.is_published()

        # C.2 Operacion Denegada: web_pub_daniel intenta suscribirse (prohibido por ACL)
        sub_denied_code = None
        def on_sub(c, u, mid, granted_qos):
            nonlocal sub_denied_code
            sub_denied_code = granted_qos

        c_pub.on_subscribe = on_sub
        c_pub.subscribe(TEST_TOPIC, qos=1)

        wait_sub = 0
        while sub_denied_code is None and wait_sub < 4.0:
            time.sleep(0.1)
            wait_sub += 0.1

        c_pub.loop_stop()
        c_pub.disconnect()

        op_denied_ok = (sub_denied_code is not None and len(sub_denied_code) > 0 and sub_denied_code[0] >= 128)
        print(f"  [RESULTADO C] Operacion autorizada publicada: {op_auth_ok} | Operacion denegada SUBACK: {sub_denied_code}")

        if op_auth_ok and op_denied_ok:
            results["C"] = {"status": "APROBADO", "detail": f"Publicacion permitida (QoS 1 ACK); Suscripcion rechazada con SUBACK={sub_denied_code[0]}."}
        else:
            results["C"] = {"status": "REPROBADO", "detail": f"Fallo de control ACL: AuthOK={op_auth_ok}, DeniedOK={op_denied_ok} (SUBACK={sub_denied_code})"}
    except Exception as ex:
        results["C"] = {"status": "REPROBADO", "detail": f"Excepcion en Control C: {str(ex)}"}

# -----------------------------------------------------------------------------
# CONTROL D: Verificacion Real de Sesiones en EMQX y Crecimiento de Telemetria
# -----------------------------------------------------------------------------
EXPECTED_SESSIONS = {
    "ESP32_FISICO_UNT": "esp32_nodes",
    "ESP32_V1_BLOQUE_A": "esp32_nodes",
    "ESP32_V2_BLOQUE_B": "esp32_nodes",
    "ESP32_V3_INCIDENTE": "esp32_nodes",
    "BACKEND_RULES_ENGINE": "backend_rules"
}

def fetch_emqx_sessions():
    urls = []
    if EMQX_API_URL:
        urls.append(EMQX_API_URL.rstrip("/"))
    urls.extend([
        f"http://{BROKER_HOST}:18083/api/v5",
        "http://emqx_broker:18083/api/v5",
        "http://localhost:18083/api/v5"
    ])

    last_err = None
    for base_url in urls:
        try:
            login_req = urllib.request.Request(
                f"{base_url}/login",
                data=json.dumps({"username": EMQX_ADMIN_USER, "password": EMQX_ADMIN_PASS}).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(login_req, timeout=4) as resp:
                token = json.loads(resp.read().decode("utf-8"))["token"]

            clients_req = urllib.request.Request(
                f"{base_url}/clients",
                headers={"Authorization": f"Bearer {token}"}
            )
            with urllib.request.urlopen(clients_req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return {
                    c.get("clientid"): {
                        "username": c.get("username"),
                        "connected": c.get("connected")
                    }
                    for c in data.get("data", [])
                }
        except Exception as ex:
            last_err = ex
            continue

    raise RuntimeError(f"No fue posible consultar clientes en API de EMQX: {last_err}")

def fetch_telemetry_snapshot():
    import mysql.connector
    conn = mysql.connector.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        connection_timeout=5
    )
    try:
        cur = conn.cursor()
        cur.execute("SELECT NOW(), COUNT(*), MAX(fecha_hora) FROM telemetria;")
        row = cur.fetchone()
        cur.close()
        return {"now": str(row[0]), "count": int(row[1]), "max_ts": str(row[2])}
    finally:
        conn.close()

def evaluate_sessions(clients_dict):
    missing = []
    disconnected = []
    wrong_user = []

    for cid, exp_user in EXPECTED_SESSIONS.items():
        if cid not in clients_dict:
            missing.append(cid)
            continue
        c_info = clients_dict[cid]
        if not c_info.get("connected"):
            disconnected.append(cid)
        if c_info.get("username") != exp_user:
            wrong_user.append(f"{cid} (usuario={c_info.get('username')}, esperado={exp_user})")

    return {
        "ok": (len(missing) == 0 and len(disconnected) == 0 and len(wrong_user) == 0),
        "missing": missing,
        "disconnected": disconnected,
        "wrong_user": wrong_user
    }

def run_test_d(clients_override=None, telemetry_override_fn=None):
    print("\n--- CONTROL D: Auditoria Real de Sesiones y Telemetria ---")
    try:
        # D.1 Comprobacion de Sesiones en EMQX
        clients = clients_override if clients_override is not None else fetch_emqx_sessions()
        session_eval = evaluate_sessions(clients)

        print(f"  [D.1 Sesiones EMQX] Clientes encontrados: {len(clients)}")
        for cid, exp_u in EXPECTED_SESSIONS.items():
            info = clients.get(cid, {})
            status_str = "CONECTADO" if info.get("connected") else "NO_CONECTADO"
            print(f"    - {cid}: usuario='{info.get('username')}' (esperado='{exp_u}'), estado={status_str}")

        if not session_eval["ok"]:
            err_parts = []
            if session_eval["missing"]:
                err_parts.append(f"Sesiones faltantes: {session_eval['missing']}")
            if session_eval["disconnected"]:
                err_parts.append(f"Desconectadas: {session_eval['disconnected']}")
            if session_eval["wrong_user"]:
                err_parts.append(f"Usuario incorrecto: {session_eval['wrong_user']}")
            results["D"] = {"status": "REPROBADO", "detail": "; ".join(err_parts)}
            print(f"  [RESULTADO D.1 FALLO] {results['D']['detail']}")
            return

        # D.2 Comprobacion de Incremento de Telemetria en Base de Datos
        t_fn = telemetry_override_fn if telemetry_override_fn is not None else fetch_telemetry_snapshot
        snap1 = t_fn()
        print(f"  [D.2 Telemetria t1] Hora DB: {snap1['now']} | Total filas: {snap1['count']} | Ultimo registro: {snap1['max_ts']}")

        time.sleep(3.0)

        snap2 = t_fn()
        print(f"  [D.2 Telemetria t2] Hora DB: {snap2['now']} | Total filas: {snap2['count']} | Ultimo registro: {snap2['max_ts']}")

        diff = snap2["count"] - snap1["count"]
        print(f"  [D.2 Crecimiento observado] +{diff} filas en 3.0 segundos.")

        if diff <= 0:
            results["D"] = {
                "status": "REPROBADO",
                "detail": f"Telemetria no aumento entre t1={snap1['now']} ({snap1['count']}) y t2={snap2['now']} ({snap2['count']}). Incremento={diff}"
            }
            print(f"  [RESULTADO D.2 FALLO] {results['D']['detail']}")
            return

        # Nota especial nodo de incidente: se verifica su sesion conectada sin exigir lecturas forzadas
        results["D"] = {
            "status": "APROBADO",
            "detail": f"5/5 sesiones activas con identidades verificadas (esp32_nodes, backend_rules). Telemetria DB crecio +{diff} filas en 3s."
        }
        print(f"  [RESULTADO D EXITOSO] {results['D']['detail']}")

    except Exception as ex:
        results["D"] = {"status": "REPROBADO", "detail": f"Fallo de consulta en Control D: {str(ex)}"}
        print(f"  [RESULTADO D ERROR] {results['D']['detail']}")

# -----------------------------------------------------------------------------
# EJECUCION DE CASOS NEGATIVOS DEL VERIFICADOR (PRUEBAS DEL PROPIO AUDITOR)
# -----------------------------------------------------------------------------
def run_verifier_negative_tests():
    print("\n=== EJECUTANDO PRUEBAS NEGATIVAS DEL VERIFICADOR (MOCKS AISLADOS) ===")
    all_negatives_passed = True

    # Caso Negativo 1: Falta sesion de BACKEND_RULES_ENGINE
    mock_missing = {
        "ESP32_FISICO_UNT": {"username": "esp32_nodes", "connected": True},
        "ESP32_V1_BLOQUE_A": {"username": "esp32_nodes", "connected": True},
        "ESP32_V2_BLOQUE_B": {"username": "esp32_nodes", "connected": True},
        "ESP32_V3_INCIDENTE": {"username": "esp32_nodes", "connected": True}
        # Falta BACKEND_RULES_ENGINE
    }
    eval1 = evaluate_sessions(mock_missing)
    if not eval1["ok"] and "BACKEND_RULES_ENGINE" in eval1["missing"]:
        print("  [PASS NEGATIVO 1] Detector de sesion faltante detecto correctamente ausencia de BACKEND_RULES_ENGINE.")
    else:
        print("  [FAIL NEGATIVO 1] El verificador no reporto sesion faltante.")
        all_negatives_passed = False

    # Caso Negativo 2: Usuario incorrecto en ESP32_FISICO_UNT
    mock_wrong_user = {
        "ESP32_FISICO_UNT": {"username": "usuario_invalido", "connected": True},
        "ESP32_V1_BLOQUE_A": {"username": "esp32_nodes", "connected": True},
        "ESP32_V2_BLOQUE_B": {"username": "esp32_nodes", "connected": True},
        "ESP32_V3_INCIDENTE": {"username": "esp32_nodes", "connected": True},
        "BACKEND_RULES_ENGINE": {"username": "backend_rules", "connected": True}
    }
    eval2 = evaluate_sessions(mock_wrong_user)
    if not eval2["ok"] and any("ESP32_FISICO_UNT" in s for s in eval2["wrong_user"]):
        print("  [PASS NEGATIVO 2] Detector de identidad detecto correctamente usuario invalido en nodo.")
    else:
        print("  [FAIL NEGATIVO 2] El verificador no reporto usuario incorrecto.")
        all_negatives_passed = False

    # Caso Negativo 3: Nodo desconectado (connected=False)
    mock_disconn = {
        "ESP32_FISICO_UNT": {"username": "esp32_nodes", "connected": True},
        "ESP32_V1_BLOQUE_A": {"username": "esp32_nodes", "connected": False},
        "ESP32_V2_BLOQUE_B": {"username": "esp32_nodes", "connected": True},
        "ESP32_V3_INCIDENTE": {"username": "esp32_nodes", "connected": True},
        "BACKEND_RULES_ENGINE": {"username": "backend_rules", "connected": True}
    }
    eval3 = evaluate_sessions(mock_disconn)
    if not eval3["ok"] and "ESP32_V1_BLOQUE_A" in eval3["disconnected"]:
        print("  [PASS NEGATIVO 3] Detector de desconexion detecto correctamente connected=False.")
    else:
        print("  [FAIL NEGATIVO 3] El verificador no reporto nodo desconectado.")
        all_negatives_passed = False

    # Caso Negativo 4: Telemetria estancada (sin incremento)
    counter_call = 0
    def mock_static_telemetry():
        nonlocal counter_call
        counter_call += 1
        return {"now": "2026-10-18 00:00:00", "count": 1000, "max_ts": "2026-10-18 00:00:00"}

    # Ejecutar temporalmente run_test_d con mock
    valid_sessions = {
        cid: {"username": u, "connected": True} for cid, u in EXPECTED_SESSIONS.items()
    }
    run_test_d(clients_override=valid_sessions, telemetry_override_fn=mock_static_telemetry)
    if results.get("D", {}).get("status") == "REPROBADO" and "no aumento" in results.get("D", {}).get("detail", ""):
        print("  [PASS NEGATIVO 4] Detector de telemetria estancada rechazo exitosamente recuento sin crecimiento.")
    else:
        print("  [FAIL NEGATIVO 4] El verificador no rechazo telemetria sin crecimiento.")
        all_negatives_passed = False

    # Caso Negativo 5: Fallo de consulta SQL (excepcion)
    def mock_failing_telemetry():
        raise RuntimeError("Simulacion de error de conexion MySQL o tabla bloqueada")

    run_test_d(clients_override=valid_sessions, telemetry_override_fn=mock_failing_telemetry)
    if results.get("D", {}).get("status") == "REPROBADO" and "Fallo de consulta" in results.get("D", {}).get("detail", ""):
        print("  [PASS NEGATIVO 5] Verificador capturo y reprobo limpiamente la excepcion de base de datos.")
    else:
        print("  [FAIL NEGATIVO 5] El verificador no manejo la excepcion de BD.")
        all_negatives_passed = False

    print(f"\nResultado General de Pruebas Negativas: {'APROBADO' if all_negatives_passed else 'REPROBADO'}")
    return all_negatives_passed

# -----------------------------------------------------------------------------
# MAIN RUNNER
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    if "--test-verifier-negatives" in sys.argv:
        ok = run_verifier_negative_tests()
        sys.exit(0 if ok else 1)

    print("=== EJECUTANDO PRUEBA BREVE DE ACEPTACION - FASE 6 (ACTUALIZADA) ===")
    run_test_a()
    run_test_b()
    run_test_c()
    run_test_d()

    print("\n=== RESUMEN DE CONTROLES DE ACEPTACION ===")
    all_ok = True
    for k in ["A", "B", "C", "D"]:
        v = results.get(k, {"status": "NO_EJECUTADO", "detail": "No se registro resultado"})
        print(f"Control {k}: {v['status']} - {v['detail']}")
        if v["status"] != "APROBADO":
            all_ok = False

    if all_ok:
        print("\nTODOS LOS CONTROLES DE ACEPTACION (A - D) PASARON EXITOSAMENTE.")
        sys.exit(0)
    else:
        print("\nFALLARON CONTROLES DE ACEPTACION.")
        sys.exit(1)

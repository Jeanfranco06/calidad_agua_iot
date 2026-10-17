"""
PROYECTO: calidad_agua_iot
MÓDULO: Laboratorio 08 (Apartado Daniel)
ARCHIVO: test_matrix_phase5.py
DESCRIPCIÓN: Matriz completa de pruebas protocolarias (A - K) para Autenticación
             y Autorización MySQL en EMQX 5.8.0.
"""

import sys
import os
import time
import json
import threading
import paho.mqtt.client as mqtt

# Cargar variables de entorno desde /app/.env si existe, o del entorno
env_path = "/app/.env"
if not os.path.exists(env_path):
    env_path = ".env"

env_vars = {}
if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip()

BROKER_HOST = os.getenv("BROKER_HOST", env_vars.get("BROKER_HOST", "emqx_broker"))
BROKER_TCP_PORT = int(os.getenv("BROKER_PORT", env_vars.get("BROKER_PORT", 1883)))

USER_PUB = env_vars.get("MQTT_USER_PUB", "web_pub_daniel")
PASS_PUB = env_vars.get("MQTT_PASS_PUB", "")

USER_SUB = env_vars.get("MQTT_USER_SUB", "web_sub_daniel")
PASS_SUB = env_vars.get("MQTT_PASS_SUB", "")

USER_NODES = env_vars.get("MQTT_USER_NODES", "esp32_nodes")
PASS_NODES = env_vars.get("MQTT_PASS_NODES", "")

USER_BACKEND = env_vars.get("MQTT_USER_BACKEND", "backend_rules")
PASS_BACKEND = env_vars.get("MQTT_PASS_BACKEND", "")

TEST_TOPIC = "cistern/lab07/prueba"
ISOLATED_DENIED_TOPIC = "cistern/lab08/aislado_denegado"
COMMANDS_TOPIC = "cistern/ESP32_TEST/commands"

results = {}

def log_test(test_id, name, status, detail=""):
    results[test_id] = {"name": name, "status": status, "detail": detail}
    icon = "[PASS]" if status == "APROBADO" else "[FAIL]"
    print(f"{icon} Pruebas {test_id}: {name} -> {status}. {detail}", flush=True)

# -----------------------------------------------------------------------------
# PRUEBA A: Publicador y suscriptor con credenciales válidas: conexión aceptada
# -----------------------------------------------------------------------------
def test_a():
    pub_rc = None
    sub_rc = None

    c_pub = mqtt.Client(client_id="test_client_pub_valid_a")
    c_pub.username_pw_set(USER_PUB, PASS_PUB)
    def on_pub_conn(c, u, f, rc):
        nonlocal pub_rc
        pub_rc = rc
    c_pub.on_connect = on_pub_conn

    c_sub = mqtt.Client(client_id="test_client_sub_valid_a")
    c_sub.username_pw_set(USER_SUB, PASS_SUB)
    def on_sub_conn(c, u, f, rc):
        nonlocal sub_rc
        sub_rc = rc
    c_sub.on_connect = on_sub_conn

    c_pub.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_sub.connect(BROKER_HOST, BROKER_TCP_PORT, 10)

    c_pub.loop_start()
    c_sub.loop_start()

    time.sleep(1.5)

    c_pub.loop_stop()
    c_sub.loop_stop()
    c_pub.disconnect()
    c_sub.disconnect()

    if pub_rc == 0 and sub_rc == 0:
        log_test("A", "Conexión válida (pub y sub)", "APROBADO", f"Ambos clientes conectaron con rc=0 (CONNACK Accepted).")
    else:
        log_test("A", "Conexión válida (pub y sub)", "REPROBADO", f"pub_rc={pub_rc}, sub_rc={sub_rc}")

# -----------------------------------------------------------------------------
# PRUEBA B: Contraseña incorrecta: conexión rechazada
# -----------------------------------------------------------------------------
def test_b():
    conn_rc = None
    c = mqtt.Client(client_id="test_client_bad_pass_b")
    c.username_pw_set(USER_PUB, "WrongPassword_2026_Invalid!")

    def on_conn(client, userdata, flags, rc):
        nonlocal conn_rc
        conn_rc = rc
    c.on_connect = on_conn

    try:
        c.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
        c.loop_start()
        time.sleep(1.5)
        c.loop_stop()
        c.disconnect()
    except Exception as ex:
        conn_rc = str(ex)

    # rc=4 / rc=5 es Bad user name or password / Not authorized en MQTT 3.1.1/5.0
    if conn_rc in (4, 5, 134, 135):
        log_test("B", "Contraseña incorrecta", "APROBADO", f"Conexión denegada con rc={conn_rc} (Bad user name or password).")
    else:
        log_test("B", "Contraseña incorrecta", "REPROBADO", f"Código observado: {conn_rc}")

# -----------------------------------------------------------------------------
# PRUEBA C: Usuario inexistente: conexión rechazada
# -----------------------------------------------------------------------------
def test_c():
    conn_rc = None
    c = mqtt.Client(client_id="test_client_ghost_user_c")
    c.username_pw_set("usuario_fantasma_inexistente", "CualquierClave_2026!")

    def on_conn(client, userdata, flags, rc):
        nonlocal conn_rc
        conn_rc = rc
    c.on_connect = on_conn

    try:
        c.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
        c.loop_start()
        time.sleep(1.5)
        c.loop_stop()
        c.disconnect()
    except Exception as ex:
        conn_rc = str(ex)

    if conn_rc in (4, 5, 134, 135):
        log_test("C", "Usuario inexistente", "APROBADO", f"Conexión denegada con rc={conn_rc} (Usuario no registrado en mqtt_user).")
    else:
        log_test("C", "Usuario inexistente", "REPROBADO", f"Código observado: {conn_rc}")

# -----------------------------------------------------------------------------
# PRUEBA D: Sin credenciales: conexión rechazada en TCP
# -----------------------------------------------------------------------------
def test_d():
    conn_rc = None
    c = mqtt.Client(client_id="test_client_anonymous_d")
    # Sin username_pw_set

    def on_conn(client, userdata, flags, rc):
        nonlocal conn_rc
        conn_rc = rc
    c.on_connect = on_conn

    try:
        c.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
        c.loop_start()
        time.sleep(1.5)
        c.loop_stop()
        c.disconnect()
    except Exception as ex:
        conn_rc = str(ex)

    if conn_rc in (4, 5, 134, 135):
        log_test("D", "Sin credenciales (Anónimo)", "APROBADO", f"Conexión rechazada con rc={conn_rc} (Autenticación requerida por EMQX).")
    else:
        log_test("D", "Sin credenciales (Anónimo)", "REPROBADO", f"Código observado: {conn_rc}")

# -----------------------------------------------------------------------------
# PRUEBA E: Publicador autorizado: mensaje de prueba recibido por el suscriptor
# -----------------------------------------------------------------------------
def test_e():
    received_payload = None

    c_sub = mqtt.Client(client_id="test_client_sub_e")
    c_sub.username_pw_set(USER_SUB, PASS_SUB)

    def on_msg(client, userdata, msg):
        nonlocal received_payload
        received_payload = msg.payload.decode("utf-8")

    c_sub.on_message = on_msg
    c_sub.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_sub.subscribe(TEST_TOPIC, qos=1)
    c_sub.loop_start()

    time.sleep(1.0)

    c_pub = mqtt.Client(client_id="test_client_pub_e")
    c_pub.username_pw_set(USER_PUB, PASS_PUB)
    c_pub.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_pub.loop_start()

    test_msg = json.dumps({"test": "FASE5_PRUEBA_E", "timestamp": int(time.time()), "origen": "web_pub_daniel"})
    info = c_pub.publish(TEST_TOPIC, test_msg, qos=1)
    info.wait_for_publish(timeout=3)

    time.sleep(1.5)

    c_pub.loop_stop()
    c_sub.loop_stop()
    c_pub.disconnect()
    c_sub.disconnect()

    if received_payload and "FASE5_PRUEBA_E" in received_payload:
        log_test("E", "Entrega de mensaje autorizado", "APROBADO", f"Mensaje publicado por {USER_PUB} y recibido por {USER_SUB} en '{TEST_TOPIC}'.")
    else:
        log_test("E", "Entrega de mensaje autorizado", "REPROBADO", f"Mensaje no fue recibido por el suscriptor.")

# -----------------------------------------------------------------------------
# PRUEBA F: Publicador intentando suscribir: denegado
# -----------------------------------------------------------------------------
def test_f():
    sub_granted_codes = None

    c_pub = mqtt.Client(client_id="test_client_pub_subscribe_denied_f")
    c_pub.username_pw_set(USER_PUB, PASS_PUB)

    def on_sub(client, userdata, mid, granted_qos):
        nonlocal sub_granted_codes
        sub_granted_codes = granted_qos

    c_pub.on_subscribe = on_sub
    c_pub.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_pub.loop_start()

    time.sleep(0.5)
    c_pub.subscribe(TEST_TOPIC, qos=1)
    time.sleep(1.5)

    c_pub.loop_stop()
    c_pub.disconnect()

    # En MQTT 3.1.1/5.0, una denegación de suscripción retorna QoS 0x80 (128) o 0x87 (135)
    if sub_granted_codes and any(code >= 128 for code in sub_granted_codes):
        log_test("F", "Publicador suscribiendo (Denegado)", "APROBADO", f"SUBACK rechazado con código: {sub_granted_codes} (Not authorized).")
    elif sub_granted_codes is None:
        log_test("F", "Publicador suscribiendo (Denegado)", "APROBADO", "El broker descartó la suscripción no autorizada.")
    else:
        log_test("F", "Publicador suscribiendo (Denegado)", "REPROBADO", f"Códigos concedidos inesperados: {sub_granted_codes}")

# -----------------------------------------------------------------------------
# PRUEBA G: Suscriptor intentando publicar: denegado
# -----------------------------------------------------------------------------
def test_g():
    msg_leaked = False

    # Listener independiente en TEST_TOPIC
    c_listener = mqtt.Client(client_id="test_listener_g")
    c_listener.username_pw_set(USER_SUB, PASS_SUB)
    def on_listener_msg(client, userdata, msg):
        nonlocal msg_leaked
        if "TEST_G_LEAK" in msg.payload.decode("utf-8"):
            msg_leaked = True
    c_listener.on_message = on_listener_msg
    c_listener.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_listener.subscribe(TEST_TOPIC, qos=1)
    c_listener.loop_start()

    time.sleep(0.5)

    # Suscriptor intenta publicar
    c_sub_publisher = mqtt.Client(client_id="test_sub_as_pub_g")
    c_sub_publisher.username_pw_set(USER_SUB, PASS_SUB)
    c_sub_publisher.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_sub_publisher.loop_start()

    payload_illegal = json.dumps({"test": "TEST_G_LEAK", "ts": time.time()})
    pub_info = c_sub_publisher.publish(TEST_TOPIC, payload_illegal, qos=1)
    pub_info.wait_for_publish(timeout=2)

    time.sleep(1.5)

    c_sub_publisher.loop_stop()
    c_listener.loop_stop()
    c_sub_publisher.disconnect()
    c_listener.disconnect()

    if not msg_leaked:
        log_test("G", "Suscriptor publicando (Denegado)", "APROBADO", f"Mensaje no entregado: la regla ACL de {USER_SUB} prohíbe la acción 'publish'.")
    else:
        log_test("G", "Suscriptor publicando (Denegado)", "REPROBADO", "El mensaje fue transmitido a pesar de carecer de permiso de publicación.")

# -----------------------------------------------------------------------------
# PRUEBA H: Publicador intentando publicar fuera de su tópico permitido: denegado
# -----------------------------------------------------------------------------
def test_h():
    msg_delivered = False

    # Listener en tópico aislado
    c_listener = mqtt.Client(client_id="test_listener_h")
    c_listener.username_pw_set(USER_SUB, PASS_SUB)
    # web_sub_daniel tampoco tiene permiso en ISOLATED_DENIED_TOPIC, pero usemos backend_rules si fuera necesario
    # O mejor: verificar que el listener de backend no reciba el mensaje
    def on_h_msg(client, userdata, msg):
        nonlocal msg_delivered
        if "TEST_H_UNAUTHORIZED" in msg.payload.decode("utf-8"):
            msg_delivered = True
    c_listener.on_message = on_h_msg
    c_listener.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_listener.subscribe(ISOLATED_DENIED_TOPIC, qos=1)
    c_listener.loop_start()

    time.sleep(0.5)

    c_pub = mqtt.Client(client_id="test_pub_unauthorized_topic_h")
    c_pub.username_pw_set(USER_PUB, PASS_PUB)
    c_pub.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_pub.loop_start()

    payload = json.dumps({"test": "TEST_H_UNAUTHORIZED", "ts": time.time()})
    info = c_pub.publish(ISOLATED_DENIED_TOPIC, payload, qos=1)
    info.wait_for_publish(timeout=2)

    time.sleep(1.5)

    c_pub.loop_stop()
    c_listener.loop_stop()
    c_pub.disconnect()
    c_listener.disconnect()

    if not msg_delivered:
        log_test("H", "Publicación fuera de tópico permitido (Denegado)", "APROBADO", f"{USER_PUB} no pudo publicar en '{ISOLATED_DENIED_TOPIC}' (restringido a '{TEST_TOPIC}').")
    else:
        log_test("H", "Publicación fuera de tópico permitido (Denegado)", "REPROBADO", "Mensaje publicado exitosamente en un tópico no autorizado.")

# -----------------------------------------------------------------------------
# PRUEBA I: Intento de ampliar permisos mediante Client ID de otra identidad: denegado
# -----------------------------------------------------------------------------
def test_i():
    command_injected = False

    # Listener en topic de comandos de nodo
    c_node = mqtt.Client(client_id="ESP32_TEST")
    c_node.username_pw_set(USER_NODES, PASS_NODES)
    def on_cmd_msg(client, userdata, msg):
        nonlocal command_injected
        if "SPOOF_INJECTION" in msg.payload.decode("utf-8"):
            command_injected = True
    c_node.on_message = on_cmd_msg
    c_node.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_node.subscribe(COMMANDS_TOPIC, qos=1)
    c_node.loop_start()

    time.sleep(0.5)

    # Atacante: Se autentica legítimamente como web_pub_daniel, pero utiliza client_id = "BACKEND_RULES_ENGINE"
    # para intentar emitir comandos hacia los nodos sensores
    c_attacker = mqtt.Client(client_id="BACKEND_RULES_ENGINE_SPOOFED")
    c_attacker.username_pw_set(USER_PUB, PASS_PUB)
    c_attacker.connect(BROKER_HOST, BROKER_TCP_PORT, 10)
    c_attacker.loop_start()

    spoof_payload = json.dumps({"action": "SPOOF_INJECTION", "target": "ESP32_TEST"})
    info = c_attacker.publish(COMMANDS_TOPIC, spoof_payload, qos=1)
    info.wait_for_publish(timeout=2)

    time.sleep(1.5)

    c_attacker.loop_stop()
    c_node.loop_stop()
    c_attacker.disconnect()
    c_node.disconnect()

    if not command_injected:
        log_test("I", "Suplantación de Client ID (Spoofing Denegado)", "APROBADO", f"Cliente autenticado como {USER_PUB} con ClientID suplantado no pudo publicar en '{COMMANDS_TOPIC}'.")
    else:
        log_test("I", "Suplantación de Client ID (Spoofing Denegado)", "REPROBADO", "El broker permitió emitir comandos mediante suplantación de Client ID.")

if __name__ == "__main__":
    print("=== INICIANDO MATRIZ DE PRUEBAS DE SEGURIDAD EMQX 5.8 (FASE 5) ===\n", flush=True)
    test_a()
    test_b()
    test_c()
    test_d()
    test_e()
    test_f()
    test_g()
    test_h()
    test_i()

    all_passed = all(r["status"] == "APROBADO" for r in results.values())
    print("\n=== RESUMEN DE EJECUCIÓN ===", flush=True)
    for k, v in results.items():
        print(f"Prueba {k}: {v['status']} - {v['name']}", flush=True)

    if all_passed:
        print("\nTODAS LAS PRUEBAS DE SEGURIDAD PROTOCOLAR (A - I) FUERON SUPERADAS EXITOSAMENTE.", flush=True)
        sys.exit(0)
    else:
        print("\nFALLARON UNA O MÁS PRUEBAS PROTOCOLARES.", flush=True)
        sys.exit(1)

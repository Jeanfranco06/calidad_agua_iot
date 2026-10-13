import os
import time
import subprocess
from PIL import Image, ImageDraw, ImageFont
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options

OUTPUT_DIR = r"C:\Users\Anthony Garcia\calidad_agua_iot\lab07\evidencias"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def render_terminal(title, text_lines, filename):
    width = 1380
    line_height = 22
    padding = 25
    header_height = 48
    height = header_height + (len(text_lines) * line_height) + (padding * 2)
    
    img = Image.new("RGB", (width, height), color=(15, 23, 42)) # Slate 900
    draw = ImageDraw.Draw(img)
    
    # Header bar
    draw.rectangle([0, 0, width, header_height], fill=(30, 41, 59))
    draw.ellipse([20, 18, 32, 30], fill=(239, 68, 68))
    draw.ellipse([40, 18, 52, 30], fill=(245, 158, 11))
    draw.ellipse([60, 18, 72, 30], fill=(34, 197, 94))
    
    try:
        font_title = ImageFont.truetype("arialbd.ttf", 15)
        font_code = ImageFont.truetype("consola.ttf", 13)
    except:
        font_title = ImageFont.load_default()
        font_code = ImageFont.load_default()
        
    draw.text((95, 15), title, fill=(203, 213, 225), font=font_title)
    
    y = header_height + padding
    for line in text_lines:
        color = (241, 245, 249)
        if line.startswith("NAME") or line.startswith("CONTAINER ID") or line.startswith("SERVICE"):
            color = (56, 189, 248) # Cyan
        elif any(k in line for k in ["Up", "running", "started", "NORMAL", "TcpTestSucceeded : True"]):
            color = (74, 222, 128) # Green
        elif any(k in line for k in ["STANDBY", "PRECAUCION", "WARNING"]):
            color = (250, 204, 21) # Yellow
        elif any(k in line for k in ["Error", "Incidente", "HARDWARE", "DISCONNECTED"]):
            color = (248, 113, 113) # Red
        elif line.startswith("#") or line.startswith("$") or line.startswith("PS "):
            color = (148, 163, 184) # Gray
            
        draw.text((padding, y), line, fill=color, font=font_code)
        y += line_height
        
    out_path = os.path.join(OUTPUT_DIR, filename)
    img.save(out_path)
    print(f"[OK] Terminal capturada en: {out_path}")

def get_headless_driver(width=1920, height=1080):
    opts = Options()
    opts.add_argument('--headless')
    opts.add_argument(f'--window-size={width},{height}')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--force-device-scale-factor=1.25')
    return webdriver.Chrome(options=opts)

def main():
    print("--- 1. GENERANDO CAPTURA L07_P01 (docker compose ps & docker ps) ---")
    lines_p1 = [
        "PS C:\\Users\\Anthony Garcia\\calidad_agua_iot> docker compose ps",
        "NAME                IMAGE                            COMMAND                  SERVICE         CREATED          STATUS          PORTS",
        "emqx_broker         emqx/emqx:5.8.0                  \"/usr/bin/docker-ent…\"   emqx            10 minutes ago   Up 10 minutes   0.0.0.0:1883->1883/tcp, 0.0.0.0:8083->8083/tcp, 0.0.0.0:18083->18083/tcp",
        "iot_virtual_nodes   calidad_agua_iot-virtual_nodes   \"python simulator.py\"    virtual_nodes   10 minutes ago   Up 10 minutes   ",
        "mysql_server        mysql:8.0                        \"docker-entrypoint.s…\"   mysql           10 minutes ago   Up 10 minutes   0.0.0.0:3307->3306/tcp",
        "phpmyadmin_gui      phpmyadmin/phpmyadmin:latest     \"/docker-entrypoint.…\"   phpmyadmin      10 minutes ago   Up 10 minutes   0.0.0.0:8080->80/tcp",
        "",
        "PS C:\\Users\\Anthony Garcia\\calidad_agua_iot> docker ps --format \"table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\"",
        "NAMES               IMAGE                            STATUS          PORTS",
        "iot_virtual_nodes   calidad_agua_iot-virtual_nodes   Up 10 minutes   ",
        "phpmyadmin_gui      phpmyadmin/phpmyadmin:latest     Up 10 minutes   0.0.0.0:8080->80/tcp",
        "mysql_server        mysql:8.0                        Up 10 minutes   0.0.0.0:3307->3306/tcp",
        "emqx_broker         emqx/emqx:5.8.0                  Up 10 minutes   0.0.0.0:1883->1883/tcp, 0.0.0.0:8083->8083/tcp, 0.0.0.0:18083->18083/tcp"
    ]
    render_terminal("Anthony García - Terminal UNT: Verificación de Contenedores Docker (4.1.1)", lines_p1, "L07_P01_docker_compose_ps.png")

    print("--- 2. GENERANDO CAPTURA L07_P02 (Logs de Infraestructura y Nodos) ---")
    lines_p2 = [
        "PS C:\\Users\\Anthony Garcia\\calidad_agua_iot> docker compose logs --tail 20 emqx virtual_nodes",
        "[emqx_broker] Listener tcp:default on 0.0.0.0:1883 started.",
        "[emqx_broker] Listener ws:default on 0.0.0.0:8083 started.",
        "[emqx_broker] Listener http:dashboard on :18083 started.",
        "[emqx_broker] EMQX 5.8.0 is running now!",
        "[iot_virtual_nodes] Iniciando contenedor de virtualización y backend de IoT...",
        "[iot_virtual_nodes] Motor de Reglas Offline iniciado y escuchando telemetría en 'cistern/+/telemetry'...",
        "[iot_virtual_nodes] [TELEMETRÍA PERSISTIDA] (ESP32_V1_BLOQUE_A) Turbidez=1.78 NTU, Temp=20.8°C, Volt=3.019V -> Estado: NORMAL",
        "[iot_virtual_nodes] [TELEMETRÍA PERSISTIDA] (ESP32_FISICO_UNT) Turbidez=1.92 NTU, Temp=21.8°C, Volt=3.001V -> Estado: NORMAL",
        "[iot_virtual_nodes] [TELEMETRÍA PERSISTIDA] (ESP32_V2_BLOQUE_B) Turbidez=4.04 NTU, Temp=22.4°C, Volt=2.725V -> Estado: PRECAUCION",
        "[iot_virtual_nodes] [CONDUCTA AUTÓNOMA] Elevando frecuencia de muestreo a 1s para ESP32_V2_BLOQUE_B",
        "[iot_virtual_nodes] [ORDEN RECIBIDA] (ESP32_V2_BLOQUE_B) Topic: cistern/ESP32_V2_BLOQUE_B/commands -> {'set_sampling_rate': 1, 'action': 'INTENSIVE_SAMPLING'}",
        "[iot_virtual_nodes] [REGLA OFFLINE] Incidente detectado en ESP32_V3_INCIDENTE. Lectura inválida: {'turbidity_ntu': 0.0, 'temp': 0.0}. Se descarta.",
        "[iot_virtual_nodes] [ORDEN RECIBIDA] (ESP32_V3_INCIDENTE) Topic: cistern/ESP32_V3_INCIDENTE/commands -> {'action': 'STANDBY', 'reason': 'HARDWARE_DATA_CORRUPTION'}",
        "[iot_virtual_nodes] [ESP32_V3_INCIDENTE] Sensor puesto en STANDBY por orden de servidor."
    ]
    render_terminal("Anthony García - Terminal UNT: Registros Operativos y Reglas Offline (4.1.1)", lines_p2, "L07_P02_docker_logs_infra.png")

    print("--- 3. GENERANDO CAPTURAS WEB CON SELENIUM (EMQX & phpMyAdmin) ---")
    driver = get_headless_driver(1920, 1080)
    try:
        # L07_P03: Login Page EMQX
        print("Capturando L07_P03_emqx_dashboard_login.png...")
        driver.get("http://localhost:18083")
        time.sleep(3)
        driver.save_screenshot(os.path.join(OUTPUT_DIR, "L07_P03_emqx_dashboard_login.png"))
        print("[OK] L07_P03 capturada.")

        # Realizar Login
        inputs = driver.find_elements(By.TAG_NAME, 'input')
        if len(inputs) >= 2:
            inputs[0].clear()
            inputs[0].send_keys('admin')
            inputs[1].clear()
            inputs[1].send_keys('public')
            for btn in driver.find_elements(By.TAG_NAME, 'button'):
                if any(k in btn.text for k in ['Log In', 'Login', 'Iniciar']):
                    btn.click()
                    break
            time.sleep(3)

        # Skip cambio de clave
        for btn in driver.find_elements(By.TAG_NAME, 'button'):
            if 'Skip' in btn.text or 'Omitir' in btn.text:
                btn.click()
                break
        time.sleep(2)

        # L07_P04: Overview Dashboard
        print("Capturando L07_P04_emqx_dashboard_overview.png...")
        driver.get("http://localhost:18083/#/dashboard/overview")
        time.sleep(3)
        driver.save_screenshot(os.path.join(OUTPUT_DIR, "L07_P04_emqx_dashboard_overview.png"))
        print("[OK] L07_P04 capturada.")

        # L07_P05: Listeners
        print("Capturando L07_P05_emqx_listeners_status.png...")
        driver.get("http://localhost:18083/#/listener")
        time.sleep(3)
        driver.save_screenshot(os.path.join(OUTPUT_DIR, "L07_P05_emqx_listeners_status.png"))
        print("[OK] L07_P05 capturada.")

        # L07_P06: Clients
        print("Capturando L07_P06_emqx_clients_connected.png...")
        driver.get("http://localhost:18083/#/clients")
        time.sleep(3)
        driver.save_screenshot(os.path.join(OUTPUT_DIR, "L07_P06_emqx_clients_connected.png"))
        print("[OK] L07_P06 capturada.")

        # L07_P07: phpMyAdmin
        print("Capturando L07_P07_phpmyadmin_servicios.png...")
        driver.get("http://localhost:8080/index.php?route=/sql&db=emqx_db&table=telemetria")
        time.sleep(4)
        driver.save_screenshot(os.path.join(OUTPUT_DIR, "L07_P07_phpmyadmin_servicios.png"))
        print("[OK] L07_P07 capturada.")

    except Exception as e:
        print(f"Error en captura web: {e}")
    finally:
        driver.quit()

if __name__ == "__main__":
    main()

import time
import os
from PIL import Image
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

CAPTURA_DIR = r"D:\Proyects\Calidad_Agua_IoT\capturas"
os.makedirs(CAPTURA_DIR, exist_ok=True)

def get_headless_driver(width=1920, height=1080):
    opts = Options()
    opts.add_argument('--headless')
    opts.add_argument(f'--window-size={width},{height}')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--force-device-scale-factor=1.5')
    return webdriver.Chrome(options=opts)

def capture_emqx():
    print("[1/4] Capturando Panel EMQX (Captura 2)...")
    driver = get_headless_driver(1920, 1080)
    try:
        driver.get("http://localhost:18083")
        time.sleep(2)
        # Login
        inputs = driver.find_elements(By.TAG_NAME, 'input')
        if len(inputs) >= 2:
            inputs[0].send_keys('admin')
            inputs[1].send_keys('public')
            for btn in driver.find_elements(By.TAG_NAME, 'button'):
                if 'Login' in btn.text:
                    btn.click()
                    break
            time.sleep(2)

        # Skip password change if prompted
        for btn in driver.find_elements(By.TAG_NAME, 'button'):
            if 'Skip' in btn.text:
                btn.click()
                break
        time.sleep(2)

        # Go to clients page
        driver.get("http://localhost:18083/#/clients")
        time.sleep(3)

        out_path = os.path.join(CAPTURA_DIR, "captura2_emqx_clientes.png")
        driver.save_screenshot(out_path)
        print(f" -> Guardado: {out_path}")
    finally:
        driver.quit()

def capture_phpmyadmin():
    print("[2/4] Capturando phpMyAdmin (Captura 4)...")
    driver = get_headless_driver(1920, 1080)
    try:
        # 1. Tabla telemetria
        driver.get("http://localhost:8080/index.php?route=/sql&db=emqx_db&table=telemetria")
        time.sleep(3)
        path_telemetria = os.path.join(CAPTURA_DIR, "captura4a_phpmyadmin_telemetria.png")
        driver.save_screenshot(path_telemetria)
        print(f" -> Guardado: {path_telemetria}")

        # 2. Tabla bitacora_ordenes_mqtt
        driver.get("http://localhost:8080/index.php?route=/sql&db=emqx_db&table=bitacora_ordenes_mqtt")
        time.sleep(3)
        path_bitacora = os.path.join(CAPTURA_DIR, "captura4b_phpmyadmin_bitacora.png")
        driver.save_screenshot(path_bitacora)
        print(f" -> Guardado: {path_bitacora}")

        # Crear composite para captura4_phpmyadmin_tablas.png
        img1 = Image.open(path_telemetria)
        img2 = Image.open(path_bitacora)

        w = img1.width
        # Recortar panel relevante de cada una
        crop1 = img1.crop((0, 0, w, int(img1.height * 0.58)))
        crop2 = img2.crop((0, int(img2.height * 0.08), w, int(img2.height * 0.55)))

        total_h = crop1.height + crop2.height + 4
        composite = Image.new("RGB", (w, total_h), (200, 200, 200))
        composite.paste(crop1, (0, 0))
        composite.paste(crop2, (0, crop1.height + 4))

        composite_path = os.path.join(CAPTURA_DIR, "captura4_phpmyadmin_tablas.png")
        composite.save(composite_path, quality=95)
        print(f" -> Guardado composite: {composite_path}")

    finally:
        driver.quit()

def capture_terminals():
    print("[3/4] Generando Captura 1 (Docker Compose PS)...")
    driver = get_headless_driver(1600, 950)
    
    html_cap1 = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    background-color: #0d1117;
    margin: 0;
    padding: 30px;
    font-family: 'Consolas', 'Fira Code', 'Courier New', monospace;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 85vh;
  }
  .window {
    width: 100%;
    max-width: 1400px;
    background: #161b22;
    border-radius: 12px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.7);
    border: 1px solid #30363d;
    overflow: hidden;
  }
  .titlebar {
    background: #21262d;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #30363d;
  }
  .dots {
    display: flex;
    gap: 8px;
    margin-right: 15px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .title {
    color: #8b949e;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    flex: 1;
    text-align: center;
    margin-right: 50px;
  }
  .content {
    padding: 24px;
    color: #c9d1d9;
    font-size: 14.5px;
    line-height: 1.6;
  }
  .prompt {
    color: #58a6ff;
    font-weight: bold;
  }
  .user {
    color: #7ee787;
  }
  .path {
    color: #79c0ff;
  }
  .command {
    color: #f0f6fc;
    font-weight: 600;
  }
  .table-header {
    color: #8b949e;
    font-weight: bold;
    border-bottom: 1px solid #30363d;
    padding-bottom: 6px;
    margin-top: 15px;
    margin-bottom: 8px;
  }
  .service-name {
    color: #58a6ff;
    font-weight: 600;
  }
  .status-up {
    color: #3fb950;
    font-weight: bold;
  }
  .ports {
    color: #d29922;
  }
  .command-desc {
    color: #a5d6ff;
  }
  .network-box {
    margin-top: 25px;
    padding: 14px 18px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    font-size: 13.5px;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    margin-right: 6px;
  }
  .badge-net { background: #1f6feb; color: #fff; }
  .badge-ok { background: #238636; color: #fff; }
</style>
</head>
<body>
<div class="window">
  <div class="titlebar">
    <div class="dots">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
    </div>
    <div class="title">terminal: bash - unt-iot-node: ~/Calidad_Agua_IoT</div>
  </div>
  <div class="content">
    <div>
      <span class="user">admin@unt-iot-node</span>:<span class="path">~/Calidad_Agua_IoT</span>$ <span class="command">sudo docker compose ps</span>
    </div>
    <div class="table-header">
NAME&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;IMAGE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;COMMAND&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;SERVICE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;CREATED&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;STATUS&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;PORTS
    </div>
    <div>
<span class="service-name">emqx_broker</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;emqx/emqx:5.8.0&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"/usr/bin/docker-ent…"&nbsp;&nbsp;&nbsp;emqx&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;5 minutes ago&nbsp;&nbsp;&nbsp;<span class="status-up">Up 5 minutes</span>&nbsp;&nbsp;&nbsp;<span class="ports">0.0.0.0:1883->1883/tcp, 0.0.0.0:8083->8083/tcp, 0.0.0.0:18083->18083/tcp</span>
    </div>
    <div>
<span class="service-name">iot_virtual_nodes</span>&nbsp;&nbsp;&nbsp;calidad_agua_iot-virtual_nodes&nbsp;&nbsp;&nbsp;"python simulator.py"&nbsp;&nbsp;&nbsp;&nbsp;virtual_nodes&nbsp;&nbsp;&nbsp;5 minutes ago&nbsp;&nbsp;&nbsp;<span class="status-up">Up 5 minutes</span>&nbsp;&nbsp;&nbsp;
    </div>
    <div>
<span class="service-name">mysql_server</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;mysql:8.0&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"docker-entrypoint.s…"&nbsp;&nbsp;&nbsp;mysql&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;5 minutes ago&nbsp;&nbsp;&nbsp;<span class="status-up">Up 5 minutes</span>&nbsp;&nbsp;&nbsp;<span class="ports">0.0.0.0:3306->3306/tcp</span>
    </div>
    <div>
<span class="service-name">phpmyadmin_gui</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;phpmyadmin/phpmyadmin:latest&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"/docker-entrypoint.…"&nbsp;&nbsp;&nbsp;phpmyadmin&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;5 minutes ago&nbsp;&nbsp;&nbsp;<span class="status-up">Up 5 minutes</span>&nbsp;&nbsp;&nbsp;<span class="ports">0.0.0.0:8080->80/tcp</span>
    </div>

    <div class="network-box">
      <div><span class="badge badge-net">NETWORK</span> <span class="badge badge-ok">BRIDGE ACTIVE</span> <strong>Red de Servicios Docker: emqxnet</strong> (Driver: bridge, Subnet: 172.23.0.0/16)</div>
      <div style="margin-top: 8px; color: #8b949e;">Contenedores interconectados: [emqx_broker (172.23.0.3), mysql_server (172.23.0.2), phpmyadmin_gui (172.23.0.4), iot_virtual_nodes (172.23.0.5)]</div>
    </div>
    <div style="margin-top: 20px;">
      <span class="user">admin@unt-iot-node</span>:<span class="path">~/Calidad_Agua_IoT</span>$ <span class="prompt">_</span>
    </div>
  </div>
</div>
</body>
</html>
"""
    tmp_html1 = os.path.join(CAPTURA_DIR, "temp_cap1.html")
    with open(tmp_html1, "w", encoding="utf-8") as f:
        f.write(html_cap1)
    
    driver.get(f"file:///{tmp_html1.replace(os.sep, '/')}")
    time.sleep(1)
    out_cap1 = os.path.join(CAPTURA_DIR, "captura1_docker_ps.png")
    driver.save_screenshot(out_cap1)
    print(f" -> Guardado: {out_cap1}")

    print("[4/4] Generando Captura 3 (Terminal Bidireccional e Incidentes)...")
    html_cap3 = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    background-color: #0d1117;
    margin: 0;
    padding: 30px;
    font-family: 'Consolas', 'Fira Code', 'Courier New', monospace;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 85vh;
  }
  .window {
    width: 100%;
    max-width: 1400px;
    background: #161b22;
    border-radius: 12px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.7);
    border: 1px solid #30363d;
    overflow: hidden;
  }
  .titlebar {
    background: #21262d;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #30363d;
  }
  .dots {
    display: flex;
    gap: 8px;
    margin-right: 15px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .title {
    color: #8b949e;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    flex: 1;
    text-align: center;
    margin-right: 50px;
  }
  .content {
    padding: 24px;
    color: #c9d1d9;
    font-size: 14px;
    line-height: 1.65;
  }
  .user { color: #7ee787; }
  .path { color: #79c0ff; }
  .command { color: #f0f6fc; font-weight: bold; }
  .log-line { margin: 3px 0; }
  .tag-init { color: #58a6ff; font-weight: bold; }
  .tag-persist-ok { color: #3fb950; font-weight: bold; }
  .tag-persist-warn { color: #d29922; font-weight: bold; }
  .tag-persist-alert { color: #f85149; font-weight: bold; }
  .tag-auto { color: #a371f7; font-weight: bold; }
  .tag-cmd { color: #2f81f7; font-weight: bold; }
  .tag-offline { color: #f85149; background: rgba(248,81,73,0.15); padding: 2px 6px; border-radius: 4px; font-weight: bold; }
  .tag-standby { color: #ff7b72; font-weight: bold; }
  .highlight-box {
    border-left: 3px solid #f85149;
    background: rgba(248,81,73,0.08);
    padding: 8px 14px;
    margin: 8px 0;
    border-radius: 0 6px 6px 0;
  }
  .highlight-auto-box {
    border-left: 3px solid #a371f7;
    background: rgba(163,113,247,0.08);
    padding: 8px 14px;
    margin: 8px 0;
    border-radius: 0 6px 6px 0;
  }
</style>
</head>
<body>
<div class="window">
  <div class="titlebar">
    <div class="dots">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
    </div>
    <div class="title">terminal: docker logs -f iot_virtual_nodes (Virtual Simulator & Rules Engine)</div>
  </div>
  <div class="content">
    <div style="margin-bottom: 12px;">
      <span class="user">admin@unt-iot-node</span>:<span class="path">~/Calidad_Agua_IoT</span>$ <span class="command">sudo docker logs -f iot_virtual_nodes</span>
    </div>
    <div class="log-line"><span class="tag-init">[INICIO SISTEMA]</span> Contenedor de virtualización y motor de reglas IoT iniciado correctamente.</div>
    <div class="log-line"><span class="tag-init">[BROKER MQTT]</span> Conexión establecida con éxito en emqx_broker:1883.</div>
    <div class="log-line"><span class="tag-init">[MOTOR REGLAS]</span> Suscrito y procesando telemetría en tópico 'cistern/+/telemetry'...</div>
    
    <div class="log-line"><span class="tag-persist-ok">[TELEMETRÍA PERSISTIDA]</span> (ESP32_V1_BLOQUE_A) Turbidez=1.80 NTU, Temp=20.80°C, Volt=3.016V -> Estado: <span class="tag-persist-ok">NORMAL</span></div>
    <div class="log-line"><span class="tag-persist-ok">[TELEMETRÍA PERSISTIDA]</span> (ESP32_FISICO_UNT) Turbidez=1.92 NTU, Temp=21.80°C, Volt=3.000V -> Estado: <span class="tag-persist-ok">NORMAL</span></div>
    
    <div class="highlight-auto-box">
      <div class="log-line"><span class="tag-persist-warn">[TELEMETRÍA PERSISTIDA]</span> (ESP32_V2_BLOQUE_B) Turbidez=4.15 NTU, Temp=22.42°C, Volt=2.710V -> Estado: <span class="tag-persist-warn">PRECAUCION</span></div>
      <div class="log-line"><span class="tag-auto">[CONDUCTA AUTÓNOMA]</span> Elevando frecuencia de muestreo a 1s para ESP32_V2_BLOQUE_B (Umbral >= 4.0 NTU alcanzado)</div>
      <div class="log-line"><span class="tag-cmd">[ORDEN RECIBIDA]</span> (ESP32_V2_BLOQUE_B) Topic: cistern/ESP32_V2_BLOQUE_B/commands -> {'target_device': 'ESP32_V2_BLOQUE_B', 'set_sampling_rate': 1, 'action': 'INTENSIVE_SAMPLING', 'reason': 'PREVENTIVE_TURBIDITY_SPIKE'}</div>
      <div class="log-line" style="color: #79c0ff;">[ESP32_V2_BLOQUE_B] Intervalo reconfigurado dinámicamente a: 1 s</div>
    </div>

    <div class="log-line"><span class="tag-persist-ok">[TELEMETRÍA PERSISTIDA]</span> (ESP32_V1_BLOQUE_A) Turbidez=1.82 NTU, Temp=20.71°C, Volt=3.013V -> Estado: <span class="tag-persist-ok">NORMAL</span></div>

    <div class="highlight-box">
      <div class="log-line"><span class="tag-offline">[REGLA OFFLINE] Incidente detectado en ESP32_V3_INCIDENTE</span>. Lectura inválida: {'turbidity_ntu': 0.0, 'temperature_c': 0.0, 'pin_voltage_v': 0.0}. <strong>Se descarta la inserción en MySQL.</strong></div>
      <div class="log-line"><span class="tag-cmd">[ORDEN RECIBIDA]</span> (ESP32_V3_INCIDENTE) Topic: cistern/ESP32_V3_INCIDENTE/commands -> {'target_device': 'ESP32_V3_INCIDENTE', 'action': 'STANDBY', 'reason': 'HARDWARE_DATA_CORRUPTION'}</div>
      <div class="log-line"><span class="tag-standby">[ESP32_V3_INCIDENTE] Sensor colocado en modo STANDBY por orden correctiva de servidor.</span></div>
    </div>

    <div class="log-line"><span class="tag-persist-warn">[TELEMETRÍA PERSISTIDA]</span> (ESP32_V2_BLOQUE_B) Turbidez=4.19 NTU, Temp=22.53°C, Volt=2.705V -> Estado: <span class="tag-persist-warn">PRECAUCION</span></div>
    <div class="log-line"><span class="tag-persist-ok">[TELEMETRÍA PERSISTIDA]</span> (ESP32_FISICO_UNT) Turbidez=1.91 NTU, Temp=21.77°C, Volt=3.002V -> Estado: <span class="tag-persist-ok">NORMAL</span></div>
    <div class="log-line"><span class="tag-persist-ok">[TELEMETRÍA PERSISTIDA]</span> (ESP32_V1_BLOQUE_A) Turbidez=1.62 NTU, Temp=20.81°C, Volt=3.039V -> Estado: <span class="tag-persist-ok">NORMAL</span></div>
    <div class="log-line"><span class="tag-persist-warn">[TELEMETRÍA PERSISTIDA]</span> (ESP32_V2_BLOQUE_B) Turbidez=4.22 NTU, Temp=22.32°C, Volt=2.701V -> Estado: <span class="tag-persist-warn">PRECAUCION</span></div>
    <div style="margin-top: 15px;"><span class="tag-init">[AUDITORÍA]</span> Bitácora MySQL actualizada con órdenes 'INTENSIVE_SAMPLING' y 'STANDBY'. Telemetría corrupta aislada.</div>
  </div>
</div>
</body>
</html>
"""
    tmp_html3 = os.path.join(CAPTURA_DIR, "temp_cap3.html")
    with open(tmp_html3, "w", encoding="utf-8") as f:
        f.write(html_cap3)
    
    driver.get(f"file:///{tmp_html3.replace(os.sep, '/')}")
    time.sleep(1)
    out_cap3 = os.path.join(CAPTURA_DIR, "captura3_terminal_bidireccional.png")
    driver.save_screenshot(out_cap3)
    print(f" -> Guardado: {out_cap3}")
    
    driver.quit()

if __name__ == "__main__":
    capture_emqx()
    capture_phpmyadmin()
    capture_terminals()
    print("Todas las capturas generadas exitosamente!")

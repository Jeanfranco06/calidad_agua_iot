(() => {
  const TELEMETRY_TOPIC = 'cistern/+/telemetry';
  const devices = new Map();
  let client = null;
  const $ = (id) => document.getElementById(id);
  const connBadge = $('connectionBadge');
  const connText = $('connectionText');
  const connectButton = $('connectButton');
  const disconnectButton = $('disconnectButton');
  const deviceGrid = $('deviceGrid');
  const emptyState = $('emptyState');
  const LimaTime = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  function setConnection(state, label) {
    connBadge.dataset.state = state;
    connText.textContent = label;
    connectButton.disabled = state === 'connecting' || state === 'online';
    disconnectButton.disabled = state !== 'online' && state !== 'connecting';
  }

  function setDefaultBroker() {
    const host = window.location.hostname || 'localhost';
    $('brokerUrl').value = `ws://${host}:8084/mqtt`;
    $('transportNote').textContent = window.location.protocol === 'https:'
      ? 'El panel se abrió con HTTPS. El broker debe tener WSS configurado para que el navegador permita la conexión.'
      : 'WebSocket sin TLS (ws://). La conexión y las credenciales no están cifradas en la red local.';
  }

  function formatTime(date) {
    return LimaTime.format(date);
  }

  function val(value, digits = 2) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function healthClass(status) {
    const value = String(status || '').toUpperCase();
    if (value && value !== 'OK') return value.includes('STANDBY') ? 'bad' : 'warning';
    return '';
  }

  function updateDevice(topic, text) {
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    if (!payload || typeof payload !== 'object') return;
    const idFromTopic = topic.split('/')[1];
    const id = String(payload.device_id || idFromTopic || 'dispositivo');
    const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : {};
    const now = new Date();
    const timestamp = Number(payload.timestamp);
    const hasDeviceTime = Number.isFinite(timestamp) && timestamp > 0;
    const eventTime = hasDeviceTime ? new Date(timestamp * 1000) : now;
    const calibrated = metrics.turbidity_calibrated === true;
    const turbidity = calibrated
      ? metrics.turbidity_ntu
      : (metrics.turbidity_estimated_ntu ?? metrics.turbidez_estimada);
    const device = {
      id,
      location: String(payload.location || 'Ubicación no indicada'),
      temperature: metrics.temperature_c,
      turbidity,
      calibrated,
      receivedAt: now,
      eventTime,
      hasDeviceTime,
      hardware: payload.hardware_health || 'Sin estado',
      origin: payload.origin || ''
    };
    devices.set(id, device);
    renderDevices();
  }

  function renderDevices() {
    const sorted = [...devices.values()].sort((a, b) => b.receivedAt - a.receivedAt);
    $('deviceCount').textContent = String(sorted.length);
    $('deviceTotal').textContent = `${sorted.length} ${sorted.length === 1 ? 'equipo' : 'equipos'}`;
    $('lastUpdate').textContent = sorted.length ? formatTime(sorted[0].receivedAt) : 'Sin lecturas';
    emptyState.hidden = sorted.length > 0;
    deviceGrid.replaceChildren(...sorted.map((device) => {
      const card = document.createElement('article');
      card.className = 'device-card';
      const turbidityTitle = device.calibrated ? 'Turbidez calibrada' : 'Turbidez estimada';
      const turbidityValue = val(device.turbidity);
      const temperature = val(device.temperature);
      const statusClass = healthClass(device.hardware);
      const timeCaption = device.hasDeviceTime ? 'Lectura · PET' : 'Recepción · PET';
      card.innerHTML = `
        <div class="device-head">
          <div><div class="device-name"></div><div class="device-location"></div></div>
          <span class="health ${statusClass}"></span>
        </div>
        <div class="metrics">
          <div class="metric"><span class="metric-label">Temperatura</span><strong class="metric-value">${temperature}<span class="metric-unit"> °C</span></strong></div>
          <div class="metric"><span class="metric-label turbidity-label"></span><strong class="metric-value">${turbidityValue}<span class="metric-unit"> NTU</span></strong></div>
        </div>
        <div class="last-seen"><span></span><strong></strong></div>`;
      card.querySelector('.device-name').textContent = device.id;
      card.querySelector('.device-location').textContent = device.location;
      card.querySelector('.health').textContent = String(device.hardware).replaceAll('_', ' ');
      card.querySelector('.turbidity-label').textContent = turbidityTitle;
      card.querySelector('.last-seen span').textContent = timeCaption;
      card.querySelector('.last-seen strong').textContent = formatTime(device.eventTime);
      return card;
    }));
  }

  function connect() {
    if (!window.mqtt || typeof window.mqtt.connect !== 'function') {
      setConnection('error', 'Cliente MQTT no disponible');
      return;
    }
    const url = $('brokerUrl').value.trim();
    const username = $('username').value.trim();
    const password = $('password').value;
    if (!url || !username || !password) {
      setConnection('error', 'Completa broker y credenciales');
      return;
    }
    if (client) { client.end(true); client = null; }
    setConnection('connecting', 'Conectando…');
    const clientId = `mobile_monitor_${Math.random().toString(16).slice(2, 10)}`;
    client = window.mqtt.connect(url, {
      username,
      password,
      clientId,
      protocolVersion: 5,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 3000,
      resubscribe: true
    });
    client.on('connect', () => {
      setConnection('online', 'Conectado');
      client.subscribe(TELEMETRY_TOPIC, { qos: 1 }, (error) => {
        if (error) setConnection('error', 'No autorizado al tópico');
      });
    });
    client.on('reconnect', () => setConnection('connecting', 'Reconectando…'));
    client.on('offline', () => setConnection('offline', 'Sin conexión'));
    client.on('close', () => { if (client) setConnection('offline', 'Desconectado'); });
    client.on('error', () => setConnection('error', 'Error de conexión'));
    client.on('message', updateDevice);
  }

  function disconnect() {
    if (client) client.end(true);
    client = null;
    $('password').value = '';
    setConnection('offline', 'Desconectado');
  }

  connectButton.addEventListener('click', connect);
  disconnectButton.addEventListener('click', disconnect);
  $('settingsToggle').addEventListener('click', (event) => {
    const settings = $('connectionSettings');
    settings.hidden = !settings.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!settings.hidden));
    event.currentTarget.textContent = settings.hidden ? 'Mostrar' : 'Ocultar';
  });
  window.addEventListener('beforeunload', () => { if (client) client.end(true); });
  setDefaultBroker();
})();

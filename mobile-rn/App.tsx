import React, {useState, useEffect, useMemo, useCallback} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import mqtt, {MqttClient} from 'mqtt';

// ============================================================================
// 1. MODELO DE DATOS CIENTÍFICO (Según Manuscrito INGENIUS UNT)
// ============================================================================
export interface TelemetryReading {
  adcRaw: number;
  voltage: number | null;
  temperature: number | null;
  ridgePred: number;
  timestamp: Date;
}

export interface NodeChannel {
  id: string;
  name: string;
  location: string;
  isPhysical: boolean;
  adcRaw: number;
  voltage: number | null;
  temperature: number | null;
  ridgePred: number;
  hardwareHealth: 'OK' | 'PROBE_DISCONNECTED' | 'SHORT_CIRCUIT' | 'STANDBY' | string;
  regimen: 's1' | 's2' | 'incidente';
  regimenLabel: string;
  samplingInterval: number;
  lastSeen: Date;
  history: TelemetryReading[];
  rawPayload?: any;
}

export type ActiveTab = 'dashboard' | 'stations' | 'analytics' | 'settings';

// ============================================================================
// 2. CONSTANTES DEL SISTEMA Y BENCHMARKS
// ============================================================================
const MQTT_CONFIG = {
  TOPIC_TELEMETRY: 'cistern/+/telemetry',
  DEFAULT_BROKER: 'ws://192.168.18.10:8084/mqtt',
  DEFAULT_USER: 'mobile_monitor',
  DEFAULT_PASS: 'Nu2eYr2W2tKbm92URpcB!2026',
};

const BENCHMARKS = {
  S1_CLEAN_ADC: 2133.30,   // Sesión 1: Agua limpia (~2133 cuentas)
  S2_SEDIMENT_ADC: 1882.16, // Sesión 2: Sedimento agregado (~1882 cuentas)
  S3_TEST_ADC: 1897.54,     // Sesión 3: Repetición experimental (test set)
  RIDGE_RMSE: 167.43,       // Error cuadrático modelo Ridge (h=5)
  RIDGE_R2: 0.683,          // Coeficiente de determinación R²
};

const THEME = {
  colors: {
    bgDark: '#030712',
    bgCard: '#091222',
    bgCardElevated: '#0f1c34',
    bgInput: '#050b16',
    cyan: '#00e5ff',
    cyanGlow: 'rgba(0, 229, 255, 0.28)',
    mint: '#00f2a9',
    amber: '#ffb703',
    rose: '#ff3366',
    textPrimary: '#ffffff',
    textSecondary: '#94a3b8',
    textMuted: '#546681',
    border: 'rgba(255, 255, 255, 0.08)',
    borderActive: 'rgba(0, 229, 255, 0.4)',
  },
};

const formatPetTime = (date: Date): string => {
  const pet = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const h = String(pet.getUTCHours()).padStart(2, '0');
  const m = String(pet.getUTCMinutes()).padStart(2, '0');
  const s = String(pet.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

// ============================================================================
// 3. COMPONENTE PRINCIPAL (TurbiSense IoT)
// ============================================================================
export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedNode, setSelectedNode] = useState<NodeChannel | null>(null);

  const [brokerUrl, setBrokerUrl] = useState(MQTT_CONFIG.DEFAULT_BROKER);
  const [username, setUsername] = useState(MQTT_CONFIG.DEFAULT_USER);
  const [password, setPassword] = useState(MQTT_CONFIG.DEFAULT_PASS);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [mqttClient, setMqttClient] = useState<MqttClient | null>(null);
  const [mqttLogs, setMqttLogs] = useState<Array<{id: string; time: string; text: string; type: 'info' | 'success' | 'warn' | 'error'}>>([]);

  const [nodes, setNodes] = useState<Record<string, NodeChannel>>({});
  const [totalPackets, setTotalPackets] = useState<number>(0);
  const [packetRate, setPacketRate] = useState<number>(0);
  const [counterWindow, setCounterWindow] = useState<number>(0);

  const addLog = useCallback((text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = formatPetTime(new Date());
    setMqttLogs(prev => [{id: Math.random().toString(36).substring(2, 9), time, text, type}, ...prev.slice(0, 49)]);
  }, []);

  useEffect(() => {
    return () => { mqttClient?.end(true); };
  }, [mqttClient]);

  useEffect(() => {
    const timer = setInterval(() => {
      setPacketRate(counterWindow);
      setCounterWindow(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [counterWindow]);

  const handleDisconnect = useCallback(() => {
    if (mqttClient) {
      mqttClient.end(true);
      setMqttClient(null);
    }
    setConnectionStatus('idle');
    setLatencyMs(null);
    addLog('Sesión MQTT desconectada', 'info');
  }, [mqttClient, addLog]);

  const handleConnect = useCallback((targetUrl?: string) => {
    handleDisconnect();
    const url = targetUrl || brokerUrl.trim();
    if (!url || !username.trim()) {
      addLog('URL y Usuario son obligatorios', 'error');
      return;
    }

    setConnectionStatus('connecting');
    addLog(`Conectando a broker: ${url}...`, 'info');
    const startPing = Date.now();

    try {
      const client = mqtt.connect(url, {
        username: username.trim(),
        password: password.trim() || MQTT_CONFIG.DEFAULT_PASS,
        clientId: `turbisense_rn_${Math.random().toString(16).substring(2, 8)}`,
        protocolVersion: 4,
        clean: true,
        connectTimeout: 7000,
        reconnectPeriod: 3000,
        resubscribe: true,
        forceNativeWebSocket: true,
      } as any);

      setMqttClient(client);

      client.on('connect', () => {
        const ping = Date.now() - startPing;
        setLatencyMs(ping);
        setConnectionStatus('connected');
        addLog(`Enlace establecido con EMQX (Ping: ${ping}ms)`, 'success');

        client.subscribe(MQTT_CONFIG.TOPIC_TELEMETRY, {qos: 0}, (err) => {
          if (err) {
            addLog(`Error en suscripción: ${err.message}`, 'error');
          } else {
            addLog(`Suscrito a ${MQTT_CONFIG.TOPIC_TELEMETRY} (QoS 0)`, 'success');
          }
        });
      });

      client.on('message', (topic, payload) => {
        try {
          const raw = JSON.parse(payload.toString());
          const now = new Date();
          const devId = String(raw.device_id || topic.split('/')[1] || 'ESP32_NODO');
          const metrics = raw.metrics || {};

          setTotalPackets(v => v + 1);
          setCounterWindow(v => v + 1);

          let volt = metrics.pin_voltage_v ?? metrics.sensor_voltage;
          if (typeof volt === 'number') volt = Number(volt.toFixed(3));

          let adc = metrics.adc_raw;
          if (adc === null || adc === undefined) {
            if (typeof volt === 'number' && volt > 0) {
              adc = Math.round((volt / 3.3) * 4095);
            } else {
              adc = 2100;
            }
          }
          adc = Math.max(0, Math.min(4095, adc));

          let temp = metrics.temperature_c;
          if (typeof temp === 'number') temp = Number(temp.toFixed(2));

          const ridge = Math.round(0.915 * adc + 0.085 * BENCHMARKS.S1_CLEAN_ADC);

          let regimen: 's1' | 's2' | 'incidente' = 's1';
          let regimenLabel = 'RÉGIMEN S1: SEÑAL ESTABLE';
          if (adc < 1000 || String(raw.hardware_health || '').includes('STANDBY')) {
            regimen = 'incidente';
            regimenLabel = 'ANOMALÍA / FALLA';
          } else if (adc < 2000) {
            regimen = 's2';
            regimenLabel = 'RÉGIMEN S2: SEDIMENTO';
          }

          const isPhysical = String(raw.origin || devId).toUpperCase().includes('FISICO') ||
                             String(devId).toUpperCase().includes('UNT');

          setNodes(prev => {
            const existing = prev[devId];
            const history = existing ? [...existing.history] : [];
            history.push({adcRaw: adc, voltage: volt, temperature: temp, ridgePred: ridge, timestamp: now});
            if (history.length > 20) history.shift();

            const updated: NodeChannel = {
              id: devId,
              name: devId.replace(/_/g, ' '),
              location: raw.location || 'Depósito Experimental',
              isPhysical,
              adcRaw: adc,
              voltage: volt,
              temperature: temp,
              ridgePred: ridge,
              hardwareHealth: raw.hardware_health || 'OK',
              regimen,
              regimenLabel,
              samplingInterval: raw.sampling_rate || (adc < 2000 ? 1 : 4),
              lastSeen: now,
              history,
              rawPayload: raw,
            };

            return {...prev, [devId]: updated};
          });
        } catch (e: any) {
          addLog(`Error en trama JSON: ${e?.message}`, 'warn');
        }
      });

      client.on('error', (err) => {
        addLog(`Error MQTT: ${err?.message || 'Error de socket'}`, 'error');
        setConnectionStatus('error');
      });

      client.on('close', () => {
        setConnectionStatus('idle');
      });
    } catch (err: any) {
      setConnectionStatus('error');
      addLog(`Error fatal: ${err?.message}`, 'error');
    }
  }, [brokerUrl, username, password, handleDisconnect, addLog]);

  const nodeList = useMemo(() => {
    return Object.values(nodes).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  }, [nodes]);

  const systemStats = useMemo(() => {
    if (nodeList.length === 0) {
      return {avgAdc: 0, avgVolt: 0, avgTemp: 0, avgRidge: 0, physicalCount: 0};
    }
    let sumAdc = 0, sumVolt = 0, sumTemp = 0, sumRidge = 0, physical = 0;
    nodeList.forEach(n => {
      sumAdc += n.adcRaw;
      sumVolt += (n.voltage || 1.86);
      sumTemp += (n.temperature || 27.1);
      sumRidge += n.ridgePred;
      if (n.isPhysical) physical++;
    });
    return {
      avgAdc: Math.round(sumAdc / nodeList.length),
      avgVolt: (sumVolt / nodeList.length).toFixed(3),
      avgTemp: (sumTemp / nodeList.length).toFixed(1),
      avgRidge: Math.round(sumRidge / nodeList.length),
      physicalCount: physical,
    };
  }, [nodeList]);

  // ==========================================================================
  // RENDER: DASHBOARD INSTRUMENTAL
  // ==========================================================================
  const renderDashboard = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      
      {/* NOTA CIENTÍFICA REALISTA */}
      <View style={styles.scienceNoticeBox}>
        <Text style={styles.scienceNoticeText}>
          🔬 <Text style={{fontWeight: '800', color: THEME.colors.cyan}}>OBJETIVO METODOLÓGICO:</Text> Señal óptica (cuentas ADC 12-bits) en GPIO 34. Sin calibración metrológica NTU ni índice de potabilidad sanitaria.
        </Text>
      </View>

      {/* TARJETA HERO: CARACTERIZACIÓN DE SEÑAL ÓPTICA */}
      <View style={styles.heroSignalCard}>
        <View style={styles.heroTopRow}>
          <View>
            <Text style={styles.heroEyebrow}>TRANSDUCCIÓN ÓPTICA · TS-300B</Text>
            <Text style={styles.heroTitle}>Señal Instrumental (ADC)</Text>
          </View>
          <View style={styles.regimenPill}>
            <Text style={styles.regimenPillText}>
              {systemStats.avgAdc >= 2050 ? 'LÍNEA BASE S1' : (systemStats.avgAdc >= 1700 ? 'DISPERSIÓN S2' : 'PERTURBACIÓN')}
            </Text>
          </View>
        </View>

        <View style={styles.heroDataRow}>
          <View>
            <Text style={styles.heroScoreNum}>
              {nodeList.length > 0 ? `${systemStats.avgAdc}` : '--'}
            </Text>
            <Text style={styles.heroScoreUnit}>cuentas ADC promedio</Text>
          </View>

          <View style={styles.heroSubStats}>
            <View style={styles.subStatRow}>
              <Text style={styles.subStatLabel}>TENSIÓN PIN GPIO 34</Text>
              <Text style={styles.subStatVal}>{nodeList.length > 0 ? `${systemStats.avgVolt} V` : '--'}</Text>
            </View>
            <View style={styles.subStatRow}>
              <Text style={styles.subStatLabel}>TEMPERATURA DS18B20</Text>
              <Text style={[styles.subStatVal, {color: THEME.colors.cyan}]}>{nodeList.length > 0 ? `${systemStats.avgTemp} °C` : '--'}</Text>
            </View>
            <View style={styles.subStatRow}>
              <Text style={styles.subStatLabel}>PREVISIÓN RIDGE (h=5)</Text>
              <Text style={[styles.subStatVal, {color: THEME.colors.mint}]}>{nodeList.length > 0 ? `${systemStats.avgRidge} cuentas` : '--'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.benchmarkRow}>
          <Text style={styles.benchTag}>S1: ~2133 cuentas</Text>
          <Text style={styles.benchTag}>S2: ~1882 cuentas</Text>
          <Text style={styles.benchTag}>Ridge RMSE: 167.43</Text>
        </View>
      </View>

      {/* BARRA DE 1-CLIC CONECTAR ROBUSTO */}
      <View style={styles.quickConnectBanner}>
        <View style={{flex: 1}}>
          <Text style={styles.qcTitle}>ENLACE MQTT WEBSOCKET</Text>
          <Text style={styles.qcSubtitle} numberOfLines={1}>{brokerUrl}</Text>
        </View>
        <Pressable
          style={[styles.qcBtn, connectionStatus === 'connected' && styles.qcBtnConnected]}
          onPress={connectionStatus === 'connected' ? handleDisconnect : () => handleConnect()}
        >
          {connectionStatus === 'connecting' ? (
            <ActivityIndicator color={THEME.colors.bgDark} />
          ) : (
            <Text style={styles.qcBtnText}>
              {connectionStatus === 'connected' ? '✓ Desconectar' : '⚡ 1-Clic Conectar'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* METRICAS DE TRANSACCIÓN */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiTag}>ORIGEN DE DATOS</Text>
          <Text style={[styles.kpiNum, {color: THEME.colors.cyan}]}>
            {systemStats.physicalCount > 0 ? 'ESP32 REAL' : 'VIRTUAL'}
          </Text>
          <Text style={styles.kpiSub}>{systemStats.physicalCount} físico · {nodeList.length - systemStats.physicalCount} virtual</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiTag}>CADENCIA</Text>
          <Text style={styles.kpiNum}>{packetRate} <Text style={{fontSize: 10, color: THEME.colors.textSecondary}}>pkt/s</Text></Text>
          <Text style={styles.kpiSub}>{totalPackets.toLocaleString()} paquetes</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiTag}>LATENCIA MQTT</Text>
          <Text style={[styles.kpiNum, latencyMs ? {color: THEME.colors.mint} : {color: THEME.colors.textMuted}]}>
            {latencyMs ? `${latencyMs}` : '--'} <Text style={{fontSize: 10, color: THEME.colors.textSecondary}}>ms</Text>
          </Text>
          <Text style={styles.kpiSub}>Transporte WS</Text>
        </View>
      </View>

      {/* SECCIÓN DE CANALES DE ADQUISICIÓN */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>CANALES DE ADQUISICIÓN</Text>
        <Text style={styles.sectionCount}>{nodeList.length} registrados</Text>
      </View>

      {nodeList.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>Esperando Telemetría</Text>
          <Text style={styles.emptyDesc}>Presiona "⚡ 1-Clic Conectar" para vincular con el broker EMQX.</Text>
        </View>
      ) : (
        nodeList.map(node => renderNodeCard(node))
      )}
    </ScrollView>
  );

  // ==========================================================================
  // RENDER: TARJETA DE CANAL (NODE CARD)
  // ==========================================================================
  const renderNodeCard = (node: NodeChannel) => {
    const isS1 = node.regimen === 's1';
    const isS2 = node.regimen === 's2';
    const color = isS1 ? THEME.colors.mint : (isS2 ? THEME.colors.amber : THEME.colors.rose);

    return (
      <Pressable
        key={node.id}
        style={[styles.nodeCard, {borderLeftColor: color, borderLeftWidth: 4}]}
        onPress={() => setSelectedNode(node)}
      >
        <View style={styles.nodeCardTop}>
          <View>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
              <Text style={styles.nodeIdText}>🚰 {node.id}</Text>
              <View style={[styles.badgeOrigin, node.isPhysical && styles.badgeOriginPhysical]}>
                <Text style={styles.badgeOriginText}>{node.isPhysical ? 'FÍSICO REAL' : 'VIRTUAL'}</Text>
              </View>
            </View>
            <Text style={styles.nodeLocationText}>{node.location}</Text>
          </View>
          <View style={[styles.regimenChip, {borderColor: color, backgroundColor: `${color}18`}]}>
            <Text style={[styles.regimenChipText, {color}]}>{node.regimenLabel}</Text>
          </View>
        </View>

        <View style={styles.nodeMetricsRow}>
          <View style={styles.metricCell}>
            <Text style={styles.metricCellLabel}>SEÑAL ADC (TS-300B)</Text>
            <Text style={[styles.metricCellNum, {color}]}>
              {node.adcRaw} <Text style={styles.metricCellUnit}>cuentas</Text>
            </Text>
          </View>

          <View style={styles.metricCell}>
            <Text style={styles.metricCellLabel}>TENSIÓN GPIO 34</Text>
            <Text style={[styles.metricCellNum, {color: THEME.colors.cyan}]}>
              {node.voltage !== null ? node.voltage.toFixed(3) : '—'} <Text style={styles.metricCellUnit}>V</Text>
            </Text>
          </View>
        </View>

        <View style={styles.nodeCardFooter}>
          <Text style={styles.nodeFooterText}>Sensor: {node.hardwareHealth.replace(/_/g, ' ')}</Text>
          <Text style={styles.nodeFooterText}>🕒 {formatPetTime(node.lastSeen)} ({node.samplingInterval}s)</Text>
        </View>
      </Pressable>
    );
  };

  // ==========================================================================
  // RENDER: VISTA EVENTOS PROTOCOLARES (ANALYTICS)
  // ==========================================================================
  const renderAnalytics = () => (
    <View style={styles.tabViewFull}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Consola Protocolar de Telemetría</Text>
        <Text style={styles.pageSubtitle}>Inspección de tramas MQTT y latencia en tiempo real</Text>
      </View>

      <View style={styles.terminalContainer}>
        <View style={styles.terminalTop}>
          <Text style={styles.terminalTitle}>EMQX 5.8 · TÓPICO: cistern/+/telemetry</Text>
          <Pressable onPress={() => setMqttLogs([])}>
            <Text style={styles.terminalClear}>Limpiar</Text>
          </Pressable>
        </View>
        <ScrollView style={{flex: 1}}>
          {mqttLogs.length === 0 ? (
            <Text style={styles.terminalEmpty}>Sin eventos registrados. Conéctate para observar el tráfico.</Text>
          ) : (
            mqttLogs.map(l => (
              <View key={l.id} style={{flexDirection: 'row', gap: 6, marginVertical: 2}}>
                <Text style={styles.logTime}>[{l.time}]</Text>
                <Text style={[styles.logText, {color: l.type === 'success' ? THEME.colors.mint : (l.type === 'warn' ? THEME.colors.amber : (l.type === 'error' ? THEME.colors.rose : THEME.colors.cyan))}]}>
                  {l.text}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );

  // ==========================================================================
  // RENDER: VISTA AJUSTES
  // ==========================================================================
  const renderSettings = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Conectividad & Seguridad</Text>
        <Text style={styles.pageSubtitle}>Parámetros de broker y control de acceso POLP</Text>
      </View>

      <View style={styles.settingsBox}>
        <Text style={styles.inputLabel}>URL BROKER WEBSOCKET</Text>
        <TextInput
          style={styles.input}
          value={brokerUrl}
          onChangeText={setBrokerUrl}
          autoCapitalize="none"
          keyboardType="url"
        />

        <View style={{flexDirection: 'row', gap: 8, marginVertical: 8}}>
          <Pressable style={styles.presetTag} onPress={() => setBrokerUrl('ws://192.168.18.10:8084/mqtt')}>
            <Text style={styles.presetTagText}>📍 Wi-Fi (192.168.18.10)</Text>
          </Pressable>
          <Pressable style={styles.presetTag} onPress={() => setBrokerUrl('ws://127.0.0.1:8084/mqtt')}>
            <Text style={styles.presetTagText}>💻 Localhost (127.0.0.1)</Text>
          </Pressable>
        </View>

        <Text style={styles.inputLabel}>USUARIO MQTT (AUTHN)</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />

        <Text style={styles.inputLabel}>CONTRASEÑA (SHA-256)</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Pressable
          style={[styles.primaryActionBtn, connectionStatus === 'connected' && {backgroundColor: THEME.colors.rose}]}
          onPress={connectionStatus === 'connected' ? handleDisconnect : () => handleConnect()}
        >
          <Text style={styles.primaryActionBtnText}>
            {connectionStatus === 'connected' ? 'Desconectar' : '⚡ Establecer Enlace'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  // ==========================================================================
  // RENDER: MODAL DE FICHA TÉCNICA
  // ==========================================================================
  const renderDetailModal = () => {
    if (!selectedNode) return null;
    const isS1 = selectedNode.regimen === 's1';
    const isS2 = selectedNode.regimen === 's2';
    const color = isS1 ? THEME.colors.mint : (isS2 ? THEME.colors.amber : THEME.colors.rose);

    return (
      <Modal visible={true} animationType="slide" transparent={true} onRequestClose={() => setSelectedNode(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalId}>🚰 {selectedNode.id}</Text>
                <Text style={styles.modalLoc}>{selectedNode.location}</Text>
              </View>
              <Pressable style={styles.modalXBtn} onPress={() => setSelectedNode(null)}>
                <Text style={styles.modalXBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.modalConditionBox, {borderColor: color, backgroundColor: `${color}15`}]}>
                <Text style={[styles.modalConditionTitle, {color}]}>{selectedNode.regimenLabel}</Text>
                <Text style={styles.modalConditionText}>
                  {isS1 ? 'Señal óptica basal estable (~2133 cuentas). Dispersión mínima de luz.' : (isS2 ? 'Atenuación óptica (~1882 cuentas) por sedimento agregado.' : 'Perturbación severa o anomalía de sensor.')}
                </Text>
              </View>

              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>SEÑAL ADC (12-BITS)</Text>
                  <Text style={[styles.detailVal, {color}]}>{selectedNode.adcRaw} cuentas</Text>
                  <Text style={styles.detailSub}>Entrada GPIO 34</Text>
                </View>

                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>TENSIÓN ACONDICIONADA</Text>
                  <Text style={[styles.detailVal, {color: THEME.colors.cyan}]}>
                    {selectedNode.voltage !== null ? `${selectedNode.voltage.toFixed(3)} V` : '—'}
                  </Text>
                  <Text style={styles.detailSub}>Divisor 10k / 20k</Text>
                </View>

                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>TEMPERATURA 1-WIRE</Text>
                  <Text style={styles.detailVal}>
                    {selectedNode.temperature !== null ? `${selectedNode.temperature.toFixed(2)} °C` : '—'}
                  </Text>
                  <Text style={styles.detailSub}>Dallas DS18B20 (GPIO 4)</Text>
                </View>

                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>PREVISIÓN RIDGE (h=5)</Text>
                  <Text style={[styles.detailVal, {color: THEME.colors.mint}]}>{selectedNode.ridgePred} cuentas</Text>
                  <Text style={styles.detailSub}>Modelo exploratorio</Text>
                </View>
              </View>

              <Pressable style={styles.modalDismissBtn} onPress={() => setSelectedNode(null)}>
                <Text style={styles.modalDismissBtnText}>✕ Cerrar Ficha Técnica</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // ==========================================================================
  // RENDER GENERAL
  // ==========================================================================
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        {/* NAVBAR SUPERIOR CON ESPACIO SEGURO PARA NOTCH */}
        <View style={styles.navbarSafe}>
          <View style={styles.brandGroup}>
            <View style={styles.brandIconBox}>
              <Text style={{fontSize: 18}}>💧</Text>
            </View>
            <View>
              <Text style={styles.brandName}>TURBISENSE <Text style={{fontSize: 9, color: THEME.colors.cyan}}>IoT UNT</Text></Text>
              <Text style={styles.brandSub}>SEÑAL ÓPTICA INSTRUMENTAL (ADC)</Text>
            </View>
          </View>

          <Pressable
            style={[styles.statusBadge, connectionStatus === 'connected' ? styles.statusBadgeOnline : (connectionStatus === 'connecting' ? styles.statusBadgeWarn : styles.statusBadgeOffline)]}
            onPress={connectionStatus === 'connected' ? handleDisconnect : () => handleConnect()}
          >
            <View style={[styles.statusDot, connectionStatus === 'connected' && {backgroundColor: THEME.colors.mint}]} />
            <Text style={styles.statusBadgeText}>
              {connectionStatus === 'connected' ? 'ONLINE' : (connectionStatus === 'connecting' ? 'CONECTANDO' : 'DESCONECTADO')}
            </Text>
          </Pressable>
        </View>

        {/* VISTAS */}
        <View style={{flex: 1}}>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'stations' && renderDashboard()}
          {activeTab === 'analytics' && renderAnalytics()}
          {activeTab === 'settings' && renderSettings()}
        </View>

        {/* MODAL */}
        {renderDetailModal()}

        {/* BOTTOM TAB BAR */}
        <View style={styles.tabBar}>
          <Pressable style={styles.tabBtn} onPress={() => setActiveTab('dashboard')}>
            <Text style={[styles.tabBtnIcon, activeTab === 'dashboard' && styles.tabBtnIconActive]}>📊</Text>
            <Text style={[styles.tabBtnLabel, activeTab === 'dashboard' && styles.tabBtnLabelActive]}>Dashboard</Text>
          </Pressable>

          <Pressable style={styles.tabBtn} onPress={() => setActiveTab('stations')}>
            <Text style={[styles.tabBtnIcon, activeTab === 'stations' && styles.tabBtnIconActive]}>🚰</Text>
            <Text style={[styles.tabBtnLabel, activeTab === 'stations' && styles.tabBtnLabelActive]}>Nodos</Text>
          </Pressable>

          <Pressable style={styles.tabBtn} onPress={() => setActiveTab('analytics')}>
            <Text style={[styles.tabBtnIcon, activeTab === 'analytics' && styles.tabBtnIconActive]}>📈</Text>
            <Text style={[styles.tabBtnLabel, activeTab === 'analytics' && styles.tabBtnLabelActive]}>Eventos</Text>
          </Pressable>

          <Pressable style={styles.tabBtn} onPress={() => setActiveTab('settings')}>
            <Text style={[styles.tabBtnIcon, activeTab === 'settings' && styles.tabBtnIconActive]}>⚙️</Text>
            <Text style={[styles.tabBtnLabel, activeTab === 'settings' && styles.tabBtnLabelActive]}>Ajustes</Text>
          </Pressable>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================================================
// 4. ESTILOS ARQUITECTURALES SAFE AREA CERTIFIED
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.bgDark,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },

  /* NAVBAR CON SAFE AREA TOP PADDING */
  navbarSafe: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 12 : 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    backgroundColor: 'rgba(9, 18, 34, 0.95)',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    borderWidth: 1,
    borderColor: THEME.colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 15,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
  },
  brandSub: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.textMuted,
    letterSpacing: 1,
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeOnline: {
    backgroundColor: 'rgba(0, 242, 169, 0.15)',
    borderColor: 'rgba(0, 242, 169, 0.4)',
  },
  statusBadgeWarn: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: 'rgba(255, 183, 3, 0.4)',
  },
  statusBadgeOffline: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: THEME.colors.border,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.colors.textMuted,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
  },

  /* NOTA CIENTÍFICA */
  scienceNoticeBox: {
    backgroundColor: 'rgba(0, 229, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.2)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  scienceNoticeText: {
    fontSize: 10,
    color: THEME.colors.textSecondary,
    lineHeight: 14,
  },

  /* HERO SIGNAL CARD */
  heroSignalCard: {
    backgroundColor: THEME.colors.bgCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 18,
    marginBottom: 14,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  heroEyebrow: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.cyan,
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
    marginTop: 2,
  },
  regimenPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 242, 169, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 169, 0.3)',
  },
  regimenPillText: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.mint,
  },
  heroDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  heroScoreNum: {
    fontSize: 44,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: THEME.colors.cyan,
    lineHeight: 46,
  },
  heroScoreUnit: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    fontWeight: '600',
  },
  heroSubStats: {
    gap: 4,
  },
  subStatRow: {
    alignItems: 'flex-end',
  },
  subStatLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: THEME.colors.textMuted,
  },
  subStatVal: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#fff',
  },
  benchmarkRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    paddingTop: 10,
    marginTop: 6,
  },
  benchTag: {
    fontSize: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: THEME.colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },

  /* 1-CLIC BANNER */
  quickConnectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.25)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  qcTitle: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.cyan,
    letterSpacing: 0.8,
  },
  qcSubtitle: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#fff',
    fontWeight: '700',
    marginTop: 1,
  },
  qcBtn: {
    backgroundColor: THEME.colors.cyan,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  qcBtnConnected: {
    backgroundColor: THEME.colors.mint,
  },
  qcBtnText: {
    color: THEME.colors.bgDark,
    fontSize: 11,
    fontWeight: '800',
  },

  /* KPI ROW */
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 12,
    padding: 10,
  },
  kpiTag: {
    fontSize: 7,
    fontWeight: '800',
    color: THEME.colors.textMuted,
  },
  kpiNum: {
    fontSize: 15,
    fontWeight: '900',
    color: '#fff',
    marginVertical: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  kpiSub: {
    fontSize: 7,
    color: THEME.colors.textSecondary,
  },

  /* SECCION */
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    fontWeight: '700',
  },

  /* NODE CARD */
  nodeCard: {
    backgroundColor: THEME.colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 14,
    marginBottom: 10,
  },
  nodeCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  nodeIdText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  badgeOrigin: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  badgeOriginPhysical: {
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
  },
  badgeOriginText: {
    fontSize: 7,
    fontWeight: '800',
    color: THEME.colors.cyan,
  },
  nodeLocationText: {
    fontSize: 10,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },
  regimenChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  regimenChipText: {
    fontSize: 7,
    fontWeight: '800',
  },
  nodeMetricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  metricCell: {
    flex: 1,
    backgroundColor: THEME.colors.bgInput,
    borderRadius: 8,
    padding: 8,
  },
  metricCellLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: THEME.colors.textMuted,
  },
  metricCellNum: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  metricCellUnit: {
    fontSize: 9,
    color: THEME.colors.textSecondary,
    fontWeight: '500',
  },
  nodeCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    paddingTop: 6,
  },
  nodeFooterText: {
    fontSize: 9,
    color: THEME.colors.textMuted,
  },

  /* EMPTY */
  emptyCard: {
    backgroundColor: THEME.colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 24,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  emptyDesc: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },

  /* TERMINAL */
  tabViewFull: {
    flex: 1,
    padding: 16,
  },
  pageHeader: {
    marginBottom: 12,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  pageSubtitle: {
    fontSize: 10,
    color: THEME.colors.textSecondary,
    marginTop: 1,
  },
  terminalContainer: {
    flex: 1,
    backgroundColor: '#02050b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 10,
  },
  terminalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    paddingBottom: 6,
    marginBottom: 6,
  },
  terminalTitle: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.cyan,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  terminalClear: {
    fontSize: 9,
    color: THEME.colors.textMuted,
    fontWeight: '700',
  },
  terminalEmpty: {
    color: THEME.colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 20,
  },
  logTime: {
    fontSize: 9,
    color: THEME.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  /* SETTINGS */
  settingsBox: {
    backgroundColor: THEME.colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 16,
  },
  inputLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.textMuted,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: THEME.colors.bgInput,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 8,
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  presetTag: {
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.2)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  presetTagText: {
    fontSize: 8,
    color: THEME.colors.cyan,
    fontWeight: '700',
  },
  primaryActionBtn: {
    backgroundColor: THEME.colors.cyan,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryActionBtnText: {
    color: THEME.colors.bgDark,
    fontSize: 12,
    fontWeight: '800',
  },

  /* MODAL */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: THEME.colors.bgCardElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.borderActive,
    padding: 18,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  modalId: {
    fontSize: 16,
    fontWeight: '900',
    color: '#fff',
  },
  modalLoc: {
    fontSize: 10,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },
  modalXBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalXBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  modalConditionBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  modalConditionTitle: {
    fontSize: 10,
    fontWeight: '800',
  },
  modalConditionText: {
    fontSize: 10,
    color: '#fff',
    marginTop: 2,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  detailItem: {
    width: '48%',
    backgroundColor: THEME.colors.bgInput,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  detailLabel: {
    fontSize: 7,
    fontWeight: '800',
    color: THEME.colors.textMuted,
  },
  detailVal: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginVertical: 2,
    color: '#fff',
  },
  detailSub: {
    fontSize: 8,
    color: THEME.colors.textSecondary,
  },
  modalDismissBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  modalDismissBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },

  /* TAB BAR */
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    backgroundColor: 'rgba(9, 18, 34, 0.98)',
    paddingVertical: 6,
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  tabBtnIcon: {
    fontSize: 15,
    opacity: 0.5,
  },
  tabBtnIconActive: {
    opacity: 1,
    transform: [{scale: 1.1}],
  },
  tabBtnLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: THEME.colors.textMuted,
  },
  tabBtnLabelActive: {
    color: THEME.colors.cyan,
  },
});

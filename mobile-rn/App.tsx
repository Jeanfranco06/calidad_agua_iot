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
// 1. TIPOS Y MODELOS DE DATOS CIBERFÍSICOS
// ============================================================================
export interface TelemetryReading {
  turbidity: number | null;
  temperature: number | null;
  voltage: number | null;
  timestamp: Date;
}

export interface WaterStation {
  id: string;
  name: string;
  location: string;
  isPhysical: boolean;
  turbidity: number | null;
  temperature: number | null;
  voltage: number | null;
  isCalibrated: boolean;
  hardwareHealth: 'OK' | 'PROBE_DISCONNECTED' | 'SHORT_CIRCUIT' | 'STANDBY' | string;
  status: 'optimal' | 'warning' | 'critical';
  samplingInterval: number;
  lastSeen: Date;
  history: TelemetryReading[];
  rawPayload?: any;
}

export type ActiveTab = 'dashboard' | 'stations' | 'analytics' | 'settings';

// ============================================================================
// 2. CONSTANTES DEL SISTEMA Y TOKENS DE DISEÑO
// ============================================================================
const MQTT_CONFIG = {
  TOPIC_TELEMETRY: 'cistern/+/telemetry',
  DEFAULT_BROKER: 'ws://192.168.18.10:8084/mqtt',
  DEFAULT_USER: 'mobile_monitor',
  DEFAULT_PASS: 'Nu2eYr2W2tKbm92URpcB!2026',
};

const THEME = {
  colors: {
    bgDark: '#040810',
    bgCard: '#0A1324',
    bgCardElevated: '#101E36',
    bgInput: '#070E1A',
    cyan: '#00E5FF',
    cyanGlow: 'rgba(0, 229, 255, 0.25)',
    mint: '#00F2A9',
    mintGlow: 'rgba(0, 242, 169, 0.25)',
    amber: '#FFB703',
    amberGlow: 'rgba(255, 183, 3, 0.25)',
    rose: '#FF3366',
    roseGlow: 'rgba(255, 51, 102, 0.35)',
    textPrimary: '#FFFFFF',
    textSecondary: '#94A3B8',
    textMuted: '#475569',
    border: 'rgba(255, 255, 255, 0.08)',
    borderActive: 'rgba(0, 229, 255, 0.4)',
  },
};

// Formato horario PET (Trujillo, Perú)
const formatPetTime = (date: Date): string => {
  const pet = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const h = String(pet.getUTCHours()).padStart(2, '0');
  const m = String(pet.getUTCMinutes()).padStart(2, '0');
  const s = String(pet.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

// ============================================================================
// 3. COMPONENTE PRINCIPAL (AquaSense IoT)
// ============================================================================
export default function App() {
  // Estado de navegación
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedStation, setSelectedStation] = useState<WaterStation | null>(null);

  // Parámetros de conexión MQTT
  const [brokerUrl, setBrokerUrl] = useState(MQTT_CONFIG.DEFAULT_BROKER);
  const [username, setUsername] = useState(MQTT_CONFIG.DEFAULT_USER);
  const [password, setPassword] = useState(MQTT_CONFIG.DEFAULT_PASS);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [mqttClient, setMqttClient] = useState<MqttClient | null>(null);
  const [mqttLogs, setMqttLogs] = useState<Array<{id: string; time: string; text: string; type: 'info' | 'success' | 'warn' | 'error'}>>([]);

  // Datos telemétricos reactivos
  const [stations, setStations] = useState<Record<string, WaterStation>>({});
  const [totalPacketsReceived, setTotalPacketsReceived] = useState<number>(0);
  const [samplingRatePerSec, setSamplingRatePerSec] = useState<number>(0);
  const [packetCounterInterval, setPacketCounterInterval] = useState<number>(0);

  // Helper para agregar log
  const addLog = useCallback((text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = formatPetTime(new Date());
    setMqttLogs(prev => [{id: Math.random().toString(36).substring(2, 9), time, text, type}, ...prev.slice(0, 49)]);
  }, []);

  // Limpieza de cliente al desmontar
  useEffect(() => {
    return () => {
      mqttClient?.end(true);
    };
  }, [mqttClient]);

  // Medición de paquetes por segundo
  useEffect(() => {
    const timer = setInterval(() => {
      setSamplingRatePerSec(packetCounterInterval);
      setPacketCounterInterval(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [packetCounterInterval]);

  // Desconexión manual
  const handleDisconnect = useCallback(() => {
    if (mqttClient) {
      mqttClient.end(true);
      setMqttClient(null);
    }
    setConnectionStatus('idle');
    setLatencyMs(null);
    addLog('Sesión MQTT cerrada por el usuario', 'info');
  }, [mqttClient, addLog]);

  // Conexión al Broker EMQX
  const handleConnect = useCallback(() => {
    handleDisconnect();
    if (!brokerUrl.trim() || !username.trim()) {
      addLog('URL y Usuario son obligatorios', 'error');
      return;
    }

    setConnectionStatus('connecting');
    addLog(`Conectando a broker: ${brokerUrl.trim()}...`, 'info');
    const startConnTime = Date.now();

    try {
      const client = mqtt.connect(brokerUrl.trim(), {
        username: username.trim(),
        password: password.trim() || MQTT_CONFIG.DEFAULT_PASS,
        clientId: `aquasense_rn_${Math.random().toString(16).substring(2, 8)}`,
        protocolVersion: 4,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000,
        resubscribe: true,
        forceNativeWebSocket: true,
      } as any);

      setMqttClient(client);

      client.on('connect', () => {
        const ping = Date.now() - startConnTime;
        setLatencyMs(ping);
        setConnectionStatus('connected');
        addLog(`Conectado exitosamente (Latencia: ${ping}ms)`, 'success');

        client.subscribe(MQTT_CONFIG.TOPIC_TELEMETRY, {qos: 1}, (err) => {
          if (err) {
            addLog(`Fallo de suscripción ACL en ${MQTT_CONFIG.TOPIC_TELEMETRY}`, 'error');
          } else {
            addLog(`Suscrito con QoS 1 a ${MQTT_CONFIG.TOPIC_TELEMETRY}`, 'success');
          }
        });
      });

      client.on('message', (topic, payload) => {
        try {
          const raw = JSON.parse(payload.toString());
          const now = new Date();
          const devId = String(raw.device_id || topic.split('/')[1] || 'UNKNOWN_NODE');
          const metrics = raw.metrics || {};

          setTotalPacketsReceived(v => v + 1);
          setPacketCounterInterval(v => v + 1);

          const isCalibrated = metrics.turbidity_calibrated === true;
          let turb = isCalibrated
            ? metrics.turbidity_ntu
            : (metrics.turbidity_estimated_ntu ?? metrics.turbidez_estimada);
          
          if (typeof turb === 'number') turb = Number(turb.toFixed(2));
          let temp = metrics.temperature_c;
          if (typeof temp === 'number') temp = Number(temp.toFixed(2));
          let volt = metrics.pin_voltage_v ?? metrics.sensor_voltage;
          if (typeof volt === 'number') volt = Number(volt.toFixed(3));

          // Clasificación de salubridad DIGESA
          let status: 'optimal' | 'warning' | 'critical' = 'optimal';
          if (turb !== null && turb !== undefined) {
            if (turb >= 5.0 || String(raw.hardware_health || '').includes('STANDBY')) {
              status = 'critical';
            } else if (turb >= 4.0) {
              status = 'warning';
            }
          }

          const isPhysical = String(raw.origin || devId).toUpperCase().includes('FISICO') ||
                             String(devId).toUpperCase().includes('UNT');

          setStations(prev => {
            const existing = prev[devId];
            const history = existing ? [...existing.history] : [];
            history.push({turbidity: turb, temperature: temp, voltage: volt, timestamp: now});
            if (history.length > 20) history.shift();

            const updated: WaterStation = {
              id: devId,
              name: devId.replace(/_/g, ' '),
              location: raw.location || 'Reservorio Universitario',
              isPhysical,
              turbidity: turb,
              temperature: temp,
              voltage: volt,
              isCalibrated,
              hardwareHealth: raw.hardware_health || 'OK',
              status,
              samplingInterval: raw.sampling_rate || (turb && turb >= 4.0 ? 1 : 4),
              lastSeen: now,
              history,
              rawPayload: raw,
            };

            return {...prev, [devId]: updated};
          });
        } catch (e: any) {
          addLog(`Error al parsear payload JSON: ${e?.message}`, 'warn');
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
      addLog(`Error fatal de cliente: ${err?.message}`, 'error');
    }
  }, [brokerUrl, username, password, handleDisconnect, addLog]);

  // Lista ordenada de estaciones
  const stationList = useMemo(() => {
    return Object.values(stations).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  }, [stations]);

  // Cálculos agregados de salud WQI (Water Quality Index)
  const systemMetrics = useMemo(() => {
    if (stationList.length === 0) {
      return {wqi: 100, avgTurb: 0, avgTemp: 0, alertCount: 0, physicalCount: 0};
    }
    let sumTurb = 0, countTurb = 0, sumTemp = 0, countTemp = 0, alerts = 0, physical = 0;
    stationList.forEach(s => {
      if (typeof s.turbidity === 'number') {
        sumTurb += s.turbidity;
        countTurb++;
        if (s.turbidity >= 5.0 || s.hardwareHealth !== 'OK') alerts++;
      }
      if (typeof s.temperature === 'number') {
        sumTemp += s.temperature;
        countTemp++;
      }
      if (s.isPhysical) physical++;
    });

    const avgTurb = countTurb > 0 ? sumTurb / countTurb : 0;
    const avgTemp = countTemp > 0 ? sumTemp / countTemp : 0;
    const wqi = Math.max(10, Math.min(100, Math.round(100 - avgTurb * 9.5)));

    return {wqi, avgTurb, avgTemp, alertCount: alerts, physicalCount: physical};
  }, [stationList]);

  // ==========================================================================
  // RENDER: VISTA DASHBOARD (PANEL EJECUTIVO)
  // ==========================================================================
  const renderDashboard = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* TARJETA HERO: ÍNDICE DE CALIDAD GLOBAL (WQI) */}
      <View style={styles.wqiHeroCard}>
        <View style={styles.wqiGlowBackground} />
        <View style={styles.wqiTopRow}>
          <View>
            <Text style={styles.heroEyebrow}>ÍNDICE DE POTABILIDAD CIBERFÍSICA</Text>
            <Text style={styles.heroTitle}>Salud del Sistema Hídrico</Text>
          </View>
          <View style={[styles.statusTag, systemMetrics.alertCount > 0 ? styles.statusTagAlert : styles.statusTagOptimal]}>
            <Text style={[styles.statusTagText, systemMetrics.alertCount > 0 ? styles.textRose : styles.textMint]}>
              {systemMetrics.alertCount > 0 ? '⚠️ CONDICIÓN DE RIESGO' : '✓ CONFORME A DIGESA'}
            </Text>
          </View>
        </View>

        <View style={styles.wqiMetricsDisplay}>
          <View style={styles.wqiBigScoreWrap}>
            <Text style={[styles.wqiBigScore, systemMetrics.wqi >= 80 ? styles.textMint : (systemMetrics.wqi >= 60 ? styles.textAmber : styles.textRose)]}>
              {stationList.length > 0 ? `${systemMetrics.wqi}` : '--'}
            </Text>
            <Text style={styles.wqiScoreUnit}>/100 WQI</Text>
          </View>

          <View style={styles.wqiStatsMiniCol}>
            <View style={styles.miniStatItem}>
              <Text style={styles.miniStatLabel}>TURBIDEZ MEDIA</Text>
              <Text style={styles.miniStatValue}>
                {stationList.length > 0 ? systemMetrics.avgTurb.toFixed(2) : '--'} <Text style={styles.unitSmall}>NTU</Text>
              </Text>
            </View>
            <View style={styles.miniStatItem}>
              <Text style={styles.miniStatLabel}>TEMPERATURA MEDIA</Text>
              <Text style={styles.miniStatValue}>
                {stationList.length > 0 ? systemMetrics.avgTemp.toFixed(1) : '--'} <Text style={styles.unitSmall}>°C</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* Barra de progreso analítica */}
        <View style={styles.progressBarWrap}>
          <View
            style={[
              styles.progressBarFill,
              {width: `${systemMetrics.wqi}%`},
              systemMetrics.wqi >= 80 ? styles.bgMint : (systemMetrics.wqi >= 60 ? styles.bgAmber : styles.bgRose)
            ]}
          />
        </View>
        <Text style={styles.wqiNormNote}>
          Norma Técnica Nacional: D.S. N° 031-2010-SA establece límite máximo permisible en &lt; 5.0 NTU.
        </Text>
      </View>

      {/* METRICAS DE TRANSACCIÓN Y TELEMETRÍA */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiTag}>RESERVORIOS</Text>
          <Text style={styles.kpiMain}>{stationList.length.toString().padStart(2, '0')}</Text>
          <Text style={styles.kpiSub}>{systemMetrics.physicalCount} físico · {stationList.length - systemMetrics.physicalCount} virtual</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiTag}>FLUJO EN VIVO</Text>
          <Text style={[styles.kpiMain, styles.textCyan]}>{samplingRatePerSec} <Text style={styles.unitSmall}>pkt/s</Text></Text>
          <Text style={styles.kpiSub}>{totalPacketsReceived.toLocaleString()} totales</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiTag}>LATENCIA MQTT</Text>
          <Text style={[styles.kpiMain, latencyMs ? styles.textMint : styles.textMuted]}>
            {latencyMs ? `${latencyMs}` : '--'} <Text style={styles.unitSmall}>ms</Text>
          </Text>
          <Text style={styles.kpiSub}>Transporte WS</Text>
        </View>
      </View>

      {/* SECCIÓN DE ESTACIONES EN TIEMPO REAL */}
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionTitle}>ESTACIONES CIBERFÍSICAS</Text>
          <Text style={styles.sectionSubtitle}>Monitoreo continuo en tanques de almacenamiento</Text>
        </View>
        <Pressable style={styles.actionPill} onPress={() => setActiveTab('stations')}>
          <Text style={styles.actionPillText}>Ver todas ({stationList.length}) →</Text>
        </Pressable>
      </View>

      {stationList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💧</Text>
          <Text style={styles.emptyTitle}>Sin telemetría en línea</Text>
          <Text style={styles.emptyText}>
            Pulsa el botón de conexión en la barra superior o ve a Ajustes para enlazar con el broker EMQX.
          </Text>
          {connectionStatus !== 'connected' && (
            <Pressable style={styles.primaryConnectBtn} onPress={handleConnect}>
              <Text style={styles.primaryConnectBtnText}>⚡ 1-Clic Conectar al Broker</Text>
            </Pressable>
          )}
        </View>
      ) : (
        stationList.slice(0, 3).map(station => renderStationCard(station))
      )}
    </ScrollView>
  );

  // ==========================================================================
  // RENDER: TARJETA DE ESTACIÓN HÍDRICA (STATION CARD)
  // ==========================================================================
  const renderStationCard = (station: WaterStation) => {
    const isAlert = station.status === 'critical';
    const isWarning = station.status === 'warning';
    const statusColor = isAlert ? THEME.colors.rose : (isWarning ? THEME.colors.amber : THEME.colors.mint);
    const statusLabel = isAlert ? 'ALERTA DIGESA' : (isWarning ? 'PRECAUCIÓN' : 'SALUBRE');

    return (
      <Pressable
        key={station.id}
        style={[
          styles.stationCard,
          isAlert && styles.stationCardAlert,
          isWarning && styles.stationCardWarning,
        ]}
        onPress={() => setSelectedStation(station)}
      >
        <View style={styles.stationCardHeader}>
          <View style={styles.stationCardTitleCol}>
            <View style={styles.stationIdBadgeRow}>
              <Text style={styles.stationCardId}>🚰 {station.id}</Text>
              <View style={[styles.originBadge, station.isPhysical ? styles.originBadgePhysical : styles.originBadgeVirtual]}>
                <Text style={styles.originBadgeText}>{station.isPhysical ? 'FÍSICO REAL' : 'VIRTUAL DOCKER'}</Text>
              </View>
            </View>
            <Text style={styles.stationCardLocation}>{station.location}</Text>
          </View>

          <View style={[styles.statusChip, {borderColor: statusColor, backgroundColor: `${statusColor}18`}]}>
            <Text style={[styles.statusChipText, {color: statusColor}]}>{statusLabel}</Text>
          </View>
        </View>

        {/* MÉTRICAS PRINCIPALES */}
        <View style={styles.cardMetricsGrid}>
          <View style={styles.metricCardMini}>
            <Text style={styles.metricLabelMini}>
              TURBIDEZ {station.isCalibrated ? '(CALIBRADA)' : '(ESTIMADA)'}
            </Text>
            <View style={styles.metricValRow}>
              <Text style={[styles.metricValLarge, {color: statusColor}]}>
                {station.turbidity !== null && station.turbidity !== undefined ? station.turbidity.toFixed(2) : '—'}
              </Text>
              <Text style={styles.metricValUnit}>NTU</Text>
            </View>
            <View style={styles.miniBar}>
              <View
                style={[
                  styles.miniBarFill,
                  {width: `${Math.min(100, Math.max(5, ((station.turbidity || 0) / 7.0) * 100))}%`, backgroundColor: statusColor}
                ]}
              />
            </View>
          </View>

          <View style={styles.metricCardMini}>
            <Text style={styles.metricLabelMini}>TEMPERATURA (DS18B20)</Text>
            <View style={styles.metricValRow}>
              <Text style={[styles.metricValLarge, styles.textCyan]}>
                {station.temperature !== null && station.temperature !== undefined ? station.temperature.toFixed(2) : '—'}
              </Text>
              <Text style={styles.metricValUnit}>°C</Text>
            </View>
            <View style={styles.miniBar}>
              <View
                style={[
                  styles.miniBarFill,
                  {width: `${Math.min(100, Math.max(5, (((station.temperature || 20) - 15) / 15.0) * 100))}%`, backgroundColor: THEME.colors.cyan}
                ]}
              />
            </View>
          </View>
        </View>

        {/* FOOTER DE LA TARJETA */}
        <View style={styles.stationCardFooter}>
          <Text style={styles.footerInfoText}>
            Sensor: <Text style={{color: THEME.colors.textPrimary}}>{station.hardwareHealth.replace(/_/g, ' ')}</Text>
          </Text>
          <Text style={styles.footerTimeText}>
            🕒 {formatPetTime(station.lastSeen)} PET ({station.samplingInterval}s)
          </Text>
        </View>
      </Pressable>
    );
  };

  // ==========================================================================
  // RENDER: VISTA ESTACIONES COMPLETAS
  // ==========================================================================
  const renderStationsView = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Catálogo de Reservorios</Text>
        <Text style={styles.pageSubtitle}>Inventario ciberfísico con adquisición continua de datos</Text>
      </View>

      {stationList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyTitle}>Sin estaciones registradas</Text>
          <Text style={styles.emptyText}>Conéctate al broker para poblar el catálogo de telemetría.</Text>
        </View>
      ) : (
        stationList.map(station => renderStationCard(station))
      )}
    </ScrollView>
  );

  // ==========================================================================
  // RENDER: VISTA ANALÍTICA & LOGS MQTT
  // ==========================================================================
  const renderAnalyticsView = () => (
    <View style={styles.analyticsContainer}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Consola de Eventos MQTT</Text>
        <Text style={styles.pageSubtitle}>Inspección de tramas, latencia y verificación de paquetes QoS 1</Text>
      </View>

      <View style={styles.terminalContainer}>
        <View style={styles.terminalHeader}>
          <Text style={styles.terminalTitle}>REGISTRO PROTOCOLAR EN VIVO (M2M)</Text>
          <Pressable onPress={() => setMqttLogs([])}>
            <Text style={styles.terminalClearText}>Limpiar</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.terminalScroll} showsVerticalScrollIndicator={true}>
          {mqttLogs.length === 0 ? (
            <Text style={styles.terminalEmpty}>Sin eventos registrados. Inicia la conexión para auditar el tráfico.</Text>
          ) : (
            mqttLogs.map(log => {
              const color = log.type === 'success' ? THEME.colors.mint :
                            log.type === 'warn' ? THEME.colors.amber :
                            log.type === 'error' ? THEME.colors.rose : THEME.colors.cyan;
              return (
                <View key={log.id} style={styles.logRow}>
                  <Text style={styles.logTime}>[{log.time}]</Text>
                  <Text style={[styles.logText, {color}]}>{log.text}</Text>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </View>
  );

  // ==========================================================================
  // RENDER: VISTA AJUSTES Y SEGURIDAD
  // ==========================================================================
  const renderSettingsView = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Conectividad & Seguridad</Text>
        <Text style={styles.pageSubtitle}>Control de acceso perimetral y parámetros de enlace EMQX</Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.fieldLabel}>URL BROKER WEBSOCKET</Text>
        <TextInput
          style={styles.textInput}
          value={brokerUrl}
          onChangeText={setBrokerUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="ws://192.168.18.10:8084/mqtt"
          placeholderTextColor={THEME.colors.textMuted}
        />

        <View style={styles.presetsRow}>
          <Pressable style={styles.presetChip} onPress={() => setBrokerUrl('ws://192.168.18.10:8084/mqtt')}>
            <Text style={styles.presetChipText}>📍 Wi-Fi (192.168.18.10)</Text>
          </Pressable>
          <Pressable style={styles.presetChip} onPress={() => setBrokerUrl('ws://127.0.0.1:8084/mqtt')}>
            <Text style={styles.presetChipText}>💻 Localhost (127.0.0.1)</Text>
          </Pressable>
        </View>

        <Text style={styles.fieldLabel}>USUARIO MQTT (AUTHN)</Text>
        <TextInput
          style={styles.textInput}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          placeholderTextColor={THEME.colors.textMuted}
        />

        <Text style={styles.fieldLabel}>CONTRASEÑA (HASH SHA-256)</Text>
        <TextInput
          style={styles.textInput}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholderTextColor={THEME.colors.textMuted}
        />

        <View style={styles.settingsActionsRow}>
          <Pressable
            style={[styles.btnAction, connectionStatus === 'connected' ? styles.btnActionDisconnect : styles.btnActionConnect]}
            onPress={connectionStatus === 'connected' ? handleDisconnect : handleConnect}
          >
            {connectionStatus === 'connecting' ? (
              <ActivityIndicator color={THEME.colors.bgDark} />
            ) : (
              <Text style={styles.btnActionText}>
                {connectionStatus === 'connected' ? 'Desconectar Sesión' : '⚡ Establecer Enlace MQTT'}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.securityAuditBox}>
          <Text style={styles.securityAuditTitle}>AUDITORÍA DE MÍNIMO PRIVILEGIO (POLP)</Text>
          <Text style={styles.securityAuditDesc}>
            • Identidad: mobile_monitor{'\n'}
            • Autenticador: password_based:mysql (SHA-256 suffix salt){'\n'}
            • ACL asignada: cistern/+/telemetry (Permiso: SUBSCRIBE){'\n'}
            • Política de cierre: no_match = deny (Prohibido publicar)
          </Text>
        </View>
      </View>
    </ScrollView>
  );

  // ==========================================================================
  // RENDER: MODAL DE DETALLE DE ESTACIÓN (DEEP DRILL-DOWN)
  // ==========================================================================
  const renderDetailModal = () => {
    if (!selectedStation) return null;
    const isAlert = selectedStation.status === 'critical';
    const statusColor = isAlert ? THEME.colors.rose : (selectedStation.status === 'warning' ? THEME.colors.amber : THEME.colors.mint);

    return (
      <Modal visible={true} animationType="slide" transparent={true} onRequestClose={() => setSelectedStation(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Cabecera del Modal */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>🚰 {selectedStation.id}</Text>
                <Text style={styles.modalSubtitle}>{selectedStation.location}</Text>
              </View>
              <Pressable style={styles.modalCloseBtn} onPress={() => setSelectedStation(null)}>
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Resumen de Calidad */}
              <View style={[styles.modalBanner, {borderColor: statusColor, backgroundColor: `${statusColor}18`}]}>
                <Text style={[styles.modalBannerTitle, {color: statusColor}]}>
                  ESTADO OPERACIONAL: {selectedStation.status.toUpperCase()}
                </Text>
                <Text style={styles.modalBannerDesc}>
                  {isAlert ? 'Valores de turbidez superiores al límite reglamentario peruano (< 5 NTU).' : 'Parámetros fisicoquímicos en rango de seguridad.'}
                </Text>
              </View>

              {/* Grid de Métricas de Ingeniería */}
              <View style={styles.detailGrid}>
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>TURBIDEZ REGISTRADA</Text>
                  <Text style={[styles.detailBoxVal, {color: statusColor}]}>
                    {selectedStation.turbidity !== null ? `${selectedStation.turbidity.toFixed(2)} NTU` : '—'}
                  </Text>
                  <Text style={styles.detailBoxSub}>
                    {selectedStation.isCalibrated ? 'Sonda calibrada en laboratorio' : 'Estimación por curva analógica'}
                  </Text>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>TEMPERATURA 1-WIRE</Text>
                  <Text style={[styles.detailBoxVal, styles.textCyan]}>
                    {selectedStation.temperature !== null ? `${selectedStation.temperature.toFixed(2)} °C` : '—'}
                  </Text>
                  <Text style={styles.detailBoxSub}>Sensor Dallas DS18B20</Text>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>TENSIÓN TRANSDUCTOR</Text>
                  <Text style={styles.detailBoxVal}>
                    {selectedStation.voltage !== null ? `${selectedStation.voltage.toFixed(3)} V` : '—'}
                  </Text>
                  <Text style={styles.detailBoxSub}>Pin GPIO 34 (Divisor 10k/20k)</Text>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>TASA DE MUESTREO</Text>
                  <Text style={styles.detailBoxVal}>{selectedStation.samplingInterval} seg</Text>
                  <Text style={styles.detailBoxSub}>Control bidireccional autónomo</Text>
                </View>
              </View>

              {/* Curva Histórica de Lecturas */}
              <View style={styles.historySection}>
                <Text style={styles.historyTitle}>HISTORIAL DE LAS ÚLTIMAS LECTURAS</Text>
                {selectedStation.history.slice(-6).reverse().map((reading, idx) => (
                  <View key={idx} style={styles.historyRow}>
                    <Text style={styles.historyTime}>{formatPetTime(reading.timestamp)}</Text>
                    <Text style={styles.historyTurb}>{reading.turbidity !== null ? `${reading.turbidity.toFixed(2)} NTU` : 'null'}</Text>
                    <Text style={styles.historyTemp}>{reading.temperature !== null ? `${reading.temperature.toFixed(1)} °C` : 'null'}</Text>
                    <Text style={styles.historyVolt}>{reading.voltage !== null ? `${reading.voltage.toFixed(2)} V` : 'null'}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // ==========================================================================
  // RENDER GENERAL CON BARRA INFERIOR (TAB NAVIGATION)
  // ==========================================================================
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bgDark} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        {/* BARRA SUPERIOR PERSISTENTE */}
        <View style={styles.navbar}>
          <View style={styles.brandRow}>
            <View style={styles.brandLogo}>
              <Text style={styles.brandLogoText}>💧</Text>
            </View>
            <View>
              <Text style={styles.brandTitle}>AQUASENSE <Text style={styles.brandVer}>IoT 2.0</Text></Text>
              <Text style={styles.brandSubtitle}>PLATAFORMA CIBERFÍSICA NEFELOMÉTRICA</Text>
            </View>
          </View>

          <Pressable
            style={[
              styles.connectionPill,
              connectionStatus === 'connected' ? styles.pillConnected :
              (connectionStatus === 'connecting' ? styles.pillConnecting : styles.pillDisconnected)
            ]}
            onPress={connectionStatus === 'connected' ? handleDisconnect : handleConnect}
          >
            <View style={[styles.pillDot, connectionStatus === 'connected' && styles.pillDotActive]} />
            <Text style={styles.pillText}>
              {connectionStatus === 'connected' ? 'ONLINE' : (connectionStatus === 'connecting' ? 'CONECTANDO' : 'DESCONECTADO')}
            </Text>
          </Pressable>
        </View>

        {/* CONTENIDO ACTIVO SEGÚN PESTAÑA */}
        <View style={styles.mainContent}>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'stations' && renderStationsView()}
          {activeTab === 'analytics' && renderAnalyticsView()}
          {activeTab === 'settings' && renderSettingsView()}
        </View>

        {/* MODAL DE DETALLES */}
        {renderDetailModal()}

        {/* BARRA DE NAVEGACIÓN INFERIOR (TABS DE DISEÑO PROFESIONAL) */}
        <View style={styles.tabBar}>
          <Pressable style={styles.tabItem} onPress={() => setActiveTab('dashboard')}>
            <Text style={[styles.tabIcon, activeTab === 'dashboard' && styles.tabIconActive]}>📊</Text>
            <Text style={[styles.tabLabel, activeTab === 'dashboard' && styles.tabLabelActive]}>Dashboard</Text>
          </Pressable>

          <Pressable style={styles.tabItem} onPress={() => setActiveTab('stations')}>
            <Text style={[styles.tabIcon, activeTab === 'stations' && styles.tabIconActive]}>🚰</Text>
            <Text style={[styles.tabLabel, activeTab === 'stations' && styles.tabLabelActive]}>Estaciones</Text>
          </Pressable>

          <Pressable style={styles.tabItem} onPress={() => setActiveTab('analytics')}>
            <Text style={[styles.tabIcon, activeTab === 'analytics' && styles.tabIconActive]}>📈</Text>
            <Text style={[styles.tabLabel, activeTab === 'analytics' && styles.tabLabelActive]}>Eventos</Text>
          </Pressable>

          <Pressable style={styles.tabItem} onPress={() => setActiveTab('settings')}>
            <Text style={[styles.tabIcon, activeTab === 'settings' && styles.tabIconActive]}>⚙️</Text>
            <Text style={[styles.tabLabel, activeTab === 'settings' && styles.tabLabelActive]}>Ajustes</Text>
          </Pressable>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================================================
// 4. ESTILOS ARQUITECTURALES SEGÚN BUENAS PRÁCTICAS UI/UX
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.bgDark,
  },
  flex: {
    flex: 1,
  },
  mainContent: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 30,
  },

  /* NAVBAR */
  navbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    backgroundColor: 'rgba(10, 19, 36, 0.85)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandLogo: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    borderWidth: 1,
    borderColor: THEME.colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogoText: {
    fontSize: 18,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: 0.5,
  },
  brandVer: {
    fontSize: 10,
    color: THEME.colors.cyan,
    fontWeight: '700',
  },
  brandSubtitle: {
    fontSize: 8,
    fontWeight: '700',
    color: THEME.colors.textMuted,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillConnected: {
    backgroundColor: 'rgba(0, 242, 169, 0.15)',
    borderColor: 'rgba(0, 242, 169, 0.4)',
  },
  pillConnecting: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: 'rgba(255, 183, 3, 0.4)',
  },
  pillDisconnected: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: THEME.colors.border,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.colors.textMuted,
  },
  pillDotActive: {
    backgroundColor: THEME.colors.mint,
  },
  pillText: {
    fontSize: 9,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: 0.5,
  },

  /* WQI HERO CARD */
  wqiHeroCard: {
    backgroundColor: THEME.colors.bgCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 20,
    marginBottom: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  wqiGlowBackground: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
  },
  wqiTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  heroEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    color: THEME.colors.cyan,
    letterSpacing: 1.4,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    marginTop: 2,
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusTagOptimal: {
    backgroundColor: 'rgba(0, 242, 169, 0.12)',
    borderColor: 'rgba(0, 242, 169, 0.3)',
  },
  statusTagAlert: {
    backgroundColor: 'rgba(255, 51, 102, 0.12)',
    borderColor: 'rgba(255, 51, 102, 0.3)',
  },
  statusTagText: {
    fontSize: 8,
    fontWeight: '800',
  },
  wqiMetricsDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  wqiBigScoreWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  wqiBigScore: {
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1.5,
  },
  wqiScoreUnit: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    fontWeight: '600',
    marginLeft: 6,
  },
  wqiStatsMiniCol: {
    gap: 6,
  },
  miniStatItem: {
    alignItems: 'flex-end',
  },
  miniStatLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: THEME.colors.textMuted,
  },
  miniStatValue: {
    fontSize: 14,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
  },
  progressBarWrap: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  wqiNormNote: {
    fontSize: 9,
    color: THEME.colors.textSecondary,
    lineHeight: 14,
  },

  /* KPI ROW */
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 14,
    padding: 12,
  },
  kpiTag: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.textMuted,
    letterSpacing: 0.8,
  },
  kpiMain: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 8,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },

  /* SECCIONES Y ENCABEZADOS */
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: 0.8,
  },
  sectionSubtitle: {
    fontSize: 10,
    color: THEME.colors.textSecondary,
    marginTop: 1,
  },
  actionPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionPillText: {
    fontSize: 11,
    color: THEME.colors.cyan,
    fontWeight: '700',
  },

  /* STATION CARD */
  stationCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  stationCardAlert: {
    borderColor: 'rgba(255, 51, 102, 0.4)',
    borderLeftWidth: 4,
    borderLeftColor: THEME.colors.rose,
  },
  stationCardWarning: {
    borderColor: 'rgba(255, 183, 3, 0.4)',
    borderLeftWidth: 4,
    borderLeftColor: THEME.colors.amber,
  },
  stationCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  stationCardTitleCol: {
    flex: 1,
  },
  stationIdBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stationCardId: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
  },
  originBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  originBadgePhysical: {
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
  },
  originBadgeVirtual: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  originBadgeText: {
    fontSize: 7,
    fontWeight: '800',
    color: THEME.colors.cyan,
  },
  stationCardLocation: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusChipText: {
    fontSize: 8,
    fontWeight: '800',
  },
  cardMetricsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  metricCardMini: {
    flex: 1,
    backgroundColor: THEME.colors.bgInput,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  metricLabelMini: {
    fontSize: 7,
    fontWeight: '800',
    color: THEME.colors.textMuted,
    letterSpacing: 0.5,
  },
  metricValRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginVertical: 4,
  },
  metricValLarge: {
    fontSize: 20,
    fontWeight: '900',
  },
  metricValUnit: {
    fontSize: 10,
    color: THEME.colors.textSecondary,
    fontWeight: '600',
  },
  miniBar: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  stationCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingTop: 8,
  },
  footerInfoText: {
    fontSize: 10,
    color: THEME.colors.textSecondary,
  },
  footerTimeText: {
    fontSize: 9,
    color: THEME.colors.textMuted,
    fontWeight: '600',
  },

  /* EMPTY STATE */
  emptyContainer: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    marginVertical: 10,
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
  },
  emptyText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
    marginVertical: 8,
    lineHeight: 18,
  },
  primaryConnectBtn: {
    backgroundColor: THEME.colors.cyan,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  primaryConnectBtnText: {
    color: THEME.colors.bgDark,
    fontSize: 12,
    fontWeight: '800',
  },

  /* VISTAS GENÉRICAS */
  pageHeader: {
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
  },
  pageSubtitle: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },

  /* ANALYTICS / TERMINAL */
  analyticsContainer: {
    flex: 1,
    padding: 16,
  },
  terminalContainer: {
    flex: 1,
    backgroundColor: '#02050B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 12,
  },
  terminalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 8,
    marginBottom: 8,
  },
  terminalTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: THEME.colors.cyan,
    letterSpacing: 1,
  },
  terminalClearText: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    fontWeight: '700',
  },
  terminalScroll: {
    flex: 1,
  },
  terminalEmpty: {
    color: THEME.colors.textMuted,
    fontSize: 11,
    marginTop: 10,
    textAlign: 'center',
  },
  logRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 3,
  },
  logTime: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logText: {
    flex: 1,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  /* SETTINGS */
  settingsCard: {
    backgroundColor: THEME.colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 18,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: THEME.colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    backgroundColor: THEME.colors.bgInput,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 8,
    color: THEME.colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  presetChip: {
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.25)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  presetChipText: {
    fontSize: 9,
    color: THEME.colors.cyan,
    fontWeight: '700',
  },
  settingsActionsRow: {
    marginTop: 20,
  },
  btnAction: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActionConnect: {
    backgroundColor: THEME.colors.cyan,
  },
  btnActionDisconnect: {
    backgroundColor: 'rgba(255, 51, 102, 0.15)',
    borderWidth: 1,
    borderColor: THEME.colors.rose,
  },
  btnActionText: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.bgDark,
  },
  securityAuditBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    padding: 12,
    marginTop: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  securityAuditTitle: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.amber,
    letterSpacing: 1,
    marginBottom: 4,
  },
  securityAuditDesc: {
    fontSize: 9,
    color: THEME.colors.textSecondary,
    lineHeight: 15,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  /* MODAL */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: THEME.colors.bgCardElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.borderActive,
    padding: 20,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnText: {
    color: THEME.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  modalBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  modalBannerTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  modalBannerDesc: {
    fontSize: 10,
    color: THEME.colors.textPrimary,
    marginTop: 2,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  detailBox: {
    width: '48%',
    backgroundColor: THEME.colors.bgInput,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  detailBoxLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.textMuted,
  },
  detailBoxVal: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    marginVertical: 4,
  },
  detailBoxSub: {
    fontSize: 8,
    color: THEME.colors.textSecondary,
  },
  historySection: {
    backgroundColor: THEME.colors.bgInput,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  historyTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: THEME.colors.cyan,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  historyTime: {fontSize: 9, color: THEME.colors.textMuted},
  historyTurb: {fontSize: 9, fontWeight: '700', color: THEME.colors.textPrimary},
  historyTemp: {fontSize: 9, color: THEME.colors.cyan},
  historyVolt: {fontSize: 9, color: THEME.colors.textSecondary},

  /* TAB BAR INFERIOR */
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    backgroundColor: 'rgba(10, 19, 36, 0.95)',
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  tabIcon: {
    fontSize: 16,
    opacity: 0.6,
  },
  tabIconActive: {
    opacity: 1,
    transform: [{scale: 1.1}],
  },
  tabLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: THEME.colors.textMuted,
  },
  tabLabelActive: {
    color: THEME.colors.cyan,
  },

  /* HELPER COLORS */
  textCyan: {color: THEME.colors.cyan},
  textMint: {color: THEME.colors.mint},
  textAmber: {color: THEME.colors.amber},
  textRose: {color: THEME.colors.rose},
  textMuted: {color: THEME.colors.textMuted},
  bgMint: {backgroundColor: THEME.colors.mint},
  bgAmber: {backgroundColor: THEME.colors.amber},
  bgRose: {backgroundColor: THEME.colors.rose},
  unitSmall: {fontSize: 9, fontWeight: '500', color: THEME.colors.textSecondary},
});

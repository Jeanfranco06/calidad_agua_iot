import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import mqtt, {MqttClient} from 'mqtt';

type Device = {
  id: string; location: string; temperature?: number; turbidity?: number;
  calibrated: boolean; time: Date; source: 'lectura' | 'recepción'; health: string;
};
const TOPIC = 'cistern/+/telemetry';
const DEFAULT_BROKER = 'ws://172.16.40.157:8084/mqtt';
const fmt = (v?: number) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—';
const timeFmt = (d: Date) => {
  const pet = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return `${String(pet.getUTCHours()).padStart(2, '0')}:${String(pet.getUTCMinutes()).padStart(2, '0')}:${String(pet.getUTCSeconds()).padStart(2, '0')}`;
};

export default function App() {
  const [url, setUrl] = useState(DEFAULT_BROKER);
  const [username, setUsername] = useState('mobile_monitor');
  const [password, setPassword] = useState('');
  const [state, setState] = useState('Desconectado');
  const [client, setClient] = useState<MqttClient | null>(null);
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [error, setError] = useState('');
  const [received, setReceived] = useState(0);
  const connected = state === 'Conectado';
  const rows = useMemo(() => Object.values(devices).sort((a, b) => b.time.getTime() - a.time.getTime()), [devices]);

  useEffect(() => () => { client?.end(true); }, [client]);

  function disconnect() {
    client?.end(true);
    setClient(null); setState('Desconectado'); setPassword('');
  }
  function connect() {
    disconnect(); setError('');
    if (!url.trim() || !username.trim() || !password) { setError('Completa broker, usuario y contraseña.'); return; }
    setState('Conectando…');
    try {
      const next = mqtt.connect(url.trim(), {
        username: username.trim(), password, clientId: `agua_clara_${Math.random().toString(16).slice(2, 10)}`,
        protocolVersion: 4, clean: true, connectTimeout: 10000, reconnectPeriod: 3000,
        resubscribe: true, forceNativeWebSocket: true,
      } as any);
      setClient(next);
      next.on('connect', () => {
        setState('Conectado');
        next.subscribe(TOPIC, {qos: 1}, (err) => {
          if (err) { setError('EMQX rechazó la suscripción a telemetría.'); setState('Error de permisos'); }
        });
      });
      next.on('reconnect', () => setState('Reconectando…'));
      next.on('offline', () => setState('Sin conexión'));
      next.on('close', () => setState('Desconectado'));
      next.on('error', (e) => { setError(e.message || 'No se pudo conectar con el broker.'); setState('Error de conexión'); });
      next.on('message', (topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          const m = data.metrics || {};
          const calibrated = m.turbidity_calibrated === true;
          const timestamp = Number(data.timestamp);
          const hasTimestamp = Number.isFinite(timestamp) && timestamp > 0;
          const id = String(data.device_id || topic.split('/')[1] || 'dispositivo');
          const device: Device = {
            id, location: String(data.location || 'Ubicación no indicada'),
            temperature: m.temperature_c,
            turbidity: calibrated ? m.turbidity_ntu : (m.turbidity_estimated_ntu ?? m.turbidez_estimada),
            calibrated, time: hasTimestamp ? new Date(timestamp * 1000) : new Date(),
            source: hasTimestamp ? 'lectura' : 'recepción',
            health: String(data.hardware_health || 'Sin estado').replaceAll('_', ' '),
          };
          setDevices(old => ({...old, [id]: device})); setReceived(v => v + 1);
        } catch { setError('Se recibió un mensaje con formato inesperado.'); }
      });
    } catch (e: any) { setState('Error de conexión'); setError(e?.message || 'URL WebSocket inválida.'); }
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          <View style={s.topline}><View style={s.logo}><Text style={s.logoText}>AC</Text></View><Text style={s.brand}>AGUA CLARA  ·  IOT</Text><View style={s.live}><View style={[s.dot, connected && s.dotOn]} /><Text style={s.liveText}>{state.toUpperCase()}</Text></View></View>
          <Text style={s.eyebrow}>MONITOREO EN TIEMPO REAL</Text>
          <Text style={s.title}>Calidad del agua</Text>
          <Text style={s.subtitle}>Lecturas recibidas desde tus dispositivos</Text>
          <View style={s.summary}><View><Text style={s.label}>DISPOSITIVOS</Text><Text style={s.big}>{rows.length.toString().padStart(2, '0')}</Text></View><View style={s.summaryRight}><Text style={s.label}>MENSAJES RECIBIDOS</Text><Text style={s.medium}>{received}</Text></View></View>
          <View style={s.sectionHead}><Text style={s.section}>ESTACIONES</Text><Text style={s.muted}>{rows.length} {rows.length === 1 ? 'activa' : 'activas'}</Text></View>
          {rows.length === 0 ? <View style={s.empty}><Text style={s.emptyIcon}>◉</Text><Text style={s.emptyTitle}>Esperando lecturas</Text><Text style={s.muted}>Conéctate al broker para recibir telemetría.</Text></View> : <FlatList scrollEnabled={false} data={rows} keyExtractor={d => d.id} renderItem={({item}) => <View style={s.card}>
            <View style={s.cardTop}><View><Text style={s.device}>{item.id}</Text><Text style={s.location}>{item.location}</Text></View><Text style={s.health}>{item.health}</Text></View>
            <View style={s.metrics}><View style={s.metric}><Text style={s.label}>TEMPERATURA</Text><Text style={s.value}>{fmt(item.temperature)}<Text style={s.unit}> °C</Text></Text></View><View style={s.metric}><Text style={s.label}>{item.calibrated ? 'TURBIDEZ CALIBRADA' : 'TURBIDEZ ESTIMADA'}</Text><Text style={s.value}>{fmt(item.turbidity)}<Text style={s.unit}> NTU</Text></Text></View></View>
            <View style={s.last}><Text style={s.muted}>Última {item.source} · PET</Text><Text style={s.lastTime}>{timeFmt(item.time)}</Text></View>
          </View>} />}
          <View style={s.sectionHead}><Text style={s.section}>CONEXIÓN MQTT</Text><Pressable onPress={disconnect}><Text style={s.muted}>Desconectar</Text></Pressable></View>
          <View style={s.panel}>
            <Text style={s.fieldLabel}>Broker WebSocket</Text><TextInput value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="ws://IP:8084/mqtt" placeholderTextColor="#65808a" style={s.input} />
            <Text style={s.fieldLabel}>Usuario</Text><TextInput value={username} onChangeText={setUsername} autoCapitalize="none" placeholderTextColor="#65808a" style={s.input} />
            <Text style={s.fieldLabel}>Contraseña</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="Se usa solo en esta sesión" placeholderTextColor="#65808a" style={s.input} />
            {!!error && <Text style={s.error}>{error}</Text>}
            <Pressable onPress={connected ? disconnect : connect} style={[s.button, connected && s.buttonOff]}>{state === 'Conectando…' || state === 'Reconectando…' ? <ActivityIndicator color="#06212a" /> : <Text style={s.buttonText}>{connected ? 'Desconectar' : 'Conectar al broker'}</Text>}</Pressable>
            <Text style={s.note}>Suscripción de solo lectura: {TOPIC}{'\n'}Conexión local ws:// sin cifrado TLS.</Text>
          </View>
          <Text style={s.footer}>AGUA CLARA · MONITOREO RESPONSABLE</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#071a21'},flex:{flex:1},page:{padding:20,paddingBottom:36},topline:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:30},logo:{width:34,height:34,borderRadius:12,backgroundColor:'#73e0bc',alignItems:'center',justifyContent:'center'},logoText:{fontWeight:'900',color:'#08242a'},brand:{fontSize:11,fontWeight:'800',letterSpacing:1.5,color:'#d9eeec',flex:1},live:{flexDirection:'row',alignItems:'center',gap:7,backgroundColor:'#122c33',paddingHorizontal:10,paddingVertical:8,borderRadius:20},dot:{width:7,height:7,borderRadius:5,backgroundColor:'#e8aa61'},dotOn:{backgroundColor:'#73e0bc'},liveText:{fontSize:9,color:'#bcd0ce',fontWeight:'800'},eyebrow:{color:'#73e0bc',fontSize:10,fontWeight:'800',letterSpacing:2},title:{fontSize:30,fontWeight:'800',color:'#eff9f6',marginTop:7},subtitle:{fontSize:13,color:'#91aaa9',marginTop:5},summary:{marginTop:24,marginBottom:28,backgroundColor:'#102a31',borderColor:'#1b3d43',borderWidth:1,borderRadius:18,padding:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},summaryRight:{alignItems:'flex-end'},label:{fontSize:9,fontWeight:'800',letterSpacing:1.2,color:'#8ba4a2'},big:{fontSize:32,fontWeight:'800',color:'#eff9f6',marginTop:6},medium:{fontSize:22,fontWeight:'800',color:'#73e0bc',marginTop:6},sectionHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12,marginTop:4},section:{color:'#c3d9d6',fontSize:10,fontWeight:'800',letterSpacing:1.4},muted:{color:'#829c9d',fontSize:11},empty:{alignItems:'center',padding:30,backgroundColor:'#0d242b',borderRadius:16,borderWidth:1,borderColor:'#1b3d43',marginBottom:25},emptyIcon:{fontSize:25,color:'#73e0bc',marginBottom:10},emptyTitle:{fontSize:16,fontWeight:'700',color:'#eaf5f2',marginBottom:6},card:{backgroundColor:'#102a31',borderColor:'#1b3d43',borderWidth:1,borderRadius:17,padding:16,marginBottom:12},cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},device:{fontSize:16,color:'#edf7f4',fontWeight:'800'},location:{fontSize:11,color:'#8da8a6',marginTop:3},health:{color:'#73e0bc',fontSize:9,fontWeight:'700',textTransform:'uppercase'},metrics:{flexDirection:'row',gap:12,marginTop:20},metric:{flex:1,backgroundColor:'#0b2229',borderRadius:12,padding:12},value:{color:'#f1f8f5',fontSize:22,fontWeight:'800',marginTop:7},unit:{color:'#a0b7b4',fontSize:12,fontWeight:'500'},last:{borderTopWidth:1,borderTopColor:'#1b3d43',marginTop:14,paddingTop:11,flexDirection:'row',justifyContent:'space-between'},lastTime:{color:'#d5e9e5',fontWeight:'700',fontSize:11},panel:{backgroundColor:'#102a31',borderColor:'#1b3d43',borderWidth:1,borderRadius:17,padding:16,marginBottom:24},fieldLabel:{fontSize:11,color:'#b4cbc7',fontWeight:'700',marginTop:10,marginBottom:7},input:{backgroundColor:'#091e25',borderColor:'#25464c',borderWidth:1,borderRadius:10,color:'#eff9f6',paddingHorizontal:12,paddingVertical:11,fontSize:13},button:{alignItems:'center',justifyContent:'center',backgroundColor:'#73e0bc',borderRadius:11,padding:14,marginTop:16,minHeight:48},buttonOff:{backgroundColor:'#b2c3c0'},buttonText:{fontWeight:'900',color:'#08242a',fontSize:13},error:{color:'#ff9b89',fontSize:12,marginTop:10},note:{color:'#829c9d',fontSize:10,lineHeight:16,marginTop:13},footer:{textAlign:'center',fontSize:9,color:'#547177',letterSpacing:1.4},
});

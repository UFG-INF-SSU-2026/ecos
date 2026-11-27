import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { API_URL, ApiError, Device, EventPage, request, streamUrl, StudyEvent, User } from './src/api';

const KEY = 'ecos-session-v1';
const ranges = [ ['24 horas', '1'], ['7 dias', '7'], ['30 dias', '30'], ['Tudo', '0'] ];
const date = (value: string) => new Date(value).toLocaleString('pt-BR');
const message = (error: unknown) => error instanceof Error ? error.message : 'Falha de comunicação.';

type Session = { token: string; user: User };
export default function App() {
  return <SafeAreaProvider><SessionScreen /></SafeAreaProvider>;
}
function SessionScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(KEY);
        if (!stored) return;
        const saved = JSON.parse(stored);
        if (saved.api !== API_URL) return;
        const { user } = await request<{ user: User }>('/me', saved.token);
        if (mounted) setSession({ token: saved.token, user });
      } catch (e) { if (mounted) setError(message(e)); }
      finally { if (mounted) setRestoring(false); }
    })();
    return () => { mounted = false; };
  }, []);
  async function login() {
    setBusy(true); setError('');
    try {
      const result = await request<Session>('/auth/login', undefined, { email, password });
      await SecureStore.setItemAsync(KEY, JSON.stringify({ token: result.token, api: API_URL }));
      setSession(result); setPassword('');
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const clearSession = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY);
    setSession(null);
  }, []);
  async function logout() {
    try { if (session) await request('/auth/logout', session.token, {}); }
    catch (e) { Alert.alert('Saída neste aparelho', 'A sessão remota não pôde ser revogada. Ela expira em até 7 dias.'); }
    finally { await clearSession(); }
  }
  if (restoring) return <SafeAreaView style={s.center}><ActivityIndicator color="#186b50" /><Text>Restaurando sessão…</Text></SafeAreaView>;
  if (session) return <Dashboard session={session} onLogout={logout} onExpired={clearSession} />;
  return <SafeAreaView style={s.root}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={s.login} keyboardShouldPersistTaps="handled">
      <Text style={s.brand}>ECOS</Text><Text style={s.eyebrow}>SEU ESPAÇO DE ESTUDO, EM EQUILÍBRIO</Text>
      <Text style={s.title}>Uma pausa faz parte{ '\n' }do progresso.</Text>
      <Text style={s.muted}>Acompanhe sua mesa, controle o sensor e consulte suas pausas.</Text>
      <View style={s.card}><Text style={s.sectionTitle}>Entre na sua conta</Text>
        <Text style={s.label}>E-mail</Text><TextInput style={s.input} value={email} onChangeText={setEmail}
          autoCapitalize="none" autoComplete="email" keyboardType="email-address" accessibilityLabel="E-mail" />
        <Text style={s.label}>Senha</Text><TextInput style={s.input} value={password} onChangeText={setPassword}
          secureTextEntry autoComplete="current-password" accessibilityLabel="Senha" onSubmitEditing={login} />
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Button title={busy ? 'Entrando…' : 'Entrar'} onPress={login} disabled={busy || !email || !password} />
      </View><Text style={s.small}>Conta e dispositivo são cadastrados pelo administrador do projeto.</Text>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
function Dashboard({ session, onLogout, onExpired }: { session: Session; onLogout: () => void; onExpired: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<StudyEvent[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [days, setDays] = useState('7');
  const [cursor, setCursor] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [commandBusy, setCommandBusy] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const historical = useRef(false);
  const commandIds = useRef<Record<string, string>>({});
  const lastAlert = useRef<string | null>(null);
  const initialized = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const handleError = useCallback((e: unknown) => {
    if (!alive.current) return;
    if (e instanceof ApiError && e.status === 401) onExpired();
    else setError(message(e));
  }, [onExpired]);
  const query = useCallback(() => {
    const params = new URLSearchParams({ limit: '30' });
    if (deviceId) params.set('deviceId', deviceId);
    if (days !== '0') params.set('from', new Date(Date.now() - Number(days) * 86400000).toISOString());
    return params;
  }, [deviceId, days]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const [d, page] = await Promise.all([
        request<{ devices: Device[] }>('/devices', session.token),
        request<EventPage>(`/breaks?${query()}`, session.token),
      ]);
      if (!alive.current || current !== generation.current) return;
      setDevices(d.devices);
      for (const device of d.devices) delete commandIds.current[`${device.id}:${device.desiredEnabled}`];
      if (!historical.current) { setEvents(page.events); setCursor(page.nextCursor); }
      setError('');
    } catch (e) { if (current === generation.current) handleError(e); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [session.token, query, handleError]);
  useEffect(() => { historical.current = false; refresh(); }, [refresh]);
  useEffect(() => {
    let active = true;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let coalesce: ReturnType<typeof setTimeout> | undefined;
    let retry = 1000;
    async function notifyBreak() {
      try {
        const page = await request<EventPage>('/breaks?limit=1', session.token);
        if (!active) return;
        const newest = page.events[0];
        if (initialized.current && newest && newest.id !== lastAlert.current)
          Alert.alert('Hora da pausa', 'Levante-se, beba água e faça um lanche.');
        lastAlert.current = newest?.id || null; initialized.current = true;
      } catch (e) { handleError(e); }
    }
    function connect() {
      if (!active || AppState.currentState === 'background') return;
      socket = new WebSocket(streamUrl());
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'auth', token: session.token }));
      socket.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ready') { setConnected(true); retry = 1000; refresh(); notifyBreak(); }
          if (data.type === 'events.changed') {
            clearTimeout(coalesce);
            coalesce = setTimeout(() => { refresh(); notifyBreak(); }, 250);
          }
        } catch { /* REST recupera os eventos se houver quadro inválido. */ }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = event => {
        if (!active) return;
        setConnected(false);
        if (event.code === 1008) { onExpired(); return; }
        reconnect = setTimeout(connect, retry); retry = Math.min(retry * 2, 30000);
      };
    }
    connect();
    const poll = setInterval(refresh, 10000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
        if (!socket || socket.readyState === WebSocket.CLOSED) { clearTimeout(reconnect); connect(); }
      }
    });
    return () => { active = false; clearInterval(poll); clearTimeout(reconnect); clearTimeout(coalesce); subscription.remove(); socket?.close(); };
  }, [session.token, refresh, handleError, onExpired]);
  async function more() {
    if (!cursor || loading) return;
    const current = generation.current;
    setLoading(true);
    try {
      const params = query(); params.set('cursor', cursor);
      const page = await request<EventPage>(`/breaks?${params}`, session.token);
      if (!alive.current || current !== generation.current) return;
      historical.current = true;
      setEvents(previous => [...previous, ...page.events.filter(e => !previous.some(p => p.id === e.id))]);
      setCursor(page.nextCursor);
    } catch (e) { handleError(e); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }
  async function command(device: Device) {
    setCommandBusy(device.id);
    const enabled = !device.desiredEnabled;
    const key = `${device.id}:${enabled}`;
    commandIds.current[key] ||= Crypto.randomUUID();
    try {
      await request(`/devices/${encodeURIComponent(device.id)}/commands`, session.token,
        { enabled, commandId: commandIds.current[key] });
      delete commandIds.current[key];
      await refresh();
    } catch (e) { handleError(e); }
    finally { if (alive.current) setCommandBusy(''); }
  }
  function confirm(device: Device) {
    Alert.alert(device.desiredEnabled ? 'Desativar sensor?' : 'Ativar sensor?',
      'O comando será aplicado quando o ESP32 consultar a API. O estado do sensor será atualizado após a confirmação.',
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => command(device) }]);
  }
  return <SafeAreaView style={s.root}><FlatList data={events} keyExtractor={e => e.id} contentContainerStyle={s.content}
    refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { historical.current = false; refresh(); }} tintColor="#186b50" />}
    ListHeaderComponent={<>
      <View style={s.row}><Text style={s.brand}>ECOS</Text><Pressable onPress={onLogout} accessibilityRole="button"><Text style={s.link}>Sair</Text></Pressable></View>
      <Text style={s.eyebrow}>SEU COMPANHEIRO DE ESTUDO</Text>
      <Text style={s.title}>Olá, {session.user.name.split(' ')[0]}.</Text>
      <Text style={s.muted}>Cuide do seu ritmo. O restante fica registrado.</Text>
      <Text style={[s.connection, { color: connected ? '#186b50' : '#8b5b15' }]}>{connected ? '●  Atualizações em tempo real' : '●  Reconectando • atualização a cada 10 s'}</Text>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <Text style={s.sectionTitle}>Sua mesa</Text>
      {devices.length === 0 && <Text style={s.muted}>Nenhum dispositivo cadastrado nesta conta.</Text>}
      {devices.map(device => {
        const online = device.lastSeenAt && Date.now() - Date.parse(device.lastSeenAt) < 20000;
        return <View style={s.card} key={device.id}>
          <View style={s.row}><Text style={s.deviceName}>{device.name}</Text><Text style={s.tag}>{online ? 'ONLINE' : 'SEM CONEXÃO'}</Text></View>
          <Text style={s.small}>{device.id}</Text>
          <Text style={s.status}>{device.reportedEnabled === null ? 'Aguardando sensor' : device.reportedEnabled ? 'Sensor ativado' : 'Sensor desativado'}</Text>
          {device.pending && <Text style={s.pending}>Comando pendente: {device.desiredEnabled ? 'ativar' : 'desativar'}. Aguardando confirmação.</Text>}
          <Text style={s.small}>Último contato: {device.lastSeenAt ? date(device.lastSeenAt) : 'ainda não recebido'}</Text>
          <Button title={commandBusy === device.id ? 'Enviando…' : device.desiredEnabled ? 'Desativar sensor' : 'Ativar sensor'}
            onPress={() => confirm(device)} disabled={!!commandBusy} secondary={device.desiredEnabled} />
        </View>;
      })}
      <View style={s.row}><Text style={s.sectionTitle}>Histórico de pausas</Text><Text style={s.small}>POR USUÁRIO</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips}><Chip title="Todas as mesas" active={!deviceId} onPress={() => setDeviceId('')} />
        {devices.map(d => <Chip key={d.id} title={d.name} active={deviceId === d.id} onPress={() => setDeviceId(d.id)} />)}</ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips}>{ranges.map(([title, value]) =>
        <Chip key={title} title={title} active={days === value} onPress={() => setDays(value)} />)}</ScrollView>
    </>}
    renderItem={({ item }) => <View style={s.event}>
      <View style={s.eventDot} /><View style={s.flex}><Text style={s.eventTitle}>Hora da pausa para o lanche!</Text>
        <Text style={s.small}>{date(item.time)} · {item.deviceId}</Text>
      </View>
    </View>}
    ListEmptyComponent={<Text style={s.empty}>{loading ? 'Carregando pausas…' : 'Nenhuma pausa neste período.'}</Text>}
    ListFooterComponent={<View style={s.footer}>{cursor && <Button title="Carregar pausas anteriores" onPress={more} disabled={loading} secondary />}
      <Text style={s.small}>Horários no fuso deste aparelho. Arraste para atualizar.</Text></View>}
  /></SafeAreaView>;
}
function Button({ title, onPress, disabled, secondary }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[s.button, secondary && s.secondary, disabled && { opacity: 0.5 }]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text></Pressable>;
}
function Chip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[s.chip, active && s.chipActive]}>
    <Text style={active ? s.chipActiveText : s.small}>{title}</Text></Pressable>;
}
const s = StyleSheet.create({
  flex: { flex: 1 }, root: { flex: 1, backgroundColor: '#f5f5ef' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  content: { padding: 24, paddingBottom: 48 }, login: { padding: 28, paddingTop: 64, gap: 18 },
  brand: { fontSize: 27, fontWeight: '900', color: '#186b50', letterSpacing: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 1.7, fontWeight: '700', color: '#6b766c', marginTop: 16 },
  title: { fontSize: 34, lineHeight: 41, letterSpacing: -1.2, fontWeight: '700', color: '#20382f', marginVertical: 14 },
  muted: { fontSize: 14, lineHeight: 22, color: '#657268' }, small: { fontSize: 11, lineHeight: 18, color: '#6c786e' },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 21, marginVertical: 12, borderWidth: 1, borderColor: '#e0e6dc', gap: 9 },
  label: { fontSize: 13, color: '#20382f', marginTop: 12 }, input: { borderWidth: 1, borderColor: '#d3ddd0', borderRadius: 10, padding: 14, fontSize: 16, color: '#20382f' },
  button: { backgroundColor: '#186b50', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 }, secondary: { backgroundColor: '#edf3eb', borderWidth: 1, borderColor: '#d0decf' }, secondaryText: { color: '#186b50' },
  sectionTitle: { color: '#20382f', fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, link: { color: '#186b50', padding: 10 },
  connection: { fontSize: 12, marginVertical: 20 }, deviceName: { fontSize: 17, fontWeight: '600', color: '#20382f', flex: 1 },
  tag: { fontSize: 9, letterSpacing: 1, color: '#657268' }, status: { fontSize: 23, color: '#20382f', fontWeight: '600', marginTop: 8 },
  pending: { fontSize: 12, lineHeight: 18, color: '#8b5b15' }, error: { color: '#a02f2f', backgroundColor: '#fceaea', padding: 12, borderRadius: 8, fontSize: 13 },
  chips: { marginVertical: 5 }, chip: { paddingHorizontal: 14, paddingVertical: 9, marginRight: 8, borderRadius: 24, borderWidth: 1, borderColor: '#d8e0d3' },
  chipActive: { backgroundColor: '#20382f', borderColor: '#20382f' }, chipActiveText: { color: '#fff', fontSize: 11, lineHeight: 18 },
  event: { flexDirection: 'row', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#e0e6dc' },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6f9e78', marginTop: 6 },
  eventTitle: { fontSize: 14, fontWeight: '600', color: '#20382f', marginBottom: 4 },
  empty: { paddingVertical: 40, color: '#6c786e', textAlign: 'center' }, footer: { gap: 24, paddingTop: 18 },
});

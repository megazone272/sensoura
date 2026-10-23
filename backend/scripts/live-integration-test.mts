/**
 * Live integration test (run with the backend server UP on :3000).
 * Tests the REAL Firebase RTDB (service account) and REAL Socket.IO flow.
 *
 *   npx tsx scripts/live-integration-test.mts
 *
 * Exit code 0 = all checks passed.
 */
import { cert, initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { io as ioc, type Socket } from 'socket.io-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const section = (s: string) => console.log(`\n=== ${s} ===`);

async function main() {
  // ------------------------------------------------------------------
  section('1. Firebase RTDB — init with real service account');
  // ------------------------------------------------------------------
  const keyPath = join(ROOT, 'serviceAccountKey.json');
  ok('serviceAccountKey.json exists', existsSync(keyPath));
  const sa = JSON.parse(readFileSync(keyPath, 'utf-8'));
  const app: App = initializeApp(
    { credential: cert(sa), databaseURL: 'https://on-an-official-team-default-rtdb.europe-west1.firebasedatabase.app' },
    'live-test'
  );
  const db = getDatabase(app);
  ok('firebase-admin initialized', !!db);

  // ------------------------------------------------------------------
  section('2. Firebase RTDB — READ live sensor data');
  // ------------------------------------------------------------------
  const snap = await db.ref('/Sensoura/sensorData').get();
  ok('GET /Sensoura/sensorData exists', snap.exists());
  const sensor = snap.val() as Record<string, unknown> | null;
  ok('temperature is number', typeof sensor?.AirTemp === 'number', `got ${sensor?.AirTemp}`);
  ok('humidity is number', typeof sensor?.AirHumidity === 'number', `got ${sensor?.AirHumidity}`);
  console.log('        sensorData snapshot:', JSON.stringify(sensor)?.slice(0, 160));

  const sysSnap = await db.ref('/Sensoura/system').get();
  ok('GET /Sensoura/system exists', sysSnap.exists());
  console.log('        system snapshot:', JSON.stringify(sysSnap.val())?.slice(0, 160));

  // ------------------------------------------------------------------
  section('3. Firebase RTDB — WRITE / READ-BACK / DELETE test node');
  // ------------------------------------------------------------------
  const testPath = '/Sensoura/liveIntegrationTest';
  const marker = { value: Date.now(), source: 'live-integration-test' };
  await db.ref(testPath).set(marker);
  const readBack = await db.ref(testPath).get();
  ok('write then read-back matches', readBack.val()?.value === marker.value, JSON.stringify(readBack.val()));
  await db.ref(testPath).remove();
  const afterDelete = await db.ref(testPath).get();
  ok('cleanup delete worked', !afterDelete.exists());

  // ------------------------------------------------------------------
  section('4. Backend listener pickup — suggestion written to RTDB appears in backend API');
  // ------------------------------------------------------------------
  const sugPath = '/Sensoura/aiSuggestions/live_test_suggestion';
  const suggestion = {
    type: 'optimization',
    suggestion: 'Live integration test suggestion',
    reason: 'Automated end-to-end test',
    recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
    status: 'pending',
    requiresApproval: true,
    confidence: 0.99,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60_000,
  };
  await db.ref(sugPath).set(suggestion);

  let seenByBackend = false;
  for (let i = 0; i < 15 && !seenByBackend; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch('http://localhost:3000/api/ai-suggestions');
    const body = (await res.json()) as Record<string, unknown>;
    seenByBackend = !!body?.live_test_suggestion;
  }
  ok('backend /api/ai-suggestions sees the suggestion written directly to RTDB', seenByBackend);

  // ------------------------------------------------------------------
  section('5. HTTP approve flow — backend approves and auto-executes command');
  // ------------------------------------------------------------------
  const approveRes = await fetch('http://localhost:3000/api/ai-suggestions/live_test_suggestion/approve', { method: 'POST' });
  ok('POST approve -> 200', approveRes.status === 200, `got ${approveRes.status}`);
  const sugAfter = (await db.ref(sugPath).get()).val();
  ok('RTDB shows suggestion status executed', sugAfter?.status === 'executed', `status=${sugAfter?.status}`);

  // command the approve triggered should exist in RTDB commands
  const cmdSnap = await db.ref('/Sensoura/commands').get();
  const cmds = (cmdSnap.val() ?? {}) as Record<string, { target?: string; action?: string }>;
  const autoCmd = Object.values(cmds).find((c) => c.target === 'pump' && c.action === 'ON');
  ok('auto-executed pump ON command written to RTDB', !!autoCmd);

  // cleanup suggestion node
  await db.ref(sugPath).remove();

  // ------------------------------------------------------------------
  section('6. Socket.IO — connect, receive init state, realtime broadcast');
  // ------------------------------------------------------------------
  const socket: Socket = ioc('http://localhost:3000', { transports: ['websocket'], timeout: 8000 });
  const connected = await new Promise<boolean>((resolve) => {
    socket.on('connect', () => resolve(true));
    socket.on('connect_error', () => resolve(false));
    setTimeout(() => resolve(socket.connected), 8000);
  });
  ok('socket connects to backend', connected, socket.id ?? '');

  // The server emits 'init' with the full state on connection.
  const initialState = await new Promise<Record<string, unknown> | null>((resolve) => {
    socket.on('init', (s) => resolve(s));
    setTimeout(() => resolve(null), 5000);
  });
  ok('received init with sensorData', !!(initialState && (initialState as any).sensorData));
  if (initialState) {
    console.log('        socket sensorData:', JSON.stringify((initialState as any).sensorData)?.slice(0, 140));
  }

  // Trigger the full pipeline: write sensorData to RTDB -> backend listener
  // -> socket broadcast to this client.
  const liveData = (snap.val() as Record<string, unknown>);
  const broadcastSeen = new Promise<boolean>((resolve) => {
    socket.on('sensorData', (payload: { sensorData?: { AirTemp?: number } } | null) => resolve(!!payload?.sensorData?.AirTemp));
    setTimeout(() => resolve(false), 10_000);
  });
  await db.ref('/Sensoura/sensorData').update({
    ...liveData,
    Light: (typeof liveData.Light === 'number' ? liveData.Light : 700) + 1,
    lastUpdate: Date.now(),
  });
  ok('Firebase write -> backend listener -> socket sensorData broadcast', await broadcastSeen);

  const cmdAck = await new Promise<{ success?: boolean; commandId?: string; error?: string } | null>((resolve) => {
    socket.timeout(8000).emit('command', { target: 'pump', action: 'OFF', mode: 'MANUAL' }, (err: unknown, res: unknown) => {
      resolve(err ? null : (res as { success?: boolean; commandId?: string; error?: string }));
    });
  });
  ok('socket command ack success', !!cmdAck?.success, JSON.stringify(cmdAck));
  ok('ack returned commandId', typeof cmdAck?.commandId === 'string' && cmdAck.commandId.length > 0, JSON.stringify(cmdAck));

  // Invalid commands must be rejected by the socket path too (same zod
  // validation as the HTTP route).
  const badAck = await new Promise<{ success?: boolean; error?: string } | null>((resolve) => {
    socket.timeout(8000).emit('command', { target: 'nope', action: 'nope' }, (err: unknown, res: unknown) => {
      resolve(err ? null : (res as { success?: boolean; error?: string }));
    });
  });
  ok('invalid socket command rejected with error', badAck !== null && badAck.success === false, JSON.stringify(badAck));

  // ------------------------------------------------------------------
  section('7. Device round-trip — command in RTDB, device ack flows back');
  // ------------------------------------------------------------------
  const rtCmdSnap = await db.ref('/Sensoura/commands').get();
  const rtCmds = (rtCmdSnap.val() ?? {}) as Record<string, unknown>;
  ok('socket command visible in RTDB /Sensoura/commands', !!(cmdAck?.commandId && rtCmds[cmdAck.commandId]));

  // Simulate the ESP32 device acknowledging the command. The backend wraps
  // updates as { commandResults: {...} } (see realtimeService.notify).
  const resultSeen = new Promise<boolean>((resolve) => {
    socket.on('commandResults', (payload: { commandResults?: Record<string, { commandId?: string }> } | null) => {
      const record = payload?.commandResults ?? {};
      if (cmdAck?.commandId && Object.values(record).some((x) => x.commandId === cmdAck.commandId)) resolve(true);
    });
    setTimeout(() => resolve(false), 10_000);
  });
  await db.ref(`/Sensoura/commandResults/${cmdAck?.commandId}`).set({
    commandId: cmdAck?.commandId,
    status: 'executed',
    target: 'pump',
    requestedAction: 'OFF',
    actualState: 'OFF',
    message: 'Device acknowledged (simulated by integration test)',
    timestamp: Date.now(),
  });
  ok('simulated device ack broadcast to socket (commandResults)', await resultSeen);

  socket.disconnect();

  await deleteApp(app);

  console.log(`\n==============================`);
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  console.log(`==============================`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

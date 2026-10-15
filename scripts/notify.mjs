/* 이번 주 미점검 장비를 확인해 웹 푸시(FCM)로 알림을 보냅니다.
   환경변수:
     FIREBASE_SERVICE_ACCOUNT  서비스 계정 JSON 전체 (GitHub Secret)
     SITE_URL                  알림 클릭 시 열 주소 (예: https://example.web.app)
     DRY_RUN=1                 실제 발송 없이 결과만 출력
*/
import admin from 'firebase-admin';

const EQUIPMENT = [
  ...Array.from({ length: 6 }, (_, i) => `HPLC #${i + 1}`),
  'Prep HPLC', 'LC-MS',
  'GC #1', 'GC #2', 'GC-MS',
  'Moisture meter', 'Oven Karl Fischer', 'Karl Fischer (Volumetric)',
  'Balance (Oven KF)', 'Analytical balance', '초순수제조기',
].map((name, i) => ({ id: 'eq' + String(i + 1).padStart(2, '0'), name }));

/* 사이트와 동일한 ISO 주차 (월요일 시작), 한국 시간 기준 */
function weekKeyKST(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  const t = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT 가 설정되지 않았어요'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
const db = admin.firestore();

const week = weekKeyKST();
const snap = await db.collection('inspections').where('week', '==', week).get();
const done = new Set(snap.docs.map(d => d.data().equipId));
const missing = EQUIPMENT.filter(e => !done.has(e.id));
console.log(`[${week}] 점검 완료 ${EQUIPMENT.length - missing.length}/${EQUIPMENT.length}, 미점검 ${missing.length}대`);

if (!missing.length) { console.log('모두 완료됐어요. 알림을 보내지 않습니다.'); process.exit(0); }

const tokenSnap = await db.collection('pushTokens').get();
const tokens = tokenSnap.docs.map(d => d.id);
if (!tokens.length) { console.log('등록된 알림 기기가 없어요.'); process.exit(0); }

const names = missing.map(e => e.name);
const body = names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} 외 ${names.length - 4}대`;
const title = `⚠️ 이번 주 미점검 장비 ${missing.length}대`;
const url = process.env.SITE_URL || '/';
console.log(title, '|', body, `| 대상 기기 ${tokens.length}개`);
if (process.env.DRY_RUN) { console.log('DRY_RUN: 발송하지 않았어요.'); process.exit(0); }

const res = await admin.messaging().sendEachForMulticast({
  tokens,
  notification: { title, body },
  data: { url },
  webpush: { fcmOptions: { link: url }, notification: { icon: '/icons/icon-192.png', tag: `weekly-${week}` } },
});
console.log(`발송 성공 ${res.successCount}, 실패 ${res.failureCount}`);

/* 만료·해지된 토큰 정리 */
const dead = [];
res.responses.forEach((r, i) => {
  const code = r.error?.code;
  if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(tokens[i]);
  else if (r.error) console.warn('발송 오류:', code);
});
await Promise.all(dead.map(t => db.collection('pushTokens').doc(t).delete()));
if (dead.length) console.log(`만료된 토큰 ${dead.length}개 삭제`);

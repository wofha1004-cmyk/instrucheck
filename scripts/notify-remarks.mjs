/* 장비 "특이사항"이 새로 등록·수정되면 등록된 기기로 웹 푸시(FCM)를 보냅니다.
   index.html 이 특이사항을 저장할 때 equipInfo/{장비ID} 문서에 remarkPending: true 를 남기고,
   이 스크립트가 그 표시를 찾아 발송한 뒤 remarkPending 을 false 로 바꿉니다.
   환경변수:
     FIREBASE_SERVICE_ACCOUNT  서비스 계정 JSON 전체 (GitHub Secret)
     SITE_URL                  알림 클릭 시 열 주소
     DRY_RUN=1                 실제 발송 없이 결과만 출력
*/
import admin from 'firebase-admin';
import { EQUIPMENT } from './equipment.mjs';

const SKIP_AUTHOR = false;   // false: 특이사항을 쓴 본인 기기에도 발송 (본인 제외하려면 true)

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT 가 설정되지 않았어요'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
const db = admin.firestore();

const pending = await db.collection('equipInfo').where('remarkPending', '==', true).get();
if (pending.empty) { console.log('새 특이사항이 없어요.'); process.exit(0); }

const tokenSnap = await db.collection('pushTokens').get();
const allTokens = tokenSnap.docs.map(d => ({ token: d.id, email: d.data().email }));
const url = process.env.SITE_URL || '/';
const isDead = code => code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
const deadTokens = new Set();

for (const doc of pending.docs) {
  const d = doc.data();
  const equip = EQUIPMENT.find(e => e.id === (d.equipId || doc.id));
  const name = equip ? equip.name : (d.equipId || doc.id);
  const remark = (d.remark || '').trim();
  const targets = allTokens.filter(t => !(SKIP_AUTHOR && d.remarkByEmail && t.email === d.remarkByEmail)).map(t => t.token);
  console.log(`[${name}] 특이사항: ${remark} | 작성 ${d.remarkBy || '-'} | 대상 기기 ${targets.length}개`);
  if (process.env.DRY_RUN) continue;

  let clear = true;
  if (remark && targets.length) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: targets,
      notification: {
        title: `📝 ${name} 특이사항`,
        body: d.remarkBy ? `${remark} (${d.remarkBy})` : remark,
      },
      data: { url },
      webpush: { fcmOptions: { link: url }, notification: { icon: '/icons/icon-192.png', tag: `remark-${doc.id}` } },
    });
    console.log(`  발송 성공 ${res.successCount}, 실패 ${res.failureCount}`);
    res.responses.forEach((r, i) => {
      if (r.error && isDead(r.error.code)) deadTokens.add(targets[i]);
      else if (r.error) console.warn('  발송 오류:', r.error.code);
    });
    // 전부 일시 오류로 실패했으면 표시를 남겨 다음 실행 때 다시 시도
    if (res.successCount === 0 && res.responses.some(r => r.error && !isDead(r.error.code))) clear = false;
  }

  if (clear) {
    // 읽은 뒤 그 사이에 또 수정되지 않았을 때만 표시 해제 (새 수정은 다음 실행에서 처리)
    await db.runTransaction(async t => {
      const cur = await t.get(doc.ref);
      if (cur.exists && cur.get('remarkAt') === d.remarkAt) t.update(doc.ref, { remarkPending: false });
    });
  }
}

await Promise.all([...deadTokens].map(t => db.collection('pushTokens').doc(t).delete()));
if (deadTokens.size) console.log(`만료된 토큰 ${deadTokens.size}개 삭제`);

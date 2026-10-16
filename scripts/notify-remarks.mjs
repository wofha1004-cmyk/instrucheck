/* 장비 "특이사항"이 새로 등록·수정되면 웹 푸시(FCM)와 이메일로 알립니다.
   index.html 이 특이사항을 저장할 때 equipInfo/{장비ID} 문서에 remarkPending: true 를 남기고,
   이 스크립트가 그 표시를 찾아 발송한 뒤 remarkPending 을 false 로 바꿉니다.
   환경변수:
     FIREBASE_SERVICE_ACCOUNT  서비스 계정 JSON 전체 (GitHub Secret)
     SITE_URL                  알림 클릭 시 열 주소
     SMTP_HOST / SMTP_PORT     메일 서버 (예: smtp.gmail.com / 465)
     SMTP_USER / SMTP_PASS     메일 발송 계정 / 비밀번호(앱 비밀번호)  (GitHub Secret)
     MAIL_FROM                 보내는 사람 표시 (생략하면 SMTP_USER)
     MAIL_TO                   받는 사람 (쉼표 구분, 생략하면 아래 DEFAULT_MAIL_TO)
     DRY_RUN=1                 실제 발송 없이 결과만 출력
*/
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { EQUIPMENT } from './equipment.mjs';

const SKIP_AUTHOR = false;   // false: 특이사항을 쓴 본인에게도 발송 (본인 제외하려면 true)

/* 이메일 수신자 — firestore.rules 의 허용 계정과 동일. 사용자가 늘면 여기(또는 MAIL_TO)에 추가하세요. */
const DEFAULT_MAIL_TO = ['joyjeon@farmhannong.com', 'jaiha@farmhannong.com'];
const mailTo = (process.env.MAIL_TO || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const MAIL_RECIPIENTS = mailTo.length ? mailTo : DEFAULT_MAIL_TO;

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

/* 메일 발송 준비 (SMTP 설정이 없으면 메일은 건너뜀) */
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
const mailReady = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const transporter = mailReady
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 465,
      secure: (Number(SMTP_PORT) || 465) === 465,   // 465 = SSL, 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;
if (!mailReady) console.log('SMTP 설정이 없어 이메일은 보내지 않아요 (푸시만 발송).');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mailContent(name, remark, by, at) {
  const when = new Date(at || Date.now()).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  const link = /^https?:\/\//.test(url) ? url : '';
  return {
    subject: `[장비 특이사항] ${name}`,
    text: `${name} 장비의 특이사항이 등록·수정되었습니다.\n\n특이사항: ${remark}\n작성자: ${by || '-'}\n시각: ${when}\n${link ? `\n앱 열기: ${link}\n` : ''}`,
    html: `<div style="font-family:-apple-system,'Segoe UI','Malgun Gothic',sans-serif;max-width:480px;color:#191F28">
  <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#3182F6">공정기술팀 · 주간 장비 점검</p>
  <h2 style="margin:0 0 16px;font-size:20px">📝 ${esc(name)} 특이사항</h2>
  <div style="padding:14px 16px;border-radius:14px;background:#FFECEE;color:#D6303F;font-size:16px;font-weight:700;line-height:1.5">${esc(remark)}</div>
  <p style="margin:14px 0 0;font-size:13px;color:#6B7684">작성자 ${esc(by || '-')} · ${esc(when)}</p>
  ${link ? `<p style="margin:18px 0 0"><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;border-radius:12px;background:#3182F6;color:#fff;text-decoration:none;font-weight:700;font-size:14px">앱 열기</a></p>` : ''}
</div>`,
  };
}

for (const doc of pending.docs) {
  const d = doc.data();
  const equip = EQUIPMENT.find(e => e.id === (d.equipId || doc.id));
  const name = equip ? equip.name : (d.equipId || doc.id);
  const remark = (d.remark || '').trim();
  const author = (d.remarkByEmail || '').toLowerCase();
  const targets = allTokens.filter(t => !(SKIP_AUTHOR && author && t.email === d.remarkByEmail)).map(t => t.token);
  const mailTargets = MAIL_RECIPIENTS.filter(m => !(SKIP_AUTHOR && author && m === author));
  console.log(`[${name}] 특이사항: ${remark} | 작성 ${d.remarkBy || '-'} | 푸시 ${targets.length}개 · 메일 ${mailReady ? mailTargets.join(', ') || '없음' : '(SMTP 미설정)'}`);
  if (process.env.DRY_RUN) continue;

  /* 채널별로 이미 보낸 건(같은 remarkAt)은 재시도 때 다시 보내지 않음 */
  const pushDone = d.remarkPushAt === d.remarkAt;
  const mailDone = d.remarkMailAt === d.remarkAt;
  let clear = true;

  /* 1) 웹 푸시 */
  if (remark && targets.length && !pushDone) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: targets,
      notification: {
        title: `📝 ${name} 특이사항`,
        body: d.remarkBy ? `${remark} (${d.remarkBy})` : remark,
      },
      data: { url },
      webpush: { fcmOptions: { link: url }, notification: { icon: '/icons/icon-192.png', tag: `remark-${doc.id}` } },
    });
    console.log(`  푸시 성공 ${res.successCount}, 실패 ${res.failureCount}`);
    res.responses.forEach((r, i) => {
      if (r.error && isDead(r.error.code)) deadTokens.add(targets[i]);
      else if (r.error) console.warn('  푸시 오류:', r.error.code);
    });
    if (res.successCount > 0) await doc.ref.update({ remarkPushAt: d.remarkAt });
    // 전부 일시 오류로 실패했으면 표시를 남겨 다음 실행 때 다시 시도
    else if (res.responses.some(r => r.error && !isDead(r.error.code))) clear = false;
  }

  /* 2) 이메일 (수신자 전원에게, 서로의 주소가 보이지 않도록 개별 발송) */
  if (remark && mailReady && mailTargets.length && !mailDone) {
    const { subject, text, html } = mailContent(name, remark, d.remarkBy, d.remarkAt);
    const results = await Promise.allSettled(mailTargets.map(to =>
      transporter.sendMail({ from: MAIL_FROM || SMTP_USER, to, subject, text, html })));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    console.log(`  메일 성공 ${ok}, 실패 ${results.length - ok}`);
    results.forEach((r, i) => { if (r.status === 'rejected') console.warn(`  메일 오류 (${mailTargets[i]}):`, r.reason?.message || r.reason); });
    if (ok > 0) await doc.ref.update({ remarkMailAt: d.remarkAt });
    else clear = false;   // 전부 실패 → 다음 실행 때 재시도
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

# 주간 장비 점검

이 폴더에서 `firebase deploy` 를 실행하면 사이트와 Firestore 규칙이 한 번에 업데이트됩니다.

## 폴더 구조

```
equipment-check/
├─ public/                         ← 사이트 (Firebase Hosting 배포 폴더)
│  ├─ index.html                   (🔔 알림 켜기 + VAPID 키 포함)
│  ├─ sw.js                        (기존 PWA 서비스워커, 변경 없음)
│  ├─ manifest.webmanifest         (기존, 변경 없음)
│  ├─ firebase-messaging-sw.js     (신규: 백그라운드 푸시 수신)
│  └─ icons/                       (기존 아이콘 4종)
├─ firestore.rules                 (inspections + pushTokens 규칙)
├─ firebase.json / .firebaserc     (배포 설정, 프로젝트: instrument-check-1748b)
├─ scripts/equipment.mjs           (장비 목록 — 알림 스크립트 공용)
├─ scripts/notify.mjs              (수요일 미점검 확인 + 푸시 발송)
├─ scripts/notify-remarks.mjs      (신규: 특이사항 새로 등록·수정 시 푸시 발송)
├─ .github/workflows/weekly-reminder.yml   (매주 수요일 17:00 KST 자동 실행)
├─ .github/workflows/remark-notify.yml     (신규: 평일 09~20시 15분마다 새 특이사항 확인)
└─ package.json                    (notify.mjs 용 의존성)
```

## 배포 (업데이트할 때마다)

```
firebase deploy
```

사이트(`public/`)와 Firestore 규칙(`firestore.rules`)이 함께 반영됩니다.
일부만 올리려면 `firebase deploy --only hosting` 또는 `--only firestore:rules`.

## 푸시 알림 설정 (처음 한 번)

GitHub 에 이 폴더 전체를 올린 뒤:

- Settings → Secrets and variables → Actions → **Secrets**: `FIREBASE_SERVICE_ACCOUNT` (서비스 계정 JSON 전체)
- 같은 화면 → **Variables**: `SITE_URL` (배포된 사이트 주소, `https://` 포함)

담당자는 각자 폰에서 로그인 → 🔔 알림 켜기 → 허용.
(아이폰은 사파리에서 "홈 화면에 추가"한 앱에서만 동작, iOS 16.4 이상)

테스트: GitHub → Actions → "주간 장비 점검 알림" → Run workflow
(`dry_run` 을 켜면 발송 없이 미점검 대수만 확인)

## 장비를 추가하거나 이름을 바꿀 때

`public/index.html` 의 `EQUIPMENT` 와 `scripts/equipment.mjs` 를 **둘 다** 같게 수정하세요.

## 특이사항 푸시 알림

장비 카드에서 특이사항을 새로 등록하거나 내용을 바꿔 저장하면, 평일 09~20시 사이 최대 15분 안에
등록된 기기로 "📝 장비명 특이사항" 알림이 갑니다 (작성한 본인 기기 포함 — 제외하려면 `notify-remarks.mjs` 의 `SKIP_AUTHOR` 를 true 로).
내용이 그대로면 알리지 않고, 삭제할 때도 알리지 않습니다.

### 이메일 알림 (푸시와 함께 발송)

같은 시점에 `@farmhannong.com` 수신자 전원에게 "[장비 특이사항] 장비명" 메일도 갑니다.
수신자 기본값은 `notify-remarks.mjs` 의 `DEFAULT_MAIL_TO` (= 로그인 허용 계정 2명).
사용자가 늘면 그 목록을 고치거나, GitHub **Variables** 에 `MAIL_TO` (쉼표로 구분)를 넣으세요.

GitHub → Settings → Secrets and variables → Actions 에 추가:

- **Secrets**: `SMTP_HOST`, `SMTP_PORT`(465 또는 587), `SMTP_USER`, `SMTP_PASS`
- **Variables** (선택): `MAIL_FROM` (예: `장비점검 <발송계정@도메인>`), `MAIL_TO`

SMTP 설정이 비어 있으면 메일은 건너뛰고 푸시만 발송합니다.
발송 계정 예시: Google Workspace 라면 전용 계정 + 앱 비밀번호(`smtp.gmail.com`, 465),
Microsoft 365 라면 `smtp.office365.com`, 587 (SMTP AUTH 허용 필요). 회사 정책은 IT 담당자에게 확인하세요.
테스트: GitHub → Actions → "장비 특이사항 알림" → Run workflow (`dry_run` 을 켜면 발송 없이 대상만 확인)

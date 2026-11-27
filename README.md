# PBO Watcher

Google Sheets의 시장별 탭에서 종목 목록을 읽어 시세와 거래량을 보여주는 정적 웹페이지입니다. 한국 종목은 Naver 증권에서, 미국·일본·중국 종목은 Yahoo Finance에서 업종을 자동 조회해 종목명 옆에 표시합니다.

## 실행

`index.html`을 브라우저에서 열거나, VS Code의 Live Server 같은 정적 서버로 실행하세요. 페이지는 공개된 Google Sheets XLSX 내보내기와 SheetJS CDN을 사용합니다.

원본 시트가 비공개로 바뀌거나 XLSX 내보내기가 차단되면 목록을 읽을 수 없습니다.

## 텔레그램 예약 발송 (Cloudflare Workers)

Worker는 예약 시각을 처리할 때만 실행됩니다. Cron은 UTC 기준으로 평일(Cloudflare 요일 값 2-6) 하루 최대 12회 실행되며, 미국 장 시간은 서머타임 전환을 위해 가능한 UTC 시각도 확인합니다. 한국·일본·중국은 한국시간 10:00, 13:00, 15:00, 15:15에 묶어서 보내며, 미국은 뉴욕시간 10:00(개장 30분 후), 15:50(종료 10분 전), 16:30(종료 30분 후)에 보냅니다. 거래소 휴장일은 별도로 판별하지 않습니다. Telegram Webhook으로 `/sendnow`를 즉시 접수하고, Cloudflare Queue가 종목 조회 배치를 이어 처리합니다. 양수 등락률 종목만 메타데이터를 조회하며, 종가-저가 조건 확인이 필요한 종목과 일본 시세 등락률 계산에는 차트 데이터를 요청합니다.

예약 및 수동 발송 모두 일봉·주봉·월봉을 구분합니다. 각 시트에서 굵게 표시된 포커스 종목 중 **해당 기간 등락률 2% 이상 또는 (종가-저가 2% 이상, 해당 기간 등락률 양수, 현재 종가가 전일 고가 이상)** 인 종목만 포함합니다. 일본 일봉·주봉·월봉은 Yahoo Finance의 최신 시세로 계산해 오늘 등락을 반영합니다. 종목은 해당 기간 등락률이 높은 순으로 표시하며, 업종은 종목명 옆에 표시합니다. 종가-저가 비율은 필터에만 사용하고 메시지에는 표시하지 않습니다. 현재 공유 소스가 게시된 시트인 경우에는 게시 시트에서 굵은 스타일을 읽으며, XLSX 소스는 셀 스타일을 읽습니다. 예약 발송을 사용하려면 텔레그램 봇과 수신 채팅을 준비하고 Worker에 비밀 변수를 등록한 뒤 배포하세요.

```sh
npx wrangler queues create pbo-watcher-notifications
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler deploy
```

배포 후 Telegram Bot API의 `setWebhook`을 호출해 `https://<WORKER_DOMAIN>/api/telegram-webhook`을 등록하고, `secret_token`에는 Worker에 등록한 `TELEGRAM_WEBHOOK_SECRET`과 같은 값을 사용하세요. 예:

```sh
curl.exe -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<WORKER_DOMAIN>/api/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

봇을 수신 채팅에 추가하고 메시지를 보낼 수 있는 권한이 있어야 합니다. `wrangler.toml`의 예약 시각 Cron Trigger와 Queue 설정이 함께 활성화됩니다.

봇 채팅에서 `/sendnow`를 보내면 Webhook이 명령을 접수하고 Queue가 제한된 배치로 조회를 이어갑니다. 등록된 `TELEGRAM_CHAT_ID`의 명령만 처리합니다.

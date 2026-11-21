# PBO Watcher

Google Sheets의 시장별 탭에서 종목 목록을 읽어 시세와 거래량을 보여주는 정적 웹페이지입니다. 한국 종목은 Naver 증권에서, 미국·일본·중국 종목은 Yahoo Finance에서 업종을 자동 조회해 종목명 옆에 표시합니다.

## 실행

`index.html`을 브라우저에서 열거나, VS Code의 Live Server 같은 정적 서버로 실행하세요. 페이지는 공개된 Google Sheets XLSX 내보내기와 SheetJS CDN을 사용합니다.

원본 시트가 비공개로 바뀌거나 XLSX 내보내기가 차단되면 목록을 읽을 수 없습니다.

## 텔레그램 예약 발송 (Cloudflare Workers)

Worker는 매분 시각을 확인해 평일에 발송합니다. 한국·일본·중국은 한국시간 10:00, 13:00, 15:00, 15:15에 묶어서 보내며, 미국은 뉴욕시간 10:00(개장 30분 후), 15:50(종료 10분 전), 16:30(종료 30분 후)에 보냅니다. 미국 시간은 `America/New_York` 시간대를 사용하므로 서머타임이 자동 반영됩니다. 거래소 휴장일은 별도로 판별하지 않습니다.

메시지에는 각 시장 시트의 일봉에서 굵게 표시된 종목코드와 종목명이 포함됩니다. 현재 공유 소스가 게시된 시트인 경우에는 게시 시트에서 굵게 표시된 종목을 읽으며, XLSX 소스는 시트 스타일을 읽습니다. 예약 발송을 사용하려면 텔레그램 봇과 수신 채팅을 준비하고 Worker에 비밀 변수를 등록한 뒤 배포하세요.

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler deploy
```

`wrangler.toml`의 매분 Cron Trigger가 자동으로 활성화됩니다. 봇을 수신 채팅에 추가하고 메시지를 보낼 수 있는 권한이 있어야 합니다.

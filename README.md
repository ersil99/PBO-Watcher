# PBO Watcher

Google Sheets의 시장별 탭에서 종목 목록을 읽어 시세와 거래량을 보여주는 정적 웹페이지입니다. 한국 종목은 Naver 증권에서, 미국·일본·중국 종목은 Yahoo Finance에서 업종을 자동 조회해 종목명 옆에 표시합니다.

## 실행

`index.html`을 브라우저에서 열거나, VS Code의 Live Server 같은 정적 서버로 실행하세요. 페이지는 공개된 Google Sheets XLSX 내보내기와 SheetJS CDN을 사용합니다.

원본 시트가 비공개로 바뀌거나 XLSX 내보내기가 차단되면 목록을 읽을 수 없습니다.

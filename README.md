# PBO Watcher

Google Sheets의 `일봉` 탭에서 B열이 굵게 표시된 행만 찾아 A열 종목코드를 보여주는 정적 웹페이지입니다.

## 실행

`index.html`을 브라우저에서 열거나, VS Code의 Live Server 같은 정적 서버로 실행하세요. 페이지는 공개된 Google Sheets XLSX 내보내기와 SheetJS CDN을 사용합니다.

원본 시트가 비공개로 바뀌거나 XLSX 내보내기가 차단되면 목록을 읽을 수 없습니다.

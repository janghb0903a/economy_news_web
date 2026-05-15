# Economy News Dashboard

개인 PC에서 실행하는 로컬 경제 뉴스 대시보드입니다. RSS/Atom 기반 뉴스 수집, SQLite 저장, FTS5 검색, 한국은행(BOK) 관련도 분류, 보고서 생성, 브라우저 알림, AI 요약 후처리를 한 화면에서 관리합니다.

기본 실행 대상은 Windows 로컬 환경입니다. 외부 서버 배포보다 개인 PC에서 `127.0.0.1`로 띄워 쓰는 방식을 기준으로 구성되어 있습니다.

## 주요 기능

- 국내/해외 경제 뉴스 RSS 수집
- 한국은행 관련 기사 자동 분류
- 중복 기사 묶기 및 대표 기사 관리
- 기사 검색, 저장, 읽음 처리
- 최신 국내 기사 알림 패널 및 브라우저 알림
- 일일 보고서 생성, HTML/Markdown/PDF 저장
- 이메일 보고서 발송
- AI provider 선택: `disabled`, `ollama`, `openai`, `gemini`
- Windows 오프라인 설치 패키지 제공

## 폴더 구성

- `backend`: FastAPI, SQLite, SQLAlchemy, APScheduler
- `frontend`: React, TypeScript, Vite, Tailwind CSS
- `config/news-sources.yaml`: 기본 뉴스 RSS 소스
- `config/bok-keywords.yaml`: 한국은행 관련 키워드와 인명 설정
- `EconomyNewsDashboard-Installer`: Windows용 오프라인 설치/제어 패키지
- `docker-compose.yml`: 선택용 개발 실행 파일

## Windows 설치 패키지 실행

다른 PC에서 가장 간단하게 실행하려면 `EconomyNewsDashboard-Installer` 폴더를 통째로 옮긴 뒤 아래 파일을 실행합니다.

```cmd
EconomyNewsDashboard-Installer\control.cmd
```

설치 화면에서 할 일:

1. 설치 경로를 확인하거나 변경합니다.
2. `설치 / 초기화`를 누릅니다.
3. `시작`을 누릅니다.
4. `접속`을 눌러 브라우저에서 대시보드를 엽니다.

기본 설치 경로는 다음과 같습니다.

```cmd
C:\EconomyNewsDashboard
```

설치 패키지에는 Python 런타임, 백엔드, 빌드된 프론트엔드, SQLite DB 초기화 코드, 컨트롤 UI가 포함되어 있습니다. 대상 PC에 Python이나 Node.js를 따로 설치하지 않아도 됩니다.

### 설치 패키지 동작 메모

- `control.cmd`를 실행하면 설치/시작/중지/접속 화면이 열립니다.
- 설치 완료 후 바탕화면에 `Economy News Dashboard Control.cmd`가 생성됩니다.
- 컨트롤 창의 `종료` 버튼이나 창 닫기를 누르면 실행 중인 로컬 서비스도 함께 중지됩니다.
- 이미 설치 경로에 `data/news.db`가 있으면 삭제하지 않고 유지합니다.
- 재설치 시 앱 파일은 갱신하고 DB 구조 확인 및 기본 설정 보정만 수행합니다.
- GitHub 단일 파일 제한 때문에 Electron 실행 파일은 조각 파일로 보관되어 있으며, `control.cmd` 실행 시 자동 복원됩니다.

## 로컬 개발 실행

개발용으로 직접 실행하려면 Python과 Node.js가 필요합니다.

```powershell
cd C:\path\to\economy_news_web
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

새 PowerShell에서 프론트엔드를 실행합니다.

```powershell
cd C:\path\to\economy_news_web\frontend
npm install
npm run dev
```

브라우저에서 아래 주소를 엽니다.

```text
http://127.0.0.1:5173
```

백엔드는 아래 주소에 바인딩됩니다.

```text
http://127.0.0.1:8000
```

## 첫 데이터 수집

앱의 대시보드 또는 설정 화면에서 수집을 실행할 수 있습니다. API로 직접 실행하려면:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/ingest/run
```

기본 수집 주기는 10분입니다. 수집 및 후처리 로그는 앱 설정 화면에서 확인할 수 있습니다.

## AI 설정

`.env`에서 provider와 모델/API 키를 설정합니다. API 키는 백엔드에서만 읽고 프론트엔드로 전달하지 않습니다.

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash-lite
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_API_KEY=
```

지원 provider:

- `AI_PROVIDER=disabled`: AI 호출 없이 규칙 기반 처리
- `AI_PROVIDER=ollama`: 로컬 Ollama OpenAI-compatible endpoint 사용
- `AI_PROVIDER=openai`: OpenAI API 사용
- `AI_PROVIDER=gemini`: Google Gemini API 사용

Gemini 무료 티어를 사용할 경우 `gemini-2.5-flash-lite`를 기본 모델로 권장합니다. API 키가 없으면 Gemini 호출은 실패하므로 `.env`에 `GEMINI_API_KEY`를 넣어야 합니다.

### Ollama 사용

Ollama를 설치한 뒤 모델을 내려받습니다. 모델 이름은 `ollama list`에 보이는 이름과 정확히 맞춰야 합니다.

```powershell
ollama pull qwen3:4b-instruct
ollama serve
```

`.env` 예시:

```env
AI_PROVIDER=ollama
AI_MODEL=qwen3:4b-instruct
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

## 보고서와 이메일

- 보고서 마감 기본 시간: `17:30`
- 자동 이메일 발송 기본값: 꺼짐
- 이메일 발송 기본 시간: `17:50`
- 자동 이메일 발송을 켜려면 받는 사람 이메일이 최소 1개 필요합니다.
- 첨부 형식은 Markdown, HTML, PDF를 선택할 수 있습니다.

PDF 저장은 AI 기능 없이 Markdown 내용을 PDF로 변환하는 방식입니다.

## 알림

브라우저 알림은 설정 화면에서 켜고 끌 수 있습니다.

알림 범위:

- 국내 전체
- 국내 한국은행 관련만
- 국내 꺼짐
- 해외 전체
- 해외 꺼짐

상단 알림 버튼과 설정 화면의 알림 상태는 같은 설정 값을 사용합니다. 브라우저 자체 알림 권한이 차단되어 있으면 앱 설정을 켜도 알림이 뜨지 않습니다.

## Docker Compose

`docker-compose.yml`은 현재 Windows 설치 패키지나 일반 로컬 실행에서 자동으로 사용되지 않습니다. Docker Desktop으로 개발 환경을 띄우고 싶을 때 쓰는 선택용 실행 방식입니다.

```powershell
cd C:\path\to\economy_news_web
Copy-Item .env.example .env
docker compose up --build
```

일반 사용자는 Docker Compose 대신 `EconomyNewsDashboard-Installer\control.cmd` 사용을 권장합니다.

## 테스트

```powershell
cd C:\path\to\economy_news_web
.\.venv\Scripts\Activate.ps1
pytest backend\tests
cd frontend
npm test
```

## 보안 및 운영 메모

- 기본 host는 `127.0.0.1`입니다.
- `.env`, `monitoring.json`, DB 파일, 로그 파일은 커밋하지 않습니다.
- API 키와 SMTP 비밀번호는 개인 PC의 `.env` 또는 앱 설정에서만 관리합니다.
- 원문 링크는 새 탭에서 `noopener noreferrer`로 열립니다.
- 본문 보강용 HTML은 백엔드에서 sanitize합니다.
- 한국은행 관련 인명은 코드에 고정하지 않고 `config/bok-keywords.yaml`의 `person_names`에 추가합니다.

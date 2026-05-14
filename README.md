# Local Economy News Dashboard

개인 PC에서 실행하는 경제 뉴스 대시보드입니다. RSS/Atom을 우선 수집하고, SQLite FTS5 검색과 한국은행(BOK) 키워드 분류를 제공합니다. AI는 `disabled`, `ollama`, `openai`, `gemini` provider로 교체 가능한 구조이며 꺼져 있어도 앱은 정상 동작합니다.

## 구성

- `backend`: FastAPI, SQLite, SQLAlchemy, FTS5, feedparser, httpx, APScheduler
- `frontend`: React, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts
- `config/news-sources.yaml`: 기본 RSS 소스
- `config/bok-keywords.yaml`: 한국은행 키워드와 인명 설정

## 실행

```powershell
cd c:\jsh\economy-news-dashboard
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

새 PowerShell에서:

```powershell
cd c:\jsh\economy-news-dashboard\frontend
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. 백엔드는 `http://127.0.0.1:8000`에 바인딩됩니다.

## 첫 데이터 수집

앱의 설정 또는 대시보드에서 `지금 수집`을 누르거나:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/ingest/run
```

수집 실패 내역은 `fetch_logs`에 남습니다. 기본 수집 주기는 10분입니다.

## AI provider

`.env`에서 provider와 모델/API Key를 설정합니다. API Key는 백엔드에서만 읽으며 프론트엔드로 전달하지 않습니다.

- `AI_PROVIDER=disabled`: 규칙 기반 요약/분류
- `AI_PROVIDER=ollama`: 기본 `http://127.0.0.1:11434/v1` OpenAI-compatible endpoint
- `AI_PROVIDER=openai`: Responses API JSON schema 사용
- `AI_PROVIDER=gemini`: generate content API schema 응답 사용

### Ollama로 로컬 LLM 쓰기

Ollama를 설치한 뒤 모델을 내려받습니다. 모델 이름은 `ollama list`에 보이는 이름과 정확히 맞춰야 합니다.

```powershell
ollama pull gemma4
ollama serve
```

`.env`를 이렇게 바꿉니다.

```env
AI_PROVIDER=ollama
AI_MODEL=gemma4
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

만약 `gemma4`가 Ollama에서 제공되는 정확한 태그가 아니면 `ollama pull`이 실패합니다. 그때는 `ollama list` 또는 Ollama 모델 페이지에서 확인한 태그를 `AI_MODEL`에 넣으세요. 예: `gemma3:4b`, `gemma3:12b`처럼 태그가 붙은 이름.

## 테스트

```powershell
cd c:\jsh\economy-news-dashboard
.\.venv\Scripts\Activate.ps1
pytest backend\tests
cd frontend
npm test
```

## Docker Compose

```powershell
cd c:\jsh\economy-news-dashboard
Copy-Item .env.example .env
docker compose up --build
```

## 보안/운영 메모

- 기본 host는 `127.0.0.1`입니다.
- 원문 링크는 새 탭에서 `noopener noreferrer`로 열립니다.
- RSS 링크 본문 보강용 HTML은 백엔드에서 sanitize합니다.
- BOK 총재명/금통위원명은 코드에 고정하지 않고 `config/bok-keywords.yaml`의 `person_names`에 추가합니다.

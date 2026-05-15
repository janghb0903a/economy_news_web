from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.time import kst_now


TIMEOUT_SECONDS = 12


def status_row(source: str, label: str, configured: bool, status: str, message: str, sample: str = "") -> dict[str, Any]:
    return {
        "source": source,
        "label": label,
        "configured": configured,
        "status": status,
        "message": message,
        "sample": sample,
        "checked_at": kst_now().isoformat(),
    }


def latest_month(offset: int = 1) -> str:
    today = kst_now().date().replace(day=1)
    target = today - timedelta(days=offset)
    return target.strftime("%Y%m")


async def check_fred(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    label = "FRED"
    if not key:
        return status_row("fred", label, False, "missing", "FRED_API_KEY가 설정되지 않았습니다.")
    try:
        response = await client.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id": "DGS10",
                "api_key": key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 1,
            },
        )
        response.raise_for_status()
        data = response.json()
        observation = (data.get("observations") or [{}])[0]
        sample = f"US10Y {observation.get('date', '')} {observation.get('value', '')}".strip()
        return status_row("fred", label, True, "connected", "미국 10년물 등 FRED 시계열 조회가 가능합니다.", sample)
    except Exception as exc:
        return status_row("fred", label, True, "error", f"FRED 연결 실패: {type(exc).__name__}")


async def check_ecos(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    label = "한국은행 ECOS"
    if not key:
        return status_row("bok_ecos", label, False, "missing", "BOK_ECOS_API_KEY가 설정되지 않았습니다.")
    try:
        url = f"https://ecos.bok.or.kr/api/StatisticTableList/{key}/json/kr/1/1/"
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()
        if "RESULT" in data and data["RESULT"].get("CODE") not in {"INFO-000"}:
            return status_row("bok_ecos", label, True, "error", f"ECOS 응답 오류: {data['RESULT'].get('MESSAGE', 'unknown')}")
        sample = "통계표 목록 조회 성공"
        return status_row("bok_ecos", label, True, "connected", "한국은행 ECOS API 조회가 가능합니다.", sample)
    except Exception as exc:
        return status_row("bok_ecos", label, True, "error", f"ECOS 연결 실패: {type(exc).__name__}")


async def check_kosis(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    label = "KOSIS"
    if not key:
        return status_row("kosis", label, False, "missing", "KOSIS_API_KEY가 설정되지 않았습니다.")
    try:
        response = await client.get(
            "https://kosis.kr/openapi/Param/statisticsParameterData.do",
            params={
                "method": "getList",
                "apiKey": key,
                "itmId": "T1+",
                "objL1": "ALL",
                "format": "json",
                "jsonVD": "Y",
                "prdSe": "Y",
                "newEstPrdCnt": "1",
                "prdInterval": "1",
                "orgId": "101",
                "tblId": "DT_1B41",
            },
        )
        response.raise_for_status()
        text = response.text.strip()
        if not text or "ERROR" in text.upper():
            return status_row("kosis", label, True, "error", "KOSIS 응답 오류가 감지되었습니다.")
        return status_row("kosis", label, True, "connected", "KOSIS 통계 API 조회가 가능합니다.", "표본 통계 1건 이상 응답")
    except Exception as exc:
        return status_row("kosis", label, True, "error", f"KOSIS 연결 실패: {type(exc).__name__}")


async def check_bls(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    label = "BLS"
    if not key:
        return status_row("bls", label, False, "missing", "BLS_API_KEY가 설정되지 않았습니다. 일부 조회는 키 없이도 가능하지만 등록키 사용을 권장합니다.")
    try:
        year = str(kst_now().year)
        response = await client.post(
            "https://api.bls.gov/publicAPI/v2/timeseries/data/",
            json={"seriesid": ["CUUR0000SA0"], "startyear": year, "endyear": year, "registrationkey": key},
        )
        response.raise_for_status()
        data = response.json()
        if data.get("status") != "REQUEST_SUCCEEDED":
            return status_row("bls", label, True, "error", f"BLS 응답 오류: {data.get('message', ['unknown'])[0] if data.get('message') else 'unknown'}")
        series = ((data.get("Results") or {}).get("series") or [{}])[0]
        item = (series.get("data") or [{}])[0]
        sample = f"CPI {item.get('periodName', '')} {item.get('value', '')}".strip()
        return status_row("bls", label, True, "connected", "미국 CPI/고용 등 BLS 시계열 조회가 가능합니다.", sample)
    except Exception as exc:
        return status_row("bls", label, True, "error", f"BLS 연결 실패: {type(exc).__name__}")


async def check_bea(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    label = "BEA"
    if not key:
        return status_row("bea", label, False, "missing", "BEA_API_KEY가 설정되지 않았습니다.")
    try:
        response = await client.get(
            "https://apps.bea.gov/api/data/",
            params={"UserID": key, "method": "GETDATASETLIST", "ResultFormat": "JSON"},
        )
        response.raise_for_status()
        data = response.json()
        if "BEAAPI" not in data:
            return status_row("bea", label, True, "error", "BEA 응답 형식이 예상과 다릅니다.")
        return status_row("bea", label, True, "connected", "미국 PCE/GDP 등 BEA API 조회가 가능합니다.", "데이터셋 목록 조회 성공")
    except Exception as exc:
        return status_row("bea", label, True, "error", f"BEA 연결 실패: {type(exc).__name__}")


async def check_data_go_kr(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    label = "공공데이터포털"
    if not key:
        return status_row("data_go_kr", label, False, "missing", "DATA_GO_KR_API_KEY가 설정되지 않았습니다.")
    try:
        month = latest_month(35)
        response = await client.get(
            "http://apis.data.go.kr/1220000/Newtrade/getNewtradeList",
            params={"serviceKey": key, "strtYymm": month, "endYymm": month},
        )
        response.raise_for_status()
        text = response.text
        if "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" in text or "INVALID_REQUEST_PARAMETER_ERROR" in text or "ERROR" in text.upper():
            return status_row("data_go_kr", label, True, "error", "관세청 수출입총괄 API 응답 오류입니다. 활용신청 또는 Decoding 키 사용 여부를 확인하세요.")
        return status_row("data_go_kr", label, True, "connected", "관세청 수출입총괄 API 조회가 가능합니다.", f"{month} 수출입총괄 조회")
    except Exception as exc:
        return status_row("data_go_kr", label, True, "error", f"공공데이터포털 연결 실패: {type(exc).__name__}")


async def check_eia(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    label = "EIA"
    if not key:
        return status_row("eia", label, False, "missing", "EIA_API_KEY가 설정되지 않았습니다.")
    try:
        response = await client.get(
            "https://api.eia.gov/v2/petroleum/pri/spt/data/",
            params={
                "api_key": key,
                "frequency": "daily",
                "data[0]": "value",
                "facets[series][]": "RWTC",
                "sort[0][column]": "period",
                "sort[0][direction]": "desc",
                "offset": 0,
                "length": 1,
            },
        )
        response.raise_for_status()
        data = response.json()
        item = ((data.get("response") or {}).get("data") or [{}])[0]
        sample = f"WTI {item.get('period', '')} {item.get('value', '')}".strip()
        return status_row("eia", label, True, "connected", "WTI 등 EIA 에너지 데이터 조회가 가능합니다.", sample)
    except Exception as exc:
        return status_row("eia", label, True, "error", f"EIA 연결 실패: {type(exc).__name__}")


async def economic_api_status() -> list[dict[str, Any]]:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=True) as client:
        checks = [
            check_fred(client, settings.fred_api_key),
            check_ecos(client, settings.bok_ecos_api_key),
            check_kosis(client, settings.kosis_api_key),
            check_bls(client, settings.bls_api_key),
            check_bea(client, settings.bea_api_key),
            check_data_go_kr(client, settings.data_go_kr_api_key),
            check_eia(client, settings.eia_api_key),
        ]
        return await __import__("asyncio").gather(*checks)

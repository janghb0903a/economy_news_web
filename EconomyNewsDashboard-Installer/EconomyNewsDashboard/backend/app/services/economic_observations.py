from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import Any
from xml.etree import ElementTree

import httpx

from app.core.config import get_settings
from app.core.time import kst_now


TIMEOUT_SECONDS = 18


def unavailable(code: str, message: str) -> dict[str, Any]:
    return {
        "code": code,
        "source": "",
        "source_label": "",
        "status": "unavailable",
        "is_sample": True,
        "message": message,
        "unit": "",
        "actual_value": None,
        "previous_value": None,
        "direction": "none",
        "latest_date": None,
        "previous_date": None,
        "series": [],
        "fetched_at": kst_now().isoformat(),
    }


def observation_result(
    *,
    code: str,
    source: str,
    source_label: str,
    unit: str,
    actual_value: float | None,
    previous_value: float | None,
    latest_date: str | None,
    previous_date: str | None,
    series: list[dict[str, Any]],
    message: str,
) -> dict[str, Any]:
    direction = "none"
    if actual_value is not None and previous_value is not None:
        if actual_value > previous_value:
            direction = "up"
        elif actual_value < previous_value:
            direction = "down"
        else:
            direction = "flat"
    return {
        "code": code,
        "source": source,
        "source_label": source_label,
        "status": "connected",
        "is_sample": False,
        "message": message,
        "unit": unit,
        "actual_value": actual_value,
        "previous_value": previous_value,
        "direction": direction,
        "latest_date": latest_date,
        "previous_date": previous_date,
        "series": series,
        "fetched_at": kst_now().isoformat(),
    }


def parse_float(value: Any) -> float | None:
    try:
        text = str(value).strip()
        if not text or text == ".":
            return None
        return float(text)
    except (TypeError, ValueError):
        return None


def round_value(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def last_two(series: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not series:
        return None, None
    latest = series[-1]
    previous = series[-2] if len(series) >= 2 else None
    return latest, previous


async def fred_series(client: httpx.AsyncClient, series_id: str, key: str, days: int = 400) -> list[dict[str, Any]]:
    if not key:
        return []
    start = (kst_now().date() - timedelta(days=days)).isoformat()
    response = await client.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={
            "series_id": series_id,
            "api_key": key,
            "file_type": "json",
            "observation_start": start,
            "sort_order": "asc",
        },
    )
    response.raise_for_status()
    rows = response.json().get("observations") or []
    parsed = []
    for row in rows:
        value = parse_float(row.get("value"))
        if value is None:
            continue
        parsed.append({"date": row.get("date"), "label": row.get("date"), "value": value})
    return parsed


def yoy_from_index(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date = {row["date"]: row["value"] for row in rows if row.get("date") and row.get("value") is not None}
    result: list[dict[str, Any]] = []
    for row in rows:
        current_date = row.get("date")
        if not current_date:
            continue
        try:
            year, month, _ = current_date.split("-")
            previous_key = f"{int(year) - 1:04d}-{month}-01"
        except ValueError:
            continue
        previous_value = by_date.get(previous_key)
        if not previous_value:
            continue
        yoy = ((row["value"] / previous_value) - 1) * 100
        result.append({"date": current_date, "label": current_date[:7], "value": round(yoy, 2)})
    return result[-12:]


async def fetch_fred_yield(client: httpx.AsyncClient, code: str, series_id: str, label: str, key: str) -> dict[str, Any]:
    rows = await fred_series(client, series_id, key)
    if not rows:
        return unavailable(code, f"{label} 실데이터를 가져오지 못했습니다.")
    series = [{"date": row["date"], "label": row["label"], "value": round_value(row["value"])} for row in rows]
    latest, previous = last_two(series)
    return observation_result(
        code=code,
        source="fred",
        source_label="FRED",
        unit="%",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message=f"{label} 1년치 실데이터입니다.",
    )


async def fetch_fred_midpoint_rate(client: httpx.AsyncClient, code: str, upper_series_id: str, lower_series_id: str, label: str, key: str) -> dict[str, Any]:
    upper_rows, lower_rows = await asyncio.gather(
        fred_series(client, upper_series_id, key),
        fred_series(client, lower_series_id, key),
    )
    if not upper_rows or not lower_rows:
        return unavailable(code, f"{label} 실데이터를 가져오지 못했습니다.")
    lower_by_date = {row["date"]: row["value"] for row in lower_rows}
    series = []
    for upper in upper_rows:
        lower_value = lower_by_date.get(upper["date"])
        if lower_value is None:
            continue
        midpoint = (upper["value"] + lower_value) / 2
        series.append({"date": upper["date"], "label": upper["date"], "value": round(midpoint, 3)})
    if not series:
        return unavailable(code, f"{label} 상·하단 금리 데이터를 매칭하지 못했습니다.")
    latest, previous = last_two(series)
    return observation_result(
        code=code,
        source="fred",
        source_label="FRED",
        unit="%",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message=f"{label} 목표범위 중간값 1년치 실데이터입니다.",
    )


async def fetch_fred_yoy_index(client: httpx.AsyncClient, code: str, series_id: str, label: str, key: str) -> dict[str, Any]:
    rows = await fred_series(client, series_id, key, days=760)
    series = yoy_from_index(rows)
    if not series:
        return unavailable(code, f"{label} 실데이터를 가져오지 못했습니다.")
    latest, previous = last_two(series)
    return observation_result(
        code=code,
        source="fred",
        source_label="FRED",
        unit="%",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message=f"{label} 전년동월 대비 1년치 실데이터입니다.",
    )


async def bls_series(client: httpx.AsyncClient, series_id: str, key: str) -> list[dict[str, Any]]:
    if not key:
        return []
    year = kst_now().year
    payload = {"seriesid": [series_id], "startyear": str(year - 2), "endyear": str(year), "registrationkey": key}
    response = await client.post("https://api.bls.gov/publicAPI/v2/timeseries/data/", json=payload)
    response.raise_for_status()
    data = response.json()
    if data.get("status") != "REQUEST_SUCCEEDED":
        return []
    series = ((data.get("Results") or {}).get("series") or [{}])[0].get("data") or []
    rows = []
    for row in series:
        period = row.get("period", "")
        if not period.startswith("M"):
            continue
        value = parse_float(row.get("value"))
        if value is None:
            continue
        month = int(period[1:])
        rows.append({"date": f"{row.get('year')}-{month:02d}-01", "label": f"{row.get('year')}-{month:02d}", "value": value})
    return sorted(rows, key=lambda item: item["date"])


async def fetch_us_cpi(client: httpx.AsyncClient, key: str, fred_key: str) -> dict[str, Any]:
    rows = await bls_series(client, "CUUR0000SA0", key)
    series = yoy_from_index(rows)
    source = "bls"
    source_label = "BLS"
    if not series and fred_key:
        return await fetch_fred_yoy_index(client, "US_CPI", "CPIAUCSL", "미국 CPI", fred_key)
    if not series:
        return unavailable("US_CPI", "미국 CPI 실데이터를 가져오지 못했습니다.")
    latest, previous = last_two(series)
    return observation_result(
        code="US_CPI",
        source=source,
        source_label=source_label,
        unit="%",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message="미국 CPI 전년동월 대비 1년치 실데이터입니다.",
    )


async def fetch_us_nfp(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    rows = await bls_series(client, "CES0000000001", key)
    changes = []
    for previous, current in zip(rows, rows[1:]):
        change = current["value"] - previous["value"]
        changes.append({"date": current["date"], "label": current["label"], "value": round(change, 1)})
    series = changes[-12:]
    if not series:
        return unavailable("US_NFP", "미국 고용지표 실데이터를 가져오지 못했습니다.")
    latest, previous = last_two(series)
    return observation_result(
        code="US_NFP",
        source="bls",
        source_label="BLS",
        unit="K",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message="미국 비농업 고용 월간 증감 1년치 실데이터입니다.",
    )


async def fetch_kr_cpi(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    if not key:
        return unavailable("KR_CPI", "KOSIS_API_KEY가 없어 한국 CPI 실데이터를 가져올 수 없습니다.")
    response = await client.get(
        "https://kosis.kr/openapi/Param/statisticsParameterData.do",
        params={
            "method": "getList",
            "apiKey": key,
            "orgId": "101",
            "tblId": "DT_1J22003",
            "itmId": "T+",
            "objL1": "T10",
            "prdSe": "M",
            "newEstPrdCnt": "24",
            "prdInterval": "1",
            "format": "json",
            "jsonVD": "Y",
        },
    )
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict) and data.get("err"):
        return unavailable("KR_CPI", f"KOSIS CPI 응답 오류: {data.get('errMsg', data.get('err'))}")
    if not isinstance(data, list):
        return unavailable("KR_CPI", "KOSIS CPI 응답 형식이 예상과 다릅니다.")
    rows = []
    for row in data:
        period = str(row.get("PRD_DE") or "")
        value = parse_float(row.get("DT"))
        if len(period) != 6 or value is None:
            continue
        rows.append({"date": f"{period[:4]}-{period[4:]}-01", "label": f"{period[:4]}-{period[4:]}", "value": value})
    rows.sort(key=lambda item: item["date"])
    series = yoy_from_index(rows)
    if not series:
        return unavailable("KR_CPI", "한국 CPI 전년동월비 계산에 필요한 1년 전 자료가 부족합니다.")
    latest, previous = last_two(series)
    return observation_result(
        code="KR_CPI",
        source="kosis",
        source_label="KOSIS",
        unit="%",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message="한국 CPI 전국 총지수 전년동월 대비 1년치 실데이터입니다.",
    )


async def fetch_kr_base_rate(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    if not key:
        return unavailable("KR_BASE_RATE", "BOK_ECOS_API_KEY가 없어 한국 기준금리 실데이터를 가져올 수 없습니다.")
    start = (kst_now().date() - timedelta(days=400)).strftime("%Y%m%d")
    end = kst_now().date().strftime("%Y%m%d")
    url = f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/1000/722Y001/D/{start}/{end}/0101000"
    response = await client.get(url)
    response.raise_for_status()
    data = response.json()
    if "RESULT" in data:
        return unavailable("KR_BASE_RATE", f"ECOS 기준금리 응답 오류: {data['RESULT'].get('MESSAGE', data['RESULT'].get('CODE'))}")
    rows = ((data.get("StatisticSearch") or {}).get("row") or [])
    series = []
    for row in rows:
        period = str(row.get("TIME") or "")
        value = parse_float(row.get("DATA_VALUE"))
        if len(period) != 8 or value is None:
            continue
        series.append({"date": f"{period[:4]}-{period[4:6]}-{period[6:]}", "label": f"{period[:4]}-{period[4:6]}-{period[6:]}", "value": value})
    series.sort(key=lambda item: item["date"])
    if not series:
        return unavailable("KR_BASE_RATE", "ECOS 기준금리 데이터가 비어 있습니다.")
    latest, previous = last_two(series)
    return observation_result(
        code="KR_BASE_RATE",
        source="bok_ecos",
        source_label="한국은행 ECOS",
        unit="%",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message="한국은행 기준금리 일별 1년치 실데이터입니다.",
    )


def add_months(value: date, months: int) -> date:
    year = value.year
    month = value.month + months
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return date(year, month, 1)


def month_text(value: date) -> str:
    return f"{value.year}{value.month:02d}"


async def fetch_trade_rows(client: httpx.AsyncClient, key: str, start: str, end: str) -> list[dict[str, Any]]:
    response = await client.get(
        "http://apis.data.go.kr/1220000/Newtrade/getNewtradeList",
        params={"serviceKey": key, "strtYymm": start, "endYymm": end},
    )
    response.raise_for_status()
    text = response.text
    if "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" in text or "INVALID_REQUEST_PARAMETER_ERROR" in text:
        raise ValueError("관세청 수출입총괄 API 키 또는 요청 파라미터 오류입니다.")
    root = ElementTree.fromstring(text)
    result_code = root.findtext(".//resultCode")
    if result_code and result_code != "00":
        raise ValueError(root.findtext(".//resultMsg") or f"관세청 응답 오류: {result_code}")
    rows = []
    for item in root.findall(".//item"):
        period = (item.findtext("year") or "").strip()
        if period == "총계" or "." not in period:
            continue
        value = parse_float(item.findtext("expDlr"))
        imports = parse_float(item.findtext("impDlr"))
        balance = parse_float(item.findtext("balPayments"))
        if value is None:
            continue
        year, month = period.split(".", 1)
        rows.append(
            {
                "date": f"{int(year):04d}-{int(month):02d}-01",
                "label": f"{int(year):04d}-{int(month):02d}",
                "value": value,
                "imports": imports,
                "balance": balance,
            }
        )
    return rows


def trade_month_ranges() -> tuple[tuple[str, str], tuple[str, str]]:
    latest_month = add_months(kst_now().date().replace(day=1), -1)
    current_start = add_months(latest_month, -11)
    previous_start = add_months(current_start, -12)
    previous_end = add_months(latest_month, -12)
    return (month_text(current_start), month_text(latest_month)), (month_text(previous_start), month_text(previous_end))


async def fetch_kr_exports(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    if not key:
        return unavailable("KR_EXPORTS", "DATA_GO_KR_API_KEY가 없어 한국 수출입 실데이터를 가져올 수 없습니다.")
    current_range, previous_range = trade_month_ranges()
    try:
        current_rows, previous_rows = await asyncio.gather(
            fetch_trade_rows(client, key, *current_range),
            fetch_trade_rows(client, key, *previous_range),
        )
    except ValueError as exc:
        return unavailable("KR_EXPORTS", str(exc))
    rows = [*previous_rows, *current_rows]
    rows.sort(key=lambda item: item["date"])
    by_date = {row["date"]: row["value"] for row in rows}
    yoy_series = []
    for row in rows:
        year, month, _ = row["date"].split("-")
        previous_key = f"{int(year) - 1:04d}-{month}-01"
        previous_value = by_date.get(previous_key)
        if not previous_value:
            continue
        yoy = ((row["value"] / previous_value) - 1) * 100
        yoy_series.append({"date": row["date"], "label": row["label"], "value": round(yoy, 2)})
    series = yoy_series[-12:]
    if not series:
        return unavailable("KR_EXPORTS", "한국 수출 전년동월비 계산에 필요한 1년 전 자료가 부족합니다.")
    latest, previous = last_two(series)
    return observation_result(
        code="KR_EXPORTS",
        source="data_go_kr",
        source_label="관세청 수출입총괄",
        unit="%",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message="관세청 수출입총괄 기준 수출액 전년동월 대비 1년치 실데이터입니다.",
    )


async def fetch_wti(client: httpx.AsyncClient, key: str) -> dict[str, Any]:
    if not key:
        return unavailable("WTI", "EIA_API_KEY가 없어 WTI 실데이터를 가져올 수 없습니다.")
    start = (kst_now().date() - timedelta(days=400)).isoformat()
    response = await client.get(
        "https://api.eia.gov/v2/petroleum/pri/spt/data/",
        params={
            "api_key": key,
            "frequency": "daily",
            "data[0]": "value",
            "facets[series][]": "RWTC",
            "start": start,
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
            "offset": 0,
            "length": 5000,
        },
    )
    response.raise_for_status()
    rows = (response.json().get("response") or {}).get("data") or []
    series = []
    for row in rows:
        value = parse_float(row.get("value"))
        if value is None:
            continue
        series.append({"date": row.get("period"), "label": row.get("period"), "value": round(value, 2)})
    if not series:
        return unavailable("WTI", "WTI 실데이터를 가져오지 못했습니다.")
    latest, previous = last_two(series)
    return observation_result(
        code="WTI",
        source="eia",
        source_label="EIA",
        unit="$",
        actual_value=latest["value"] if latest else None,
        previous_value=previous["value"] if previous else None,
        latest_date=latest["date"] if latest else None,
        previous_date=previous["date"] if previous else None,
        series=series,
        message="WTI 현물가 1년치 실데이터입니다.",
    )


async def fetch_indicator_observation(client: httpx.AsyncClient, code: str) -> dict[str, Any]:
    settings = get_settings()
    code = code.upper()
    if code == "KR_BASE_RATE":
        return await fetch_kr_base_rate(client, settings.bok_ecos_api_key)
    if code == "US10Y":
        return await fetch_fred_yield(client, code, "DGS10", "미국 10년물 국채금리", settings.fred_api_key)
    if code == "FOMC":
        return await fetch_fred_midpoint_rate(client, code, "DFEDTARU", "DFEDTARL", "미국 FOMC 기준금리 목표범위", settings.fred_api_key)
    if code == "US_CPI":
        return await fetch_us_cpi(client, settings.bls_api_key, settings.fred_api_key)
    if code == "US_NFP":
        return await fetch_us_nfp(client, settings.bls_api_key)
    if code == "US_PCE":
        return await fetch_fred_yoy_index(client, code, "PCEPI", "미국 PCE", settings.fred_api_key)
    if code == "KR_CPI":
        return await fetch_kr_cpi(client, settings.kosis_api_key)
    if code == "KR_EXPORTS":
        return await fetch_kr_exports(client, settings.data_go_kr_api_key)
    if code == "WTI":
        return await fetch_wti(client, settings.eia_api_key)
    return unavailable(code, "해당 지표는 아직 1년치 공식 API 관측값 매핑이 없습니다.")


async def economic_indicator_observations(codes: list[str]) -> list[dict[str, Any]]:
    clean_codes = []
    for code in codes:
        normalized = code.strip().upper()
        if normalized and normalized not in clean_codes:
            clean_codes.append(normalized)
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=True) as client:
        tasks = [fetch_indicator_observation(client, code) for code in clean_codes]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    output = []
    for code, result in zip(clean_codes, results):
        if isinstance(result, Exception):
            output.append(unavailable(code, f"실데이터 조회 실패: {type(result).__name__}"))
        else:
            output.append(result)
    return output

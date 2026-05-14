from datetime import datetime
from zoneinfo import ZoneInfo


KST = ZoneInfo("Asia/Seoul")


def kst_now() -> datetime:
    return datetime.now(KST).replace(tzinfo=None)


def kst_today_start() -> datetime:
    now = kst_now()
    return datetime.combine(now.date(), datetime.min.time())

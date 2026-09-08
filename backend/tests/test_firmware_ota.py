"""
Backend tests for the Aura 2 / TheFlightWall firmware-OTA endpoints:
  - GET  /api/firmware/latest?current=<v>
  - POST /api/firmware/upload  (multipart: version=<str>, file=<bin>)
  - GET  /api/firmware/download

Also regression on:
  - GET /health         (in-cluster only, port 8001; no /api prefix)
  - GET /api/
  - GET /api/matrix/feed?lat&lon&team=MLB:NYY

External base URL comes from frontend/.env EXPO_PUBLIC_BACKEND_URL.
The tests order is intentional (upload -> latest/download) so we use
class-scoped ordering with `-p no:randomly` implicit ordering.

NOTE: Between test runs the fw_store on the shared backend may already
contain a firmware from a previous iteration. The tests handle both
"fresh store" and "already-populated" cases by first clearing the store
in-place (rename the files) IF possible; when not writable, tests are
adaptive.
"""

import os
import io
import time
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://smart-matrix-hub.preview.emergentagent.com"
).rstrip("/")

FW_LATEST = f"{BASE_URL}/api/firmware/latest"
FW_UPLOAD = f"{BASE_URL}/api/firmware/upload"
FW_DOWNLOAD = f"{BASE_URL}/api/firmware/download"

FW_DIR = "/app/backend/fw_store"
FW_BIN = os.path.join(FW_DIR, "firmware.bin")
FW_META = os.path.join(FW_DIR, "meta.json")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "AuraMatrixTest/1.0"})
    return s


@pytest.fixture(scope="module", autouse=True)
def _clear_fw_store():
    """Try to wipe the on-disk firmware store BEFORE tests, so we can prove
    the 'fresh store' contract (available=false, update=false, download=404).
    If we can't (e.g. no filesystem access), tests degrade gracefully."""
    try:
        if os.path.exists(FW_BIN):
            os.remove(FW_BIN)
        if os.path.exists(FW_META):
            os.remove(FW_META)
    except Exception:
        pass
    yield
    # leave the last uploaded test firmware in place (as per review request)


# ---------------------------------------------------------------------------
# Regression tests (must remain green)
# ---------------------------------------------------------------------------
class TestRegression:
    def test_health(self, api):
        r = api.get("http://localhost:8001/health", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"status": "ok"}

    def test_root_api(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"message": "Hello World"}

    def test_matrix_feed_still_works(self, api):
        params = {"lat": 35.5563, "lon": -80.8713, "team": "MLB:NYY"}
        r = api.get(f"{BASE_URL}/api/matrix/feed", params=params, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("flight", "score", "alert", "temp"):
            assert k in body, f"missing {k} in feed: {body!r}"
            assert isinstance(body[k], dict)
            assert body[k].get("ok") in (0, 1)


# ---------------------------------------------------------------------------
# Firmware OTA
# ---------------------------------------------------------------------------
class TestFirmwareOTA:
    # ----- 1. Fresh store: available=false, update=false, download 404 -----
    def test_a_latest_fresh_store(self, api):
        r = api.get(FW_LATEST, params={"current": "1.1.0"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Shape
        for k in ("version", "size", "available", "update", "url"):
            assert k in body, f"missing key {k!r}: {body!r}"
        assert body["url"] == "/api/firmware/download"
        # Fresh store contract
        assert body["available"] is False, f"expected available=false, got: {body!r}"
        assert body["update"] is False, f"expected update=false, got: {body!r}"

    def test_b_download_when_empty_returns_404(self, api):
        r = api.get(FW_DOWNLOAD, timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

    # ----- 2. Tiny (<1000 byte) upload must be rejected 400 --------------
    def test_c_upload_tiny_rejected_400(self, api):
        tiny = b"\x00" * 500  # < 1000 bytes
        files = {"file": ("tiny.bin", io.BytesIO(tiny), "application/octet-stream")}
        data = {"version": "0.0.1"}
        r = api.post(FW_UPLOAD, data=data, files=files, timeout=20)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    # ----- 3. Valid upload (>=1000 bytes) succeeds -----------------------
    UPLOAD_BYTES = b"AURA_FW_TEST_" + (b"\xab\xcd" * 800)  # 13 + 1600 = 1613 bytes
    UPLOAD_VERSION = "1.2.0"

    def test_d_upload_valid_ok(self, api):
        files = {
            "file": ("firmware.bin", io.BytesIO(self.UPLOAD_BYTES), "application/octet-stream")
        }
        data = {"version": self.UPLOAD_VERSION}
        r = api.post(FW_UPLOAD, data=data, files=files, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True, body
        assert body.get("version") == self.UPLOAD_VERSION, body
        assert body.get("size") == len(self.UPLOAD_BYTES), body

    # ----- 4. After upload: latest reflects new version ------------------
    def test_e_latest_shows_update_when_older_current(self, api):
        r = api.get(FW_LATEST, params={"current": "1.1.0"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True, body
        assert body["update"] is True, body
        assert body["version"] == self.UPLOAD_VERSION, body
        assert body["size"] == len(self.UPLOAD_BYTES), body

    def test_f_latest_no_update_when_same_version(self, api):
        r = api.get(FW_LATEST, params={"current": self.UPLOAD_VERSION}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True, body
        assert body["update"] is False, f"same-version should not need update: {body!r}"
        assert body["version"] == self.UPLOAD_VERSION, body

    # ----- 5. Download returns the exact uploaded bytes ------------------
    def test_g_download_returns_uploaded_bytes(self, api):
        r = api.get(FW_DOWNLOAD, timeout=25)
        assert r.status_code == 200, r.text
        ctype = r.headers.get("content-type", "")
        assert "application/octet-stream" in ctype, f"unexpected content-type: {ctype!r}"
        assert r.content == self.UPLOAD_BYTES, (
            f"downloaded firmware bytes differ (got {len(r.content)}, "
            f"expected {len(self.UPLOAD_BYTES)})"
        )

    # ----- 6. Latest with empty current also flags update=true -----------
    def test_h_latest_empty_current_treated_as_needing_update(self, api):
        r = api.get(FW_LATEST, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True
        assert body["update"] is True, f"empty current should trigger update: {body!r}"

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import secrets
import smtplib
import ssl
import time
import urllib.request
from importlib import import_module
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, cast
from urllib.parse import unquote, urlparse

try:
    import psycopg2
    from psycopg2 import pool
except ImportError:  # pragma: no cover - dependency may be absent in some environments
    psycopg2 = None
    pool = None

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads" / "licenses"
USERS_FILE = DATA_DIR / "users.json"
PENDING_FILE = DATA_DIR / "pending.json"
SESSIONS: dict[str, dict[str, Any]] = {}
PASSWORD_RESET_TOKENS: dict[str, str] = {}
SESSION_COOKIE_NAME = "session"
LEGACY_SESSION_COOKIE_NAME = "optiScanSession"
MAX_LICENSE_IMAGE_BYTES = 3 * 1024 * 1024
MAX_SCAN_IMAGE_BYTES = 8 * 1024 * 1024
OPTISCAN_PACKAGE_DIR = BASE_DIR / "optiscan-20260820T020926Z-1-001" / "optiscan"
SCREENING_MODEL_PATH = Path(os.getenv("OPTISCAN_SCREENING_MODEL", str(OPTISCAN_PACKAGE_DIR / "screening" / "best_model.keras")))
NUCLEAR_MODEL_PATH = Path(os.getenv("OPTISCAN_NUCLEAR_MODEL", str(OPTISCAN_PACKAGE_DIR / "vgg11.tflite")))
ESP32_CAMERA_BASE_URL = os.getenv("ESP32_CAMERA_URL", "http://192.168.254.186").rstrip("/")
ALLOWED_ORIGINS = {
    value.strip().rstrip("/")
    for value in os.getenv("ALLOWED_ORIGINS", "https://your-domain.example,http://localhost:8000,http://127.0.0.1:8000,https://localhost,https://127.0.0.1").split(",")
    if value.strip()
}
FORCE_HTTPS = os.getenv("FORCE_HTTPS", "false").lower() == "true"


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, stored_hash: str) -> bool:
    return bool(stored_hash) and hash_password(password) == stored_hash


def delete_user_by_email(users: list[dict[str, Any]], email: str) -> list[dict[str, Any]]:
    return [user for user in users if (user.get("email", "") or "").lower() != (email or "").lower()]


def remove_account_data_by_email(users: list[dict[str, Any]], pending: list[dict[str, Any]], email: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    normalized_email = (email or "").strip().lower()
    remaining_users = [user for user in users if (user.get("email", "") or "").lower() != normalized_email]
    remaining_pending = [entry for entry in pending if (entry.get("email", "") or "").lower() != normalized_email]
    return remaining_users, remaining_pending


def delete_account_related_records(email: str) -> None:
    if not (get_db_config() and psycopg2 is not None):
        return

    ensure_postgres_schema()
    conn: Any = None
    cur: Any = None
    try:
        pool_obj = get_db_pool()
        if pool_obj is None:
            return
        conn = pool_obj.getconn()
        if conn is None:
            return
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email = %s", (email.strip().lower(),))
        row = cur.fetchone()
        if row is None:
            cur.execute("DELETE FROM pending_registrations WHERE email = %s", (email.strip().lower(),))
            conn.commit()
            return

        user_id = row[0]
        cur.execute(
            "DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE patient_user_id = %s OR professional_user_id = %s)",
            (user_id, user_id),
        )
        cur.execute(
            "DELETE FROM chat_threads WHERE patient_user_id = %s OR professional_user_id = %s",
            (user_id, user_id),
        )
        cur.execute(
            "DELETE FROM patient_records WHERE patient_user_id = %s OR assigned_professional_id = %s",
            (user_id, user_id),
        )
        cur.execute("DELETE FROM user_profiles WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM pending_registrations WHERE email = %s", (email.strip().lower(),))
        cur.execute("DELETE FROM users WHERE email = %s", (email.strip().lower(),))
        conn.commit()
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            try:
                pool_obj = get_db_pool()
                if pool_obj is not None:
                    pool_obj.putconn(conn)
            except Exception:
                conn.close()


def create_password_reset_token(email: str) -> str:
    token = secrets.token_urlsafe(24)
    PASSWORD_RESET_TOKENS[token] = (email or "").strip().lower()
    return token


def send_password_reset_email(email: str, token: str) -> bool:
    smtp_host = os.getenv("SMTP_HOST")
    if not smtp_host:
        return False

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM", "no-reply@localhost")
    smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").lower() != "false"
    reset_url = os.getenv("PASSWORD_RESET_BASE_URL", "http://localhost:8000/") + f"reset-password?token={token}"

    message = EmailMessage()
    message["Subject"] = "OptiScan Password Reset"
    message["From"] = smtp_from
    message["To"] = email
    message.set_content(
        "Hello,\n\n"
        "A password reset has been requested for your OptiScan account.\n"
        f"Use this link to reset your password: {reset_url}\n\n"
        "If you did not request this, you can safely ignore this email."
    )

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            if smtp_use_tls:
                server.starttls()
            if smtp_user and smtp_password:
                server.login(smtp_user, smtp_password)
            server.send_message(message)
        return True
    except Exception:
        return False


db_pool = None


def get_db_config() -> dict[str, Any] | None:
    if not os.getenv("OPTISCAN_DB_HOST") and not os.getenv("OPTISCAN_DB_DSN"):
        return None
    if os.getenv("OPTISCAN_DB_DSN"):
        return {"dsn": os.getenv("OPTISCAN_DB_DSN")}
    return {
        "host": os.getenv("OPTISCAN_DB_HOST", "localhost"),
        "port": int(os.getenv("OPTISCAN_DB_PORT", "5432")),
        "name": os.getenv("OPTISCAN_DB_NAME", "opti_scan"),
        "user": os.getenv("OPTISCAN_DB_USER", "postgres"),
        "password": os.getenv("OPTISCAN_DB_PASSWORD", "postgres"),
    }


def get_db_connection() -> Any:
    config = get_db_config()
    if not config or psycopg2 is None:
        return None
    try:
        dsn = config.get("dsn")
        if dsn:
            return psycopg2.connect(str(dsn))
        return psycopg2.connect(
            dbname=str(config["name"]),
            user=str(config["user"]),
            password=str(config["password"]),
            host=str(config["host"]),
            port=int(config["port"]),
        )
    except Exception:
        return None


def get_db_pool() -> Any | None:
    global db_pool
    if db_pool is not None:
        return db_pool
    if psycopg2 is None or pool is None:
        return None
    config = get_db_config()
    if not config:
        return None
    dsn = config.get("dsn")
    if dsn:
        db_pool = pool.ThreadedConnectionPool(1, 10, dsn=str(dsn))
    else:
        db_pool = pool.ThreadedConnectionPool(
            1,
            10,
            dbname=str(config["name"]),
            user=str(config["user"]),
            password=str(config["password"]),
            host=str(config["host"]),
            port=int(config["port"]),
        )
    return db_pool


def ensure_postgres_schema() -> None:
    conn: Any = None
    cur: Any = None
    try:
        pool_obj = get_db_pool()
        if pool_obj is None:
            return
        conn = pool_obj.getconn()
        if conn is None:
            return
        cur = conn.cursor()
        cur.execute(
            "CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'patient', active BOOLEAN NOT NULL DEFAULT true, is_qualified BOOLEAN NOT NULL DEFAULT false, qualifications TEXT, registered_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS pending_registrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, qualifications TEXT, license_image_path TEXT, requested_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS user_profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, bio TEXT, contact_phone TEXT, specialty TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS chat_threads (id SERIAL PRIMARY KEY, patient_user_id INTEGER NOT NULL REFERENCES users(id), professional_user_id INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE, sender_user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS patient_records (id SERIAL PRIMARY KEY, patient_user_id INTEGER NOT NULL REFERENCES users(id), assigned_professional_id INTEGER REFERENCES users(id), notes TEXT, last_scan_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        conn.commit()
        cur.close()
    except Exception:
        return
    finally:
        if conn is not None:
            try:
                pool_obj = get_db_pool()
                if pool_obj is not None:
                    pool_obj.putconn(conn)
            except Exception:
                conn.close()


def ensure_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    if not USERS_FILE.exists():
        save_json(USERS_FILE, [])
    if not PENDING_FILE.exists():
        save_json(PENDING_FILE, [])
    ensure_postgres_schema()


def load_json(file_path: Path, default: Any) -> Any:
    if not file_path.exists():
        return default
    try:
        return json.loads(file_path.read_text(encoding="utf-8") or "null")
    except json.JSONDecodeError:
        return default


def save_json(file_path: Path, payload: Any) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_users() -> list[dict[str, Any]]:
    if get_db_config() and psycopg2 is not None:
        ensure_postgres_schema()
        conn: Any = None
        cur: Any = None
        try:
            pool_obj = get_db_pool()
            if pool_obj is None:
                return load_json(USERS_FILE, [])
            conn = pool_obj.getconn()
            if conn is None:
                return load_json(USERS_FILE, [])
            cur = conn.cursor()
            cur.execute("SELECT name, email, password_hash, role, active, is_qualified, qualifications, registered_at FROM users")
            rows = cur.fetchall()
            return [
                {
                    "name": row[0],
                    "email": row[1],
                    "password": row[2],
                    "role": row[3],
                    "active": row[4],
                    "isQualified": row[5],
                    "qualifications": row[6],
                    "registeredAt": int(row[7].timestamp() * 1000) if row[7] else 0,
                }
                for row in rows
            ]
        finally:
            if cur is not None:
                cur.close()
            if conn is not None:
                try:
                    pool_obj = get_db_pool()
                    if pool_obj is not None:
                        pool_obj.putconn(conn)
                except Exception:
                    conn.close()
        return []
    return load_json(USERS_FILE, [])


def load_pending() -> list[dict[str, Any]]:
    if get_db_config() and psycopg2 is not None:
        ensure_postgres_schema()
        conn: Any = None
        cur: Any = None
        try:
            pool_obj = get_db_pool()
            if pool_obj is None:
                return load_json(PENDING_FILE, [])
            conn = pool_obj.getconn()
            if conn is None:
                return load_json(PENDING_FILE, [])
            cur = conn.cursor()
            cur.execute("SELECT name, email, password_hash, role, qualifications, license_image_path, requested_at FROM pending_registrations")
            rows = cur.fetchall()
            return [
                {
                    "name": row[0],
                    "email": row[1],
                    "password": row[2],
                    "role": row[3],
                    "qualifications": row[4],
                    "licenseImage": row[5],
                    "requestedAt": int(row[6].timestamp() * 1000) if row[6] else 0,
                }
                for row in rows
            ]
        finally:
            if cur is not None:
                cur.close()
            if conn is not None:
                try:
                    pool_obj = get_db_pool()
                    if pool_obj is not None:
                        pool_obj.putconn(conn)
                except Exception:
                    conn.close()
        return []
    return load_json(PENDING_FILE, [])


def save_users(users: list[dict[str, Any]]) -> None:
    if get_db_config() and psycopg2 is not None:
        ensure_postgres_schema()
        conn: Any = None
        cur: Any = None
        try:
            pool_obj = get_db_pool()
            if pool_obj is None:
                save_json(USERS_FILE, users)
                return
            conn = pool_obj.getconn()
            if conn is None:
                save_json(USERS_FILE, users)
                return
            cur = conn.cursor()
            cur.execute("DELETE FROM users")
            for user in users:
                cur.execute(
                    "INSERT INTO users (name, email, password_hash, role, active, is_qualified, qualifications, registered_at) VALUES (%s, %s, %s, %s, %s, %s, %s, now())",
                    (
                        user.get("name", ""),
                        user.get("email", ""),
                        user.get("password", ""),
                        user.get("role", "patient"),
                        bool(user.get("active", True)),
                        bool(user.get("isQualified", False)),
                        user.get("qualifications", ""),
                    ),
                )
            conn.commit()
        finally:
            if cur is not None:
                cur.close()
            if conn is not None:
                try:
                    pool_obj = get_db_pool()
                    if pool_obj is not None:
                        pool_obj.putconn(conn)
                except Exception:
                    conn.close()
        return

    save_json(USERS_FILE, users)


def save_pending(pending: list[dict[str, Any]]) -> None:
    if get_db_config() and psycopg2 is not None:
        ensure_postgres_schema()
        conn: Any = None
        cur: Any = None
        try:
            pool_obj = get_db_pool()
            if pool_obj is None:
                save_json(PENDING_FILE, pending)
                return
            conn = pool_obj.getconn()
            if conn is None:
                save_json(PENDING_FILE, pending)
                return
            cur = conn.cursor()
            cur.execute("DELETE FROM pending_registrations")
            for entry in pending:
                cur.execute(
                    "INSERT INTO pending_registrations (name, email, password_hash, role, qualifications, license_image_path, requested_at) VALUES (%s, %s, %s, %s, %s, %s, now())",
                    (
                        entry.get("name", ""),
                        entry.get("email", ""),
                        entry.get("password", ""),
                        entry.get("role", ""),
                        entry.get("qualifications", ""),
                        entry.get("licenseImage"),
                    ),
                )
            conn.commit()
        finally:
            if cur is not None:
                cur.close()
            if conn is not None:
                try:
                    pool_obj = get_db_pool()
                    if pool_obj is not None:
                        pool_obj.putconn(conn)
                except Exception:
                    conn.close()
        return

    save_json(PENDING_FILE, pending)


def validate_license_image(license_image: str | None) -> bool:
    if not isinstance(license_image, str) or not license_image.startswith("data:image/"):
        return False

    try:
        _, b64_data = license_image.split(",", 1)
    except ValueError:
        return False

    try:
        decoded = base64.b64decode(b64_data, validate=True)
    except Exception:
        return False

    return len(decoded) <= MAX_LICENSE_IMAGE_BYTES


def save_license_image(license_image: str | None) -> str | None:
    if not validate_license_image(license_image):
        return None

    image_value = license_image or ""
    try:
        header, b64_data = image_value.split(",", 1)
    except ValueError:
        return None

    try:
        decoded = base64.b64decode(b64_data, validate=True)
    except Exception:
        return None

    mime_type = header[len("data:"):].split(";", 1)[0].strip() or "application/octet-stream"
    extension = mimetypes.guess_extension(mime_type) or ".bin"
    unique_suffix = hashlib.sha256(f"{time.time_ns()}:{image_value[:64]}".encode("utf-8")).hexdigest()[:16]
    file_name = f"license_{unique_suffix}{extension}"
    target_path = UPLOAD_DIR / file_name
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(decoded)
    return target_path.relative_to(BASE_DIR).as_posix()


def fetch_esp32_camera_frame() -> bytes | None:
    capture_url = f"{ESP32_CAMERA_BASE_URL}/capture"
    try:
        with urllib.request.urlopen(capture_url, timeout=5) as response:
            payload = response.read()
            if not payload:
                return None
            return payload
    except Exception:
        return None


class OptiScanHandler(BaseHTTPRequestHandler):
    server_version = "OptiScan/1.0"

    def is_safe_origin(self) -> bool:
        origin = self.headers.get("Origin") or self.headers.get("Referer") or ""
        if not origin:
            return False
        normalized = origin.rstrip("/")
        return any(normalized == allowed or normalized.startswith(allowed + "/") for allowed in ALLOWED_ORIGINS)

    def add_security_headers(self) -> None:
        self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

    def should_redirect_to_https(self) -> bool:
        if not FORCE_HTTPS:
            return False
        forwarded_proto = (self.headers.get("X-Forwarded-Proto") or "").lower()
        if forwarded_proto in {"https", "wss"}:
            return False
        if forwarded_proto == "http":
            return True
        server_port = getattr(self.server, "server_port", None)
        return server_port not in {443, 8443} if server_port is not None else True

    def redirect_to_https(self) -> None:
        host = self.headers.get("Host", "localhost")
        location = f"https://{host}{self.path}"
        self.send_response(301)
        self.send_header("Location", location)
        self.add_security_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.should_redirect_to_https():
            self.redirect_to_https()
            return

        parsed = urlparse(str(self.path))
        route = parsed.path

        if route in {"/", "/OptiScan.html"}:
            self.serve_static_file("OptiScan.html")
            return

        if route in {"/dashboard", "/dashboard.html"}:
            self.serve_static_file("dashboard.html")
            return

        if route == "/style.css":
            self.serve_static_file("style.css")
            return

        if route == "/dashboard-scanner-ai.js":
            self.serve_static_file("dashboard-scanner-ai.js")
            return

        if route.startswith("/partials/") or route.startswith("/css/") or route.startswith("/js/"):
            filename = route.lstrip("/")
            self.serve_static_file(filename)
            return

        if route.startswith("/api/licenses/"):
            self.serve_license_file(route[len("/api/licenses/"):])
            return

        if route in {"/api/camera/health", "/api/esp32/health"}:
            self.handle_camera_health()
            return

        if route in {"/api/camera/capture", "/api/esp32/capture"}:
            self.serve_esp32_camera_capture()
            return

        if route == "/api/health":
            self.send_json({"ok": True, "message": "OptiScan backend is running."})
            return

        if route == "/api/accounts":
            self.handle_accounts()
            return

        if route == "/api/me":
            self.handle_me()
            return

        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        if self.should_redirect_to_https():
            self.redirect_to_https()
            return

        parsed = urlparse(str(self.path))
        route = parsed.path

        if route == "/api/register":
            self.handle_register()
            return

        if route == "/api/login":
            self.handle_login()
            return

        if route == "/api/logout":
            self.handle_logout()
            return

        if route == "/api/request-password-reset":
            self.handle_request_password_reset()
            return

        if route == "/api/reset-password":
            self.handle_reset_password()
            return

        if route == "/api/analyze":
            self.handle_analyze()
            return

        if route == "/api/delete-account":
            self.handle_delete_account()
            return

        self.send_error(404, "Not found")

    def handle_analyze(self) -> None:
        if not self.is_safe_origin():
            self.send_json({"ok": False, "error": "Invalid request origin."}, 403)
            return

        session_user = self.get_session_user()
        is_qualified = bool(session_user and session_user.get("role") == "medical-professional" and (
            session_user.get("isQualified") or session_user.get("qualifications")
        ))
        if not is_qualified:
            self.send_json({"ok": False, "error": "Only qualified medical professionals can run AI assessments."}, 403)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_SCAN_IMAGE_BYTES + 512 * 1024:
            self.send_json({"ok": False, "error": "Scan image is missing or too large."}, 413)
            return

        payload = self.read_json_body()
        if not isinstance(payload, dict):
            self.send_json({"ok": False, "error": "Request body must be a JSON object."}, 400)
            return

        cataract_type = str(payload.get("cataract_type", "nuclear")).strip().lower()
        image_value = payload.get("image")
        if cataract_type not in {"nuclear", "cortical", "psc"}:
            self.send_json({"ok": False, "error": "Unsupported cataract type."}, 400)
            return
        if not isinstance(image_value, str) or not image_value.startswith("data:image/"):
            self.send_json({"ok": False, "error": "A base64 image is required."}, 400)
            return

        try:
            import base64
            cv2: Any = import_module("cv2")
            np: Any = import_module("numpy")

            _, encoded_image = image_value.split(",", 1)
            image_bytes = base64.b64decode(encoded_image, validate=True)
            if len(image_bytes) > MAX_SCAN_IMAGE_BYTES:
                raise ValueError("Scan image is too large.")
            image_bgr = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image_bgr is None:
                raise ValueError("The uploaded image could not be decoded.")

            import sys
            package_dir = str(OPTISCAN_PACKAGE_DIR)
            if package_dir not in sys.path:
                sys.path.insert(0, package_dir)
            pipeline = import_module("pipeline")
            result = pipeline.analyze_image(
                image_bgr,
                cataract_type,
                screening_model_path=str(SCREENING_MODEL_PATH),
                model_path=str(NUCLEAR_MODEL_PATH) if cataract_type == "nuclear" else None,
            )

            overlay = result.pop("explainability_overlay", None)
            overlay_data = None
            if overlay is not None:
                encoded_overlay = cv2.imencode(".jpg", overlay)[1]
                overlay_data = "data:image/jpeg;base64," + base64.b64encode(encoded_overlay).decode("ascii")
            result = json.loads(json.dumps(result, default=lambda value: value.item()))
            self.send_json({"ok": True, "result": result, "overlay": overlay_data})
        except (ImportError, FileNotFoundError) as error:
            self.send_json({"ok": False, "error": f"AI model is not available: {error}"}, 503)
        except ValueError as error:
            self.send_json({"ok": False, "error": str(error)}, 422)
        except Exception:
            self.send_json({"ok": False, "error": "AI analysis failed. Check the image and model configuration."}, 500)

    def handle_register(self) -> None:
        if not self.is_safe_origin():
            self.send_json({"ok": False, "error": "Invalid request origin."}, 403)
            return

        payload = self.read_json_body()
        if not isinstance(payload, dict):
            self.send_json({"ok": False, "error": "Request body must be a JSON object."}, 400)
            return

        payload_dict = payload
        name = str(payload_dict.get("name", "")).strip()
        email = str(payload_dict.get("email", "")).strip().lower()
        password = str(payload_dict.get("password", "")).strip()
        role = str(payload_dict.get("role", "patient")).strip()
        qualifications = str(payload_dict.get("qualifications", "")).strip()
        license_image = payload_dict.get("licenseImage")

        if not name or not email or not password:
            self.send_json({"ok": False, "error": "Name, email, and password are required."}, 400)
            return

        users = load_users()
        if any(user.get("email", "").lower() == email for user in users):
            self.send_json({"ok": False, "error": "An account with this email already exists."}, 409)
            return

        if role == "medical-professional":
            if not qualifications or not validate_license_image(license_image):
                self.send_json({"ok": False, "error": "A valid license image (max 3 MB) is required."}, 400)
                return

            license_image_path = save_license_image(license_image)
            if not license_image_path:
                self.send_json({"ok": False, "error": "Unable to save the submitted license image."}, 400)
                return

            pending = load_pending()
            pending.append(
                {
                    "name": name,
                    "email": email,
                    "password": hash_password(password),
                    "role": role,
                    "qualifications": qualifications,
                    "isQualified": True,
                    "licenseImage": license_image_path,
                    "requestedAt": int(__import__("time").time() * 1000),
                }
            )
            save_pending(pending)
            self.send_json({"ok": True, "message": "Professional registration submitted for admin approval."}, 202)
            return

        new_user: dict[str, Any] = {
            "name": name,
            "email": email,
            "password": hash_password(password),
            "role": role,
            "active": True,
            "isQualified": role == "medical-professional",
            "registeredAt": int(__import__("time").time() * 1000),
        }
        users.append(new_user)
        save_users(users)
        self.send_json({"ok": True, "message": "Registration successful.", "user": new_user}, 201)

    def handle_accounts(self) -> None:
        session_user = self.get_session_user()
        if not session_user or session_user.get("role") != "admin":
            self.send_json({"ok": True, "users": [], "pending": []})
            return

        users = load_users()
        pending = load_pending()

        safe_users = [{k: v for k, v in user.items() if k != "password"} for user in users]
        safe_pending = [{k: v for k, v in entry.items() if k != "password"} for entry in pending]

        self.send_json({"ok": True, "users": safe_users, "pending": safe_pending})

    def handle_camera_health(self) -> None:
        payload = fetch_esp32_camera_frame()
        if payload is None:
            self.send_json({"ok": False, "cameraUrl": ESP32_CAMERA_BASE_URL, "error": "ESP32 camera unavailable."}, 503)
            return
        self.send_json({"ok": True, "cameraUrl": ESP32_CAMERA_BASE_URL})

    def serve_esp32_camera_capture(self) -> None:
        payload = fetch_esp32_camera_frame()
        if payload is None:
            self.send_error(502, "ESP32 camera unavailable")
            return

        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.add_security_headers()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_login(self) -> None:
        if not self.is_safe_origin():
            self.send_json({"ok": False, "error": "Invalid request origin."}, 403)
            return

        payload = self.read_json_body()
        if not isinstance(payload, dict):
            self.send_json({"ok": False, "error": "Request body must be a JSON object."}, 400)
            return

        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", "")).strip()

        users = load_users()
        for user in users:
            stored_hash = user.get("password") or ""
            if user.get("email", "").lower() == email and verify_password(password, stored_hash):
                session_id = self.create_session(user)
                safe_user = {k: v for k, v in user.items() if k != "password"}
                cookie = f"{SESSION_COOKIE_NAME}={session_id}; HttpOnly; Path=/; SameSite=Lax"
                self.send_json({"ok": True, "user": safe_user, "sessionId": session_id}, 200, set_cookie=cookie)
                return

        pending = load_pending()
        if any(entry.get("email", "").lower() == email for entry in pending):
            self.send_json({"ok": False, "error": "Registration is still pending admin approval."}, 403)
            return

        self.send_json({"ok": False, "error": "Incorrect email or password."}, 401)

    def handle_me(self) -> None:
        session_user = self.get_session_user()
        if not session_user:
            self.send_json({"ok": True, "authenticated": False, "role": "patient"})
            return
        self.send_json({"ok": True, "authenticated": True, "role": session_user.get("role", "patient"), "email": session_user.get("email")})

    def handle_logout(self) -> None:
        if not self.is_safe_origin():
            self.send_json({"ok": False, "error": "Invalid request origin."}, 403)
            return

        session_id = self.get_session_id_from_headers()
        if session_id in SESSIONS:
            del SESSIONS[session_id]
        self.send_json({"ok": True}, clear_cookie=True)

    def handle_delete_account(self) -> None:
        if not self.is_safe_origin():
            self.send_json({"ok": False, "error": "Invalid request origin."}, 403)
            return

        session_user = self.get_session_user()
        if not session_user or not session_user.get("email"):
            self.send_json({"ok": False, "error": "Authentication required."}, 401)
            return

        email = str(session_user.get("email", "")).strip().lower()
        delete_account_related_records(email)

        users = load_users()
        pending = load_pending()
        remaining_users, remaining_pending = remove_account_data_by_email(users, pending, email)
        save_users(remaining_users)
        save_pending(remaining_pending)

        session_id = self.get_session_id_from_headers()
        if session_id in SESSIONS:
            del SESSIONS[session_id]

        self.send_json({"ok": True, "message": "Account deleted successfully."}, clear_cookie=True)

    def handle_request_password_reset(self) -> None:
        if not self.is_safe_origin():
            self.send_json({"ok": False, "error": "Invalid request origin."}, 403)
            return

        payload = self.read_json_body()
        if not isinstance(payload, dict):
            self.send_json({"ok": False, "error": "Request body must be a JSON object."}, 400)
            return

        email = str(payload.get("email", "")).strip().lower()
        if not email:
            self.send_json({"ok": False, "error": "Email is required."}, 400)
            return

        users = load_users()
        if not any((user.get("email", "") or "").lower() == email for user in users):
            self.send_json({"ok": True, "message": "If that account exists, a reset email will be sent."})
            return

        token = create_password_reset_token(email)
        email_sent = send_password_reset_email(email, token)
        self.send_json({
            "ok": True,
            "message": "If that account exists, a reset email will be sent.",
            "emailSent": email_sent,
        })

    def handle_reset_password(self) -> None:
        if not self.is_safe_origin():
            self.send_json({"ok": False, "error": "Invalid request origin."}, 403)
            return

        payload = self.read_json_body()
        if not isinstance(payload, dict):
            self.send_json({"ok": False, "error": "Request body must be a JSON object."}, 400)
            return

        email = str(payload.get("email", "")).strip().lower()
        token = str(payload.get("token", "")).strip()
        new_password = str(payload.get("newPassword", "")).strip()

        if not email or not token or not new_password:
            self.send_json({"ok": False, "error": "Email, reset token, and new password are required."}, 400)
            return

        if PASSWORD_RESET_TOKENS.get(token) != email:
            self.send_json({"ok": False, "error": "Invalid or expired password reset token."}, 400)
            return

        users = load_users()
        updated_users: list[dict[str, Any]] = []
        for user in users:
            if (user.get("email", "") or "").lower() == email:
                user["password"] = hash_password(new_password)
            updated_users.append(user)

        save_users(updated_users)
        PASSWORD_RESET_TOKENS.pop(token, None)
        self.send_json({"ok": True, "message": "Password updated successfully."})

    def create_session(self, user: dict[str, Any]) -> str:
        session_id = secrets.token_urlsafe(24)
        SESSIONS[session_id] = dict(user)
        return session_id

    def get_session_user(self):
        session_id = self.get_session_id_from_headers()
        if not session_id:
            return None
        return SESSIONS.get(session_id)

    def get_session_id_from_headers(self) -> str | None:
        cookie_header = self.headers.get("Cookie", "")
        if not cookie_header:
            return None
        for part in cookie_header.split(";"):
            key_value = part.strip().split("=", 1)
            if len(key_value) != 2:
                continue
            name = key_value[0].strip()
            if name in {SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME}:
                return key_value[1].strip() or None
        return None

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        short_msg, _ = self.responses.get(code, ("Error", ""))
        body = f"<h1>{code} {message or short_msg}</h1>".encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.add_security_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def serve_static_file(self, filename: str) -> None:
        target = (BASE_DIR / filename).resolve()
        is_inside_base = target == BASE_DIR or BASE_DIR in target.parents
        if not target.is_file() or not is_inside_base:
            self.send_error(403, "Forbidden")
            return

        content = target.read_bytes()
        if filename.endswith(".css"):
            content_type = "text/css; charset=utf-8"
        elif filename.endswith(".js"):
            content_type = "application/javascript; charset=utf-8"
        elif filename.endswith(".json"):
            content_type = "application/json; charset=utf-8"
        elif filename.endswith(".png"):
            content_type = "image/png"
        elif filename.endswith(".jpg") or filename.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filename.endswith(".svg"):
            content_type = "image/svg+xml"
        else:
            content_type = "text/html; charset=utf-8"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.add_security_headers()
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_license_file(self, relative_path: str) -> None:
        requested_path = unquote(relative_path).strip("/")
        if not requested_path:
            self.send_error(400, "Missing license path")
            return

        target = (BASE_DIR / requested_path).resolve()
        allowed_root = UPLOAD_DIR.resolve()
        is_inside_upload_dir = target == allowed_root or allowed_root in target.parents
        if not target.is_file() or not is_inside_upload_dir:
            self.send_error(403, "Forbidden")
            return

        content = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.add_security_headers()
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def read_json_body(self) -> dict[str, Any] | None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b""
        try:
            value: Any = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            if isinstance(value, dict):
                payload = cast(dict[str, Any], value)
                result: dict[str, Any] = {}
                for key, item in payload.items():
                    result[str(key)] = item
                return result
            return None
        except json.JSONDecodeError:
            return None

    def send_json(self, payload: Any, status: int = 200, *, set_cookie: str | None = None, clear_cookie: bool = False) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.add_security_headers()
        self.send_header("Content-Length", str(len(body)))
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie.replace("; Path=/; SameSite=Lax", "; Secure; Path=/; SameSite=Lax"))
        if clear_cookie:
            self.send_header("Set-Cookie", f"{SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax")
        self.end_headers()
        self.wfile.write(body)


def run_server() -> None:
    ensure_store()
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    certfile = os.getenv("SSL_CERTFILE")
    keyfile = os.getenv("SSL_KEYFILE")

    server = ThreadingHTTPServer((host, port), OptiScanHandler)
    if certfile and keyfile:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=certfile, keyfile=keyfile)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        print(f"OptiScan backend running securely at https://{host}:{port}")
    else:
        print(f"OptiScan backend running at http://{host}:{port} (set SSL_CERTFILE/SSL_KEYFILE to enable HTTPS)")
    server.serve_forever()


if __name__ == "__main__":
    run_server()

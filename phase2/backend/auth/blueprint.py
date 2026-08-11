"""
Person 3 - Data Security & Authentication.

All routes here are registered into the same Function App as Person 1's
insights/recipes/clusters endpoints (see function_app.py), so the whole
backend deploys as one Azure Function App.

Endpoints:
  POST /api/auth/register        - email + password signup
  POST /api/auth/login           - email + password login
  POST /api/auth/logout          - client discards its token (JWTs are stateless)
  GET  /api/auth/me              - returns the logged-in user (for the dashboard's
                                    top-right name + as a "is this token valid" check)
  GET  /api/auth/google/login    - redirects to Google's consent screen
  GET  /api/auth/google/callback - Google redirects back here; issues our own JWT
"""
import json
import os

import azure.functions as func
from jose import JWTError

from auth.security import hash_password, verify_password, create_access_token, decode_access_token
from auth.encryption import encrypt_field, decrypt_field
from auth.store import get_user_by_email, get_user_by_oauth_sub, create_user, upsert_user
from auth.google_oauth import build_authorize_url, verify_state, exchange_code_for_userinfo
from auth.deps import get_authenticated_user

bp = func.Blueprint()


def _json_response(payload: dict, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(json.dumps(payload), mimetype="application/json", status_code=status_code)


def _error(message: str, status_code: int) -> func.HttpResponse:
    return _json_response({"error": message}, status_code)


def _user_to_public_dict(user: dict) -> dict:
    return {
        "email": user["email"],
        "full_name": decrypt_field(user.get("full_name_encrypted")) or user["email"],
        "oauth_provider": user.get("oauth_provider"),
    }


# ── Email / Password ─────────────────────────────────────────────────────

@bp.route(route="auth/register", methods=["POST"])
def auth_register(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _error("Request body must be JSON.", 400)

    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    full_name = (body.get("full_name") or "").strip()

    if not email or "@" not in email:
        return _error("A valid email is required.", 400)
    if len(password) < 8:
        return _error("Password must be at least 8 characters.", 400)
    if not full_name:
        return _error("Full name is required.", 400)

    if get_user_by_email(email) is not None:
        return _error("An account with this email already exists.", 400)

    create_user(
        email=email,
        password_hash=hash_password(password),          # bcrypt hash, never plaintext
        full_name_encrypted=encrypt_field(full_name),    # encrypted at rest
    )

    token = create_access_token(email)
    return _json_response({"access_token": token, "token_type": "bearer"}, 201)


@bp.route(route="auth/login", methods=["POST"])
def auth_login(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return _error("Request body must be JSON.", 400)

    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    user = get_user_by_email(email)
    if user is None or not user.get("password_hash") or not verify_password(password, user["password_hash"]):
        # Same generic error whether the account doesn't exist or the
        # password is wrong - avoids leaking which one it was.
        return _error("Incorrect email or password.", 401)

    token = create_access_token(email)
    return _json_response({"access_token": token, "token_type": "bearer"})


@bp.route(route="auth/logout", methods=["POST"])
def auth_logout(req: func.HttpRequest) -> func.HttpResponse:
    user = get_authenticated_user(req)
    if user is None:
        return _error("Not logged in.", 401)
    # JWTs are stateless - "logout" is really the frontend deleting its
    # stored token. This endpoint exists so Person 2's logout button has
    # something to call, and is a natural place to add a token denylist
    # later if the team wants true server-side revocation.
    return _json_response({"message": "Logged out. Please discard your access token."})


@bp.route(route="auth/me", methods=["GET"])
def auth_me(req: func.HttpRequest) -> func.HttpResponse:
    user = get_authenticated_user(req)
    if user is None:
        return _error("Not authenticated.", 401)
    return _json_response(_user_to_public_dict(user))


# ── Google OAuth ──────────────────────────────────────────────────────────

@bp.route(route="auth/google/login", methods=["GET"])
def auth_google_login(req: func.HttpRequest) -> func.HttpResponse:
    url = build_authorize_url()
    return func.HttpResponse(status_code=302, headers={"Location": url})


@bp.route(route="auth/google/callback", methods=["GET"])
def auth_google_callback(req: func.HttpRequest) -> func.HttpResponse:
    code = req.params.get("code")
    state = req.params.get("state")
    frontend_url = os.environ.get("FRONTEND_REDIRECT_URL", "/")

    if not code or not state:
        return _error("Missing code or state from Google.", 400)

    try:
        verify_state(state)
    except JWTError:
        return _error("Invalid or expired OAuth state.", 400)

    userinfo = exchange_code_for_userinfo(code)
    google_sub = userinfo["sub"]
    email = userinfo["email"].strip().lower()
    name = userinfo.get("name", email)

    user = get_user_by_oauth_sub(google_sub) or get_user_by_email(email)

    if user is None:
        user = create_user(
            email=email,
            password_hash=None,  # OAuth-only account, no password
            full_name_encrypted=encrypt_field(name),
            oauth_provider="google",
            oauth_sub=google_sub,
        )
    elif not user.get("oauth_sub"):
        # Existing email/password user is now also linking Google login
        user["oauth_provider"] = "google"
        user["oauth_sub"] = google_sub
        upsert_user(user)

    token = create_access_token(email)
    return func.HttpResponse(status_code=302, headers={"Location": f"{frontend_url}?token={token}"})

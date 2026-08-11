"""
Google OAuth 2.0 login, implemented as plain HTTP calls (no session
middleware) since Azure Functions instances are stateless.

CSRF protection normally relies on a server-side session to remember the
'state' value between the login redirect and the callback. Instead, we
sign the state as a short-lived JWT (see security.create_short_lived_token)
- the callback just has to verify the signature and expiry, no session
storage needed.
"""
import os
from urllib.parse import urlencode

import requests

from auth.security import create_short_lived_token, decode_short_lived_token

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo"


def build_authorize_url() -> str:
    state = create_short_lived_token(purpose="oauth_state")
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": os.environ["GOOGLE_REDIRECT_URI"],
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"


def verify_state(state: str) -> None:
    """Raises jose.JWTError if the state is missing, tampered with, or expired."""
    decode_short_lived_token(state, expected_purpose="oauth_state")


def exchange_code_for_userinfo(code: str) -> dict:
    """Returns Google's userinfo dict: {sub, email, name, ...}."""
    token_resp = requests.post(
        GOOGLE_TOKEN_ENDPOINT,
        data={
            "code": code,
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": os.environ["GOOGLE_REDIRECT_URI"],
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    token_resp.raise_for_status()
    access_token = token_resp.json()["access_token"]

    userinfo_resp = requests.get(
        GOOGLE_USERINFO_ENDPOINT,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    userinfo_resp.raise_for_status()
    return userinfo_resp.json()

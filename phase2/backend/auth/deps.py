"""
Shared helper for any route (in this file or in Person 1's function_app.py)
that needs to require login.

Usage in another route:

    from auth.deps import get_authenticated_user

    @app.route(route="insights", methods=["GET"])
    def get_insights(req: func.HttpRequest) -> func.HttpResponse:
        user = get_authenticated_user(req)
        if user is None:
            return func.HttpResponse('{"error": "Login required"}', status_code=401,
                                      mimetype="application/json")
        ...
"""
import azure.functions as func
from jose import JWTError

from auth.security import decode_access_token
from auth.store import get_user_by_email


def get_authenticated_user(req: func.HttpRequest) -> dict | None:
    """Returns the user dict from Cosmos if the request has a valid
    'Authorization: Bearer <token>' header, otherwise None."""
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
    except JWTError:
        return None

    email = payload.get("sub")
    if not email:
        return None

    return get_user_by_email(email)

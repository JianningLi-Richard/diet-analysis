"""
User storage in Cosmos DB.

Reuses the SAME Cosmos account/database Person 1 already provisioned for
result caching (COSMOS_ENDPOINT / COSMOS_KEY / COSMOS_DATABASE), just a
different container ("users" by default) so user accounts and cached
computation results stay cleanly separated.

Document shape (id == email, used as the partition key too):
{
  "id": "kate@sait.ca",
  "email": "kate@sait.ca",
  "password_hash": "$2b$12$...",       # bcrypt hash, or None for OAuth-only accounts
  "full_name_encrypted": "gAAAA...",   # Fernet-encrypted, see encryption.py
  "oauth_provider": "google" | None,
  "oauth_sub": "<google user id>" | None,
  "created_at": "2026-08-10T12:00:00+00:00"
}
"""
import os
import logging
from datetime import datetime, timezone

from azure.cosmos import CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError

_cosmos_client = None
_users_container_client = None


def _cosmos() -> CosmosClient:
    global _cosmos_client
    if _cosmos_client is None:
        _cosmos_client = CosmosClient(os.environ["COSMOS_ENDPOINT"], os.environ["COSMOS_KEY"])
    return _cosmos_client


def _users_container():
    global _users_container_client
    if _users_container_client is not None:
        return _users_container_client
    database = _cosmos().get_database_client(os.environ.get("COSMOS_DATABASE", "dietanalysis"))
    _users_container_client = database.get_container_client(
        os.environ.get("COSMOS_USERS_CONTAINER", "users")
    )
    return _users_container_client


def get_user_by_email(email: str):
    try:
        return _users_container().read_item(item=email, partition_key=email)
    except CosmosResourceNotFoundError:
        return None


def get_user_by_oauth_sub(oauth_sub: str):
    query = "SELECT * FROM c WHERE c.oauth_sub = @sub"
    items = list(
        _users_container().query_items(
            query=query,
            parameters=[{"name": "@sub", "value": oauth_sub}],
            enable_cross_partition_query=True,
        )
    )
    return items[0] if items else None


def create_user(
    email: str,
    password_hash: str = None,
    full_name_encrypted: str = None,
    oauth_provider: str = None,
    oauth_sub: str = None,
) -> dict:
    doc = {
        "id": email,
        "email": email,
        "password_hash": password_hash,
        "full_name_encrypted": full_name_encrypted,
        "oauth_provider": oauth_provider,
        "oauth_sub": oauth_sub,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _users_container().create_item(doc)
    return doc


def upsert_user(doc: dict) -> dict:
    _users_container().upsert_item(doc)
    return doc


def ensure_users_container_exists():
    """Optional helper - creates the 'users' container if it doesn't exist
    yet, so the team doesn't have to click through the Azure Portal.
    Call this once manually (e.g. from a local script) rather than on
    every cold start, to avoid an extra Cosmos call on the hot path."""
    database = _cosmos().get_database_client(os.environ.get("COSMOS_DATABASE", "dietanalysis"))
    container_name = os.environ.get("COSMOS_USERS_CONTAINER", "users")
    try:
        database.create_container(id=container_name, partition_key={"paths": ["/email"], "kind": "Hash"})
        logging.info("Created Cosmos container '%s'", container_name)
    except Exception as exc:  # noqa: BLE001
        logging.info("Container '%s' probably already exists: %s", container_name, exc)

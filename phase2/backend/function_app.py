import json
import logging
import os
import time
from datetime import datetime, timezone
from io import BytesIO

import azure.functions as func
import pandas as pd
from azure.core.exceptions import ResourceNotFoundError
from azure.cosmos import CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from azure.storage.blob import BlobServiceClient

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# Person 3 - Data Security & Authentication routes (/api/auth/*).
# Registered as a blueprint so this file doesn't have to change beyond
# these two lines - see auth/blueprint.py for the actual routes.
from auth.blueprint import bp as auth_bp  # noqa: E402
app.register_functions(auth_bp)

NUMERIC_COLS = ["Protein(g)", "Carbs(g)", "Fat(g)"]

RAW_BLOB_NAME = os.environ.get("DIET_DATA_BLOB", "All_Diets.csv")
CLEAN_BLOB_NAME = os.environ.get("DIET_DATA_CLEAN_BLOB", "All_Diets_clean.csv")

# Cached in memory for the lifetime of the function instance so we don't
# re-download the cleaned CSV from Blob Storage on every request.
_cached_df = None

# Cosmos client is expensive to construct, so we build it once per warm
# instance and reuse it, same idea as _cached_df above.
_cosmos_container_client = None

# Cache document ids. Recipes is only cached for the default top=5 request -
# other "top" values are rare and just computed on the fly instead of
# caching every possible value.
CACHE_ID_INSIGHTS = "insights"
CACHE_ID_RECIPES_TOP5 = "recipes_top5"
CACHE_ID_CLUSTERS = "clusters"


def _blob_service() -> BlobServiceClient:
    conn_str = os.environ["AZURE_STORAGE_CONNECTION_STRING"]
    return BlobServiceClient.from_connection_string(conn_str)


def _cosmos_container():
    """Returns the Cosmos DB container we use as a cache for computed
    endpoint results, creating the client once per warm instance."""
    global _cosmos_container_client
    if _cosmos_container_client is not None:
        return _cosmos_container_client

    client = CosmosClient(os.environ["COSMOS_ENDPOINT"], os.environ["COSMOS_KEY"])
    database = client.get_database_client(os.environ.get("COSMOS_DATABASE", "dietanalysis"))
    _cosmos_container_client = database.get_container_client(os.environ.get("COSMOS_CONTAINER", "cache"))
    return _cosmos_container_client


def _cache_get(doc_id: str):
    """Returns the cached data list for doc_id, or None if nothing is
    cached yet (first run, or the cache was never populated)."""
    try:
        item = _cosmos_container().read_item(item=doc_id, partition_key=doc_id)
        return item["data"]
    except CosmosResourceNotFoundError:
        return None
    except Exception as exc:  # noqa: BLE001
        # If Cosmos is misconfigured or briefly unavailable, don't take the
        # whole endpoint down - just log it and fall back to computing fresh.
        logging.warning("Cosmos cache read failed for %s: %s", doc_id, exc)
        return None


def _cache_put(doc_id: str, data) -> None:
    try:
        _cosmos_container().upsert_item({
            "id": doc_id,
            "data": data,
            "computedAt": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:  # noqa: BLE001
        logging.warning("Cosmos cache write failed for %s: %s", doc_id, exc)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """The cleaning steps from Phase 1's data_analysis.py, kept in one place
    so both the blob trigger and the cold-start fallback use identical logic."""
    df[NUMERIC_COLS] = df[NUMERIC_COLS].fillna(df[NUMERIC_COLS].mean())
    df["Diet_type"] = df["Diet_type"].str.strip().str.title()
    return df


def _load_data() -> pd.DataFrame:
    global _cached_df
    if _cached_df is not None:
        return _cached_df

    container = os.environ.get("DIET_DATA_CONTAINER", "diet-data")
    blob_service = _blob_service()

    clean_client = blob_service.get_blob_client(container=container, blob=CLEAN_BLOB_NAME)
    try:
        raw_bytes = clean_client.download_blob().readall()
        _cached_df = pd.read_csv(BytesIO(raw_bytes))
        return _cached_df
    except ResourceNotFoundError:
        logging.warning("%s not found yet - cleaning %s directly as a one-time fallback", CLEAN_BLOB_NAME, RAW_BLOB_NAME)
        raw_client = blob_service.get_blob_client(container=container, blob=RAW_BLOB_NAME)
        raw_bytes = raw_client.download_blob().readall()
        df = _clean(pd.read_csv(BytesIO(raw_bytes)))

        clean_client.upload_blob(df.to_csv(index=False).encode("utf-8"), overwrite=True)
        _cached_df = df
        return df


def _row_records(df: pd.DataFrame) -> list:
    """Shared row shape every endpoint returns - matches api-integration.js exactly."""
    return (
        df[["Diet_type", "Recipe_name", "Cuisine_type", "Protein(g)", "Carbs(g)", "Fat(g)"]]
        .rename(columns={
            "Diet_type": "dietType",
            "Recipe_name": "recipeName",
            "Cuisine_type": "cuisineType",
            "Protein(g)": "protein",
            "Carbs(g)": "carbs",
            "Fat(g)": "fat",
        })
        .to_dict(orient="records")
    )


def _compute_insights(df: pd.DataFrame) -> list:
    return _row_records(df)


def _compute_recipes(df: pd.DataFrame, top_n: int) -> list:
    top_protein = (
        df.sort_values("Protein(g)", ascending=False)
        .groupby("Diet_type")
        .head(top_n)
    )
    return _row_records(top_protein)


def _compute_clusters(df: pd.DataFrame) -> list:
    df = df.copy()
    df["cluster"] = pd.qcut(df["Protein(g)"], q=3, labels=["Low", "Medium", "High"]).astype(str)
    records = _row_records(df)
    for row, cluster in zip(records, df["cluster"]):
        row["cluster"] = cluster
    return records


@app.blob_trigger(
    arg_name="myblob",
    path="diet-data/All_Diets.csv",
    connection="AZURE_STORAGE_CONNECTION_STRING",
    source="EventGrid",  # Flex Consumption only supports Event Grid-based blob
                          # triggers, not the older polling-based one.
)
def clean_diet_data(myblob: func.InputStream):
    """Fires ONLY when All_Diets.csv changes. Cleans the data once, saves it
    as All_Diets_clean.csv, and - new in this version - also precomputes and
    caches the three endpoint results in Cosmos DB right away. This means
    the first HTTP request after a data change is already fast, instead of
    waiting for someone to hit the endpoint before anything gets cached."""
    logging.info("Blob trigger fired: %s changed (%d bytes) - cleaning now", myblob.name, myblob.length)

    raw_bytes = myblob.read()
    df = _clean(pd.read_csv(BytesIO(raw_bytes)))

    container = os.environ.get("DIET_DATA_CONTAINER", "diet-data")
    blob_service = _blob_service()
    clean_client = blob_service.get_blob_client(container=container, blob=CLEAN_BLOB_NAME)
    clean_client.upload_blob(df.to_csv(index=False).encode("utf-8"), overwrite=True)

    global _cached_df
    _cached_df = None

    # Precompute and cache all three results now, while we already have the
    # freshly cleaned DataFrame in memory - this is the "cache result
    # calculations so they aren't recomputed on every request" requirement.
    _cache_put(CACHE_ID_INSIGHTS, _compute_insights(df))
    _cache_put(CACHE_ID_RECIPES_TOP5, _compute_recipes(df, top_n=5))
    _cache_put(CACHE_ID_CLUSTERS, _compute_clusters(df))

    logging.info("Wrote %d cleaned rows to %s and refreshed the Cosmos cache", len(df), CLEAN_BLOB_NAME)


def _json_response(payload_data, start_time: float, status_code: int = 200, cached: bool = False) -> func.HttpResponse:
    body = {
        "data": payload_data,
        "cached": cached,
        "executionTimeMs": round((time.perf_counter() - start_time) * 1000, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return func.HttpResponse(
        json.dumps(body, default=str),
        mimetype="application/json",
        status_code=status_code,
    )


def _error_response(message: str, start_time: float, status_code: int = 500) -> func.HttpResponse:
    body = {
        "error": message,
        "executionTimeMs": round((time.perf_counter() - start_time) * 1000, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return func.HttpResponse(json.dumps(body), mimetype="application/json", status_code=status_code)


@app.route(route="insights", methods=["GET"])
def get_insights(req: func.HttpRequest) -> func.HttpResponse:
    start = time.perf_counter()
    try:
        cached = _cache_get(CACHE_ID_INSIGHTS)
        if cached is not None:
            return _json_response(cached, start, cached=True)

        # Cache miss (e.g. very first run before the trigger has fired even
        # once) - compute it ourselves and populate the cache so the next
        # request is fast.
        df = _load_data()
        data = _compute_insights(df)
        _cache_put(CACHE_ID_INSIGHTS, data)
        return _json_response(data, start, cached=False)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc), start)


@app.route(route="recipes", methods=["GET"])
def get_recipes(req: func.HttpRequest) -> func.HttpResponse:
    start = time.perf_counter()
    try:
        top_n = int(req.params.get("top", 5))

        # Only the default top=5 case is cached - other values are
        # infrequent enough that computing them on demand is simpler than
        # caching every possible "top" value.
        if top_n == 5:
            cached = _cache_get(CACHE_ID_RECIPES_TOP5)
            if cached is not None:
                return _json_response(cached, start, cached=True)

        df = _load_data()
        data = _compute_recipes(df, top_n)
        if top_n == 5:
            _cache_put(CACHE_ID_RECIPES_TOP5, data)
        return _json_response(data, start, cached=False)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc), start)


@app.route(route="clusters", methods=["GET"])
def get_clusters(req: func.HttpRequest) -> func.HttpResponse:
    start = time.perf_counter()
    try:
        cached = _cache_get(CACHE_ID_CLUSTERS)
        if cached is not None:
            return _json_response(cached, start, cached=True)

        df = _load_data()
        data = _compute_clusters(df)
        _cache_put(CACHE_ID_CLUSTERS, data)
        return _json_response(data, start, cached=False)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc), start)
    
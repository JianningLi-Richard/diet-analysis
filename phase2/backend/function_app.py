
import json
import os
import time
from datetime import datetime, timezone
from io import BytesIO

import azure.functions as func
import pandas as pd
from azure.storage.blob import BlobServiceClient

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

NUMERIC_COLS = ["Protein(g)", "Carbs(g)", "Fat(g)"]

# Cached in memory for the lifetime of the function instance so we don't
# re-download and re-clean the CSV from Blob Storage on every request. This
# is also why the metadata bar's execution time drops sharply after the
# first call (cold start) - later calls skip the blob download entirely.
_cached_df = None


def _load_data() -> pd.DataFrame:
    global _cached_df
    if _cached_df is not None:
        return _cached_df

    conn_str = os.environ["AZURE_STORAGE_CONNECTION_STRING"]
    container = os.environ.get("DIET_DATA_CONTAINER", "diet-data")
    blob_name = os.environ.get("DIET_DATA_BLOB", "All_Diets.csv")

    blob_service = BlobServiceClient.from_connection_string(conn_str)
    blob_client = blob_service.get_blob_client(container=container, blob=blob_name)
    raw_bytes = blob_client.download_blob().readall()

    df = pd.read_csv(BytesIO(raw_bytes))

    # Same cleaning steps as Phase 1's data_analysis.py.
    df[NUMERIC_COLS] = df[NUMERIC_COLS].fillna(df[NUMERIC_COLS].mean())
    df["Diet_type"] = df["Diet_type"].str.strip().str.title()

    _cached_df = df
    return df


def _json_response(payload_data, start_time: float, status_code: int = 200) -> func.HttpResponse:
    body = {
        "data": payload_data,
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


@app.route(route="insights", methods=["GET"])
def get_insights(req: func.HttpRequest) -> func.HttpResponse:
    start = time.perf_counter()
    try:
        df = _load_data()
        # Full cleaned dataset. The integration layer computes its own
        # scatter/heatmap from these raw rows; the frontend groups by
        # dietType client-side for the bar/pie aggregates.
        return _json_response(_row_records(df), start)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc), start)


@app.route(route="recipes", methods=["GET"])
def get_recipes(req: func.HttpRequest) -> func.HttpResponse:
    start = time.perf_counter()
    try:
        df = _load_data()
        top_n = int(req.params.get("top", 5))

        top_protein = (
            df.sort_values("Protein(g)", ascending=False)
            .groupby("Diet_type")
            .head(top_n)
        )

        return _json_response(_row_records(top_protein), start)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc), start)


@app.route(route="clusters", methods=["GET"])
def get_clusters(req: func.HttpRequest) -> func.HttpResponse:
    start = time.perf_counter()
    try:
        df = _load_data().copy()

        # Lightweight clustering: split recipes into three protein tiers by
        # quantile, rather than pulling in scikit-learn for a full k-means
        # (keeps the deployment package small and cold starts fast).
        df["cluster"] = pd.qcut(df["Protein(g)"], q=3, labels=["Low", "Medium", "High"]).astype(str)

        records = _row_records(df)
        for row, cluster in zip(records, df["cluster"]):
            row["cluster"] = cluster

        return _json_response(records, start)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc), start)
    
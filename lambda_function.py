import os
import io
import json
from azure.storage.blob import BlobServiceClient
import pandas as pd

AZURITE_CONN_STR = "UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://127.0.0.1"

CONTAINER_NAME = os.environ.get("BLOB_CONTAINER", "datasets")
BLOB_NAME      = os.environ.get("BLOB_FILE", "All_Diets.csv")
OUTPUT_DIR     = os.environ.get("OUTPUT_DIR", "simulated_nosql")

# Pre-define dtypes to skip pandas type-inference on CSV load (cold-start improvement)
DTYPE_MAP = {
    "Diet_type": "category",
    "Recipe_name": "string",
    "Cuisine_type": "string",
}

# Cache blob client at module level, avoids reconnecting on every cold start
_blob_service_client = None

def get_blob_client():
    global _blob_service_client
    if _blob_service_client is None:
        _blob_service_client = BlobServiceClient.from_connection_string(AZURITE_CONN_STR)
    return _blob_service_client


def process_nutritional_data():
    """Simulated Azure Function: อ่าน CSV จาก Blob Storage, คำนวณ, บันทึก JSON"""

    # Use cached client instead of creating new connection every invocation
    blob_service = get_blob_client()
    blob_client  = blob_service.get_blob_client(container=CONTAINER_NAME, blob=BLOB_NAME)

    stream = blob_client.download_blob().readall()

    # dtype_map skips pandas type-inference pass — faster load on large CSVs
    df     = pd.read_csv(io.BytesIO(stream), dtype=DTYPE_MAP)
    print(f"[INFO] Loaded {len(df)} rows from Blob Storage")

    numeric_cols = ["Protein(g)", "Carbs(g)", "Fat(g)"]
    df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].mean())
    df["Diet_type"]  = df["Diet_type"].astype(str).str.strip().str.title()

    avg_macros = (
        df.groupby("Diet_type")[numeric_cols]
          .mean()
          .round(2)
          .reset_index()
          .to_dict(orient="records")
    )

    top_protein = (
        df.sort_values("Protein(g)", ascending=False)
          .groupby("Diet_type")
          .head(5)[["Diet_type", "Recipe_name", "Cuisine_type", "Protein(g)"]]
          .to_dict(orient="records")
    )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(os.path.join(OUTPUT_DIR, "avg_macros.json"), "w") as f:
        json.dump(avg_macros, f, indent=2)

    with open(os.path.join(OUTPUT_DIR, "top_protein.json"), "w") as f:
        json.dump(top_protein, f, indent=2)

    print(f"[INFO] Results saved to {OUTPUT_DIR}/")
    print(f"[INFO] Diet types processed: {[r['Diet_type'] for r in avg_macros]}")


if __name__ == "__main__":
    process_nutritional_data()
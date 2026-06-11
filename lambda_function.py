import os
import io
import json
from azure.storage.blob import BlobServiceClient
import pandas as pd

AZURITE_CONN_STR = "UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://127.0.0.1"

CONTAINER_NAME = os.environ.get("BLOB_CONTAINER", "datasets")
BLOB_NAME      = os.environ.get("BLOB_FILE", "All_Diets.csv")
OUTPUT_DIR     = os.environ.get("OUTPUT_DIR", "simulated_nosql")


def process_nutritional_data():
    """Simulated Azure Function: อ่าน CSV จาก Blob Storage, คำนวณ, บันทึก JSON"""

    
    blob_service = BlobServiceClient.from_connection_string(AZURITE_CONN_STR)
    blob_client  = blob_service.get_blob_client(container=CONTAINER_NAME, blob=BLOB_NAME)

    
    stream = blob_client.download_blob().readall()
    df     = pd.read_csv(io.BytesIO(stream))
    print(f"[INFO] Loaded {len(df)} rows from Blob Storage")

    
    numeric_cols = ["Protein(g)", "Carbs(g)", "Fat(g)"]
    df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].mean())
    df["Diet_type"]  = df["Diet_type"].str.strip().str.title()

    
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
from azure.storage.blob import BlobServiceClient

# Azurite default connection string 
conn_str = "UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://127.0.0.1"

client = BlobServiceClient.from_connection_string(conn_str)

container = client.get_container_client("datasets")
if not container.exists():
    container.create_container()
    print("Container 'datasets' created")
else:
    print("Container 'datasets' already exists")

with open("All_Diets.csv", "rb") as f:
    container.upload_blob(name="All_Diets.csv", data=f, overwrite=True)

print("All_Diets.csv uploaded successfully!")
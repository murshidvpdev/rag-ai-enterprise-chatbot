from sentence_transformers import SentenceTransformer

model = SentenceTransformer("BAAI/bge-base-en-v1.5")

texts = [
    "What is enterprise resource planning?",
    "ERP helps businesses manage operations."
]

vectors = model.encode(texts, normalize_embeddings=True)

print("Number of vectors:", len(vectors))
print("Embedding dimension:", len(vectors[0]))
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
from sentence_transformers import SentenceTransformer, util

app = FastAPI()

# Load the pre-trained TechWolf/JobBERT-v2 model
model = SentenceTransformer("TechWolf/JobBERT-v2")


class EmbeddingPair(BaseModel):
    embedding1: list[float]
    embedding2: list[float]


class TextEmbedding(BaseModel):
    text: str


@app.post("/cosine_similarity")
async def compute_cosine_similarity(embeddings: EmbeddingPair):
    if not embeddings.embedding1 or not embeddings.embedding2:
        raise HTTPException(
            status_code=400, detail="Both embedding1 and embedding2 must be provided."
        )

    # Convert the input lists into torch tensors
    emb1_tensor = torch.tensor(embeddings.embedding1)
    emb2_tensor = torch.tensor(embeddings.embedding2)

    # Directly compute cosine similarity using the sentence-transformers utility
    cosine_sim = util.cos_sim(emb1_tensor, emb2_tensor)

    return {"cosine_similarity": cosine_sim.item()}


@app.post("/get_embedding")
async def get_embedding(text_embedding: TextEmbedding):
    if not text_embedding.text:
        raise HTTPException(status_code=400, detail="Text must be provided.")

    # Compute the embedding for the provided text
    embedding = model.encode(text_embedding.text, convert_to_tensor=False)

    # Convert the embedding to a list for JSON serialization
    embedding_list = embedding.tolist()

    return {"embedding": embedding_list}
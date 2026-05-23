# services/ai/ — AI feature foundation

Generic infrastruktur untuk semua fitur AI selain OCR (kategori suggest,
generator, justifier, dll). OCR existing tetap di `services/ocr/`.

## Modul

| File | Tujuan |
|---|---|
| `llm.py` | Generic chat client (Claude + Mistral). Auto cache + rate-limit + audit. |
| `cache.py` | Namespace-based response cache (table `ai_cache`). |
| `rate_limit.py` | Factory per-feature limiter (in-memory sliding window). |
| `audit.py` | Log setiap call ke `ai_call_logs` (cost, tokens, latency). |
| `pricing.py` | Price per 1M token per model -> estimate cost. |

## Cara tambah fitur AI baru

1. **Bikin module di `services/ai/features/<name>.py`** (atau langsung di endpoint kalau simple).

   ```python
   # services/ai/features/category.py
   from app.services.ai import chat

   SYSTEM_PROMPT = """Kamu bantu pilih kategori transaksi dari list..."""

   async def suggest_category(
       db, *, user_id, description, available_categories
   ):
       cats_str = "\n".join(f"- {c.id}: {c.name}" for c in available_categories)
       resp = await chat(
           db=db, user_id=user_id, feature="chat:category",
           system=SYSTEM_PROMPT,
           prompt=f"Kategori untuk: {description}\n\nPilihan:\n{cats_str}",
           json_schema={
               "type": "object",
               "properties": {
                   "category_id": {"type": "integer"},
                   "reason": {"type": "string"},
               },
               "required": ["category_id"],
           },
           model_hint="fast",
           cache_ttl_days=7,
       )
       return resp.structured
   ```

2. **Endpoint di `api/v1/ai/category.py`** (atau extend route existing):

   ```python
   @router.post("/ai/suggest-category")
   async def suggest_category_endpoint(
       payload: SuggestIn, db, user=Depends(get_current_user)
   ):
       cats = await load_categories(db)
       result = await suggest_category(
           db, user_id=user.id,
           description=payload.description, available_categories=cats,
       )
       await db.commit()
       return result
   ```

3. **Done.** Rate-limit + cache + audit otomatis (per `feature` ID).

## Tuning rate-limit

Default: 30 calls/menit per user per feature. Override:

```python
resp = await chat(..., rate_limit_max=10, rate_limit_period=60.0)
```

## Tuning cache

Default 7 hari. Untuk feature dgn output deterministik (mis. kategori
saran), TTL panjang OK. Untuk output kreatif (mis. generator email),
set lebih pendek atau 0 (disable).

## Cost tracking

`ai_call_logs` punya `cost_usd` per call. Query untuk dashboard:

```sql
SELECT feature, model,
       COUNT(*) AS calls,
       SUM(CAST(cost_usd AS NUMERIC)) AS total_usd,
       AVG(latency_ms) AS avg_latency
FROM ai_call_logs
WHERE created_at >= now() - INTERVAL '30 days'
GROUP BY feature, model
ORDER BY total_usd DESC;
```

## Migrasi OCR ke services/ai/

OCR existing pakai infra sendiri (`services/ocr/`). Migrasi ke services/ai/
ditunda — high risk, no functional benefit. Kalau OCR perlu di-extend dgn
chat (mis. "explain this receipt"), pakai services/ai/chat() langsung.

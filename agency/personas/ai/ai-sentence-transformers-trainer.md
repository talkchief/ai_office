---
name: Sentence Transformers Trainer
description: Trains and fine-tunes SentenceTransformer, CrossEncoder and SparseEncoder models for retrieval, similarity, clustering, classification and reranking.
role: ML engineer · sentence-transformers, rerankers, sparse encoders
tags: engineer, embeddings, sentence-transformers, retrieval, fine-tuning, rag
color: slate
emoji: 🧠
vibe: Applies the Train Sentence Transformers skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · train-sentence-transformers
---

# Sentence Transformers Trainer

You are **Sentence Transformers Trainer**: you carry one skill, "Train Sentence Transformers", and apply it exactly as written. You do the work it describes, in its order, and hand the result to your lead in the format it prescribes.

## 🧠 Your Identity & Memory
- **Role**: ML engineer · sentence-transformers, rerankers, sparse encoders
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Train Sentence Transformers skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Identify the model type first: bi-encoder for retrieval, cross-encoder for reranking, sparse encoder for inverted indexes
- Start from the production template script for that type instead of synthesising a training script
- Pick the loss and evaluator that match the data shape: pairs, triplets, scores or in-batch negatives
- Keep the template's scaffolding — autocast helper, seed, precision settings, model card and evaluator metric handling
- Hand over the trained model with its evaluation numbers and a model card describing the training data
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
## When to Use

Use this skill when you need train or fine-tune sentence-transformers models across `SentenceTransformer` (bi-encoder; dense or static embedding model; for retrieval, similarity, clustering, classification, paraphrase mining, dedup, multimodal), `CrossEncoder` (reranker; pair scoring for two-stage retrieval / pair...

**This SKILL.md is a router, not a manual.** It tells you which references and example scripts to load for your task. The actual content — recommended losses, evaluators, training-script structure, model selection, training-arg knobs, troubleshooting — lives in `references/` and `scripts/`.

**Do not synthesize a training script from this file alone.** Open the per-type production template (`scripts/train_<type>_example.py`) and copy it as your starting point. The templates contain load-bearing scaffolding (autocast helper, model-card class, logger silencing list, `force=True`, `seed`, TF32, version-compatible imports, named-evaluator metric handling) that prior agent runs have repeatedly missed when rolling their own from a synthesized snippet.

## 1. Identify the model type

| Tag | Class | What it does | When to pick |
|---|---|---|---|
| **[SentenceTransformer]** | `SentenceTransformer` (bi-encoder) | Maps each input to a fixed-dim dense vector | Retrieval, similarity, clustering, classification, paraphrase mining, dedup |
| **[CrossEncoder]** | `CrossEncoder` (reranker) | Scores `(query, passage)` pairs jointly | Two-stage retrieval (rerank top-100 from bi-encoder), pair classification |
| **[SparseEncoder]** | `SparseEncoder` (SPLADE) | Sparse vectors over the vocabulary | Learned-sparse retrieval, inverted-index backends (Elasticsearch / OpenSearch / Lucene) |

Tiebreakers when the request is ambiguous: "embedding model" / "vector search" / "similarity" → **[SentenceTransformer]**. "rerank" / "ranker" / "two-stage" → **[CrossEncoder]**. "SPLADE" / "sparse" / "inverted index" → **[SparseEncoder]**. If still unclear, ask.

## 2. Required reading

**Read these in full before writing any code. Do not triage by perceived relevance.**

### Per-type — always required

**[SentenceTransformer]**
- “Reference: Losses Sentence Transformer” below — loss-to-data-shape mapping; `BatchSamplers.NO_DUPLICATES` requirement for MNRL-family; `Cached*` ↔ `gradient_checkpointing` incompatibility.
- “Reference: Evaluators Sentence Transformer” below — evaluator-to-task mapping; `metric_for_best_model` key construction (named vs unnamed); per-evaluator `primary_metric` values.
- “Reference: Model Architectures” below — encoder vs decoder vs static vs Router pipelines; pooling rules (mean / cls / lasttoken); auto-mean-pooling behavior for fresh-start MLM bases.
- `scripts/train_sentence_transformer_example.py` — production template; copy this as your starting point.

**[CrossEncoder]**
- “Reference: Losses Cross Encoder” below — pointwise / pairwise / listwise / distillation; `pos_weight` derivation; `activation_fn=Identity()` mandatory for non-BCE losses (silent eval-rank collapse otherwise).
- “Reference: Evaluators Cross Encoder” below — `CrossEncoderRerankingEvaluator` recipe; named-evaluator key format `eval_{name}_{primary_metric}`.
- `scripts/train_cross_encoder_example.py` — production template; copy this as your starting point.

**[SparseEncoder]**
- “Reference: Losses Sparse Encoder” below — `SpladeLoss` wrapper requirement; FLOPS regularizer weights; smoke-test active-dim ramp behavior.
- “Reference: Evaluators Sparse Encoder” below — `SparseNanoBEIREvaluator` (English-only) and the in-domain alternative; `eval_{name}_{primary_metric}` key format.
- `scripts/train_sparse_encoder_example.py` — production template; copy this as your starting point.

### Cross-cutting — always required (regardless of task)

- “Reference: Training Args” below — `TrainingArguments` knobs, precision rules (load fp32 + autocast bf16/fp16; never `torch_dtype=bfloat16`), `warmup_steps` (float) vs deprecated `warmup_ratio`, `save_steps` must be a multiple of `eval_steps` for `load_best_model_at_end`, schedulers, HPO, tracker, resume, hub-push variants.
- “Reference: Dataset Formats” below — column-matching rules (label name auto-detection; column-order-not-name); reshaping recipes; hard-negative mining options.
- “Reference: Base Model Selection” below — discovery commands; per-type model namespaces; ModernBERT-family `max_seq_length=8192` trap; `datasets >= 4` script-loader rejection; non-English starting-point shortcuts.
- “Reference: Troubleshooting” below — symptom-indexed failure recipes. Skim the section headings on every run, even a healthy one; the "Metrics don't improve" and "Hub push fails" entries cover bugs that bite frequently and are cheaper to recognize before they fire than to debug after.

### Cross-cutting — load when applicable

- “Reference: Hardware Guide” below — VRAM sizing, multi-GPU, FSDP / DeepSpeed, HF Jobs flavors. Required for >24GB models, multi-GPU, or HF Jobs runs.
- “Reference: Hf Jobs Execution” below — required when running on HF Jobs.
- “Reference: Prompts And Instructions” below — required when using prompt-tuned bases (E5, BGE, GTE, Qwen3-Embedding, Instructor, Nomic, etc.) or adding `query: ` / `passage: ` style prefixes.

### Variant scripts (open when the task matches)
- **[SentenceTransformer]** `scripts/train_sentence_transformer_<matryoshka|multi_dataset|with_lora|distillation|make_multilingual|static_embedding>_example.py`.
- **[CrossEncoder]** `scripts/train_cross_encoder_<distillation|listwise>_example.py`.
- **[SparseEncoder]** `scripts/train_sparse_encoder_distillation_example.py`.
- Hard-negative mining CLI — `scripts/mine_hard_negatives.py`.

## 3. Defaults

Override only if the user specifies otherwise:
- **Local execution.** Pitch HF Jobs only if local hardware can't fit the job.
- **Single run.** After it completes, propose experimentation if the user would benefit (weak/marginal verdict, "see how high you can push it" framing, etc.). Iteration rules in “Reference: Training Args” below (Experimentation section).
- **Public Hub push at end-of-run, wrapped in try-except.** On HF Jobs (ephemeral env) ALSO enable in-trainer push (`push_to_hub=True` + `hub_strategy="every_save"`); details in “Reference: Hf Jobs Execution” below.

## 4. Constraints the produced script must satisfy

These are non-negotiable contracts. Implementation lives in the production templates and references — do not reinvent.

- Capture the pre-training evaluator score as `baseline_eval` **before** `trainer.train()`.
- Emit a single end-of-run line: `VERDICT: WIN|MARGINAL|REGRESSION | score=... | baseline=... | delta=...`. A monitor scrapes for this.
- Silence `httpx`, `httpcore`, `huggingface_hub`, `urllib3`, `filelock`, `fsspec` to WARNING (otherwise HF download URLs flood the agent's context).
- Tee logs to `logs/{RUN_NAME}.log`.
- End with `model.push_to_hub(...)` wrapped in `try/except`.
- Smoke-test before any long run (`max_steps=1` + tiny dataset slice). The production templates show one common pattern (`SMOKE_TEST` env var).
- **[CrossEncoder]** Include `EarlyStoppingCallback(patience>=3)` — CE rerankers often peak mid-training and regress.
- **[SparseEncoder]** Log `query_active_dims` / `corpus_active_dims` on the verdict line; high nDCG with collapsed sparsity is not a win. The keys come back name-prefixed (e.g. `..._query_active_dims`); use suffix matching to pluck them — see the SPARSE production template for the exact pattern.

## 5. Workflow

1. Identify the model type (§1). Ask if ambiguous.
2. Load the §2 required-reading files for that type.
3. Open `scripts/train_<type>_example.py` and copy it as your starting point.
4. Replace `MODEL_NAME`, `DATASET_NAME`, `RUN_NAME`, the loss, and the evaluator with the user's task. Cross-check loss/data-shape match against `references/losses_<type>.md`; cross-check the `metric_for_best_model` key against `references/evaluators_<type>.md` (named evaluators format the key as `eval_{name}_{primary_metric}`).
5. Smoke-test (`max_steps=1`).
6. Run.
7. After the run, append to `logs/experiments.md` and propose iteration if the verdict is weak/marginal.

## Prerequisites

```bash
pip install "sentence-transformers[train]>=5.0"        # add [train,image] / [audio] / [video] for [SentenceTransformer] multimodal
pip install trackio                                    # optional tracker; or wandb / tensorboard / mlflow
hf auth login                                          # or set HF_TOKEN with write scope (for Hub push)
```

GPU strongly recommended. CPU works only for demos and `[SentenceTransformer]` `StaticEmbedding`.

## Limitations

- Verify commands, API behavior, pricing, quotas, credentials, and deployment effects against current official documentation before making changes.
- Do not treat generated examples as a substitute for environment-specific tests, security review, or user approval for destructive or costly actions.

## Reference: Losses Sentence Transformer

All losses live in `sentence_transformers.sentence_transformer.losses`.

Losses are grouped by data shape. The #1 rule: **pick a loss that matches your data**, not the other way around.

## Top-line decision table

| You have | Use |
|---|---|
| `(anchor, positive)` pairs | `MultipleNegativesRankingLoss` (or Cached variant for large batches) |
| `(anchor, positive, negative)` triplets | `MultipleNegativesRankingLoss` — it handles triplets natively |
| `(text1, text2, score)` with `score ∈ [-1, 1]` or `[0, 1]` | `CoSENTLoss` (strongly recommended) |
| `(text1, text2, label)` with `label ∈ {0, 1}` | `OnlineContrastiveLoss` |
| `(text, class_id)` single-column with integer class | `BatchAllTripletLoss` |
| `(query, positive, negative, score_diff)` | `MarginMSELoss` (distillation) |
| `(text, teacher_embedding)` | `MSELoss` (embedding distillation) |
| Want multiple output dims from one training | Wrap any of the above in `MatryoshkaLoss` |
| No labels at all, just sentences | `DenoisingAutoEncoderLoss` or `ContrastiveTensionLossInBatchNegatives` |

## Contrastive losses (pairs + triplets, no labels)

### `MultipleNegativesRankingLoss` (MNRL)

The default bi-encoder loss. Uses **in-batch negatives**: every other `positive` in the batch acts as a negative for the current `anchor`.

```python
loss = MultipleNegativesRankingLoss(model, scale=20.0)  # similarity_fct defaults to cos_sim
```

- **Data**: `(anchor, positive)` or `(anchor, positive, negative)`. More columns = more explicit hard negatives per row.
- **Scale**: temperature. Default `scale=20.0` multiplies similarities by 20 (equivalent to softmax temperature 0.05). Tune only if cosine similarities end up saturated.
- **Critical**: set `batch_sampler=BatchSamplers.NO_DUPLICATES` on training args. Otherwise duplicate anchors create false negatives.
- **Tip**: batch size matters a lot — more in-batch negatives = better gradients.

### `CachedMultipleNegativesRankingLoss`

Same loss, but with gradient caching (GradCache): forwards in mini-batches but computes the contrastive loss over the full batch. Use this when you want effective batch size of 256+ but your GPU can only fit 32 forwards.

```python
loss = CachedMultipleNegativesRankingLoss(model, mini_batch_size=32)
```

- **Incompatible with `gradient_checkpointing=True`**.
- Set `mini_batch_size` to whatever `per_device_train_batch_size` would be if you couldn't use this. Then crank the actual `per_device_train_batch_size` to what you want the effective batch to be (256+, 1024+).

### `MultipleNegativesSymmetricRankingLoss`

MNRL computed bidirectionally — scores positives from both (anchor -> positive) and (positive -> anchor) directions. Slightly better on retrieval tasks where the "anchor" and "positive" distinctions are soft (paraphrase, deduplication).

### `CachedMultipleNegativesSymmetricRankingLoss`

Cached variant of the above.

### `GISTEmbedLoss`

Like MNRL, but uses a **guide model** (a separate pretrained Sentence Transformer) to **filter out false negatives** before computing the contrastive loss. The guide model scores each potential negative; if it looks too similar to the positive, it's excluded.

```python
guide = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
loss = GISTEmbedLoss(model, guide=guide)
```

- Expensive: guide model does a forward pass per batch.
- Strong when your in-batch negatives are noisy (e.g. small corpus with many near-duplicates).

### `CachedGISTEmbedLoss`

Cached + GIST.

### `MegaBatchMarginLoss`

In-batch margin-based triplet: for each anchor, find the hardest negative in the batch and apply a margin loss. Older pattern, usually outperformed by MNRL.

### `TripletLoss`

Classic triplet margin loss on explicit `(anchor, positive, negative)`. Uses a fixed margin and the hardest in-batch is not considered — only the provided triplet.

```python
loss = TripletLoss(model, distance_metric=TripletDistanceMetric.EUCLIDEAN, triplet_margin=5)
```

- Simpler than MNRL; less powerful when the batch has useful negatives.
- Good for cases where you have *trusted* pre-mined triplets and want to avoid in-batch noise.

## Batch-triplet losses (single column + integer label)

These mine triplets *within* the batch from samples sharing a label.

### `BatchAllTripletLoss`

For each anchor, form triplets with all positive/negative combinations in the batch. Max signal per batch.

```python
loss = BatchAllTripletLoss(model, margin=5)
```

- **Data**: single text column + integer `label`. Needs multiple samples per label in each batch (set `batch_sampler=BatchSamplers.GROUP_BY_LABEL`).

### `BatchHardTripletLoss`

Same, but only the single hardest positive + hardest negative per anchor.

### `BatchSemiHardTripletLoss`

Semi-hard mining: negatives harder than the positive but easier than the margin. Often more stable than fully-hard.

### `BatchHardSoftMarginTripletLoss`

Variant with a soft margin (log-sum-exp) instead of a fixed margin hinge.

**When to use batch-triplet losses**: classification-style datasets (labels are class IDs, not pair annotations). E.g. "train an embedder where samples from the same class are close."

## Scored regression losses (labeled pairs, float score)

### `CoSENTLoss`

**The recommended regression loss** for `(text1, text2, score)`. Trains on pairwise ranking: for any two pairs `(a, b)` and `(c, d)` with `score(a,b) > score(c,d)`, the model should score `(a, b)` higher. Much better than squared error.

```python
loss = CoSENTLoss(model, scale=20.0)
```

- **Data**: `(text1, text2, float_score)`. Labels can be `[0, 1]` or `[-1, 1]`.
- Works well with small datasets (STS-B, 5k pairs).

### `AnglELoss`

Similar to CoSENT but uses angle-based optimization in complex space. Sometimes outperforms CoSENT on tasks with fine-grained similarity gradations. Strong alternative.

### `CosineSimilarityLoss`

Squared-error loss on cosine similarity: `mse(cos(text1, text2), label)`. Simpler than CoSENT, usually worse. Keep for legacy / reproducibility.

## Contrastive labeled losses (labeled pairs, binary label)

### `ContrastiveLoss`

For `(text1, text2, label)` where `label ∈ {0, 1}`. Minimizes distance for positives; pushes negatives past a margin.

```python
loss = ContrastiveLoss(model, margin=0.5, distance_metric=SiameseDistanceMetric.COSINE_DISTANCE)
```

### `OnlineContrastiveLoss`

Same setup but **ignores "easy" pairs** (positives already close, negatives already far) and only optimizes hard ones. Much more robust to label noise.

```python
loss = OnlineContrastiveLoss(model, margin=0.5)
```

**Preferred over `ContrastiveLoss`** for most practical labeled pair datasets.

### `SoftmaxLoss`

A classifier head on concatenated `(u, v, |u-v|)` embeddings, trained with cross-entropy. Useful when you have NLI-style multi-class labels (entailment / neutral / contradiction) and want a categorical loss. Historically important (it trained the first popular sentence embedding models) but **generally outperformed by MNRL**.

## Distillation losses

### `MSELoss`

Regress the student's embedding to match a teacher's embedding.

- **Data**: `(text, teacher_embedding)`. The teacher embedding is a fixed vector per row.
- Use when distilling a smaller bi-encoder from a larger one.

### `MarginMSELoss`

For `(query, positive, negative, score_diff)`: minimize `mse(student_score_diff, teacher_score_diff)`. The teacher is typically a cross-encoder that produced the score differences.

- **Data**: 3 text columns + 1 float column.
- Workhorse of dense retriever training from cross-encoder teachers (ms-marco distillation).

### `DistillKLDivLoss`

KL-divergence distillation: student's softmax distribution over candidates should match teacher's.

- **Data**: `(query, passages[], teacher_scores[])`.
- Good for list-wise distillation when you have multiple candidates per query.

See `../scripts/train_sentence_transformer_distillation_example.py` for the end-to-end pattern (its docstring covers Embedding MSE / Margin MSE / Listwise KL with full recipes).

## Regularizer / wrapper losses

These don't have their own data shape — they wrap another loss and add a regularization objective.

### `MatryoshkaLoss`

Train **once**, deploy at any of several dimensions. Wraps any loss and computes it at multiple truncated dimensions, adding them weighted.

```python
base_loss = MultipleNegativesRankingLoss(model)
loss = MatryoshkaLoss(
    model,
    base_loss,
    matryoshka_dims=[768, 512, 256, 128, 64],
    matryoshka_weights=[1, 1, 1, 1, 1],   # relative weighting per dim
)
```

- At inference, `SentenceTransformer(..., truncate_dim=128)` gives 128-dim output with ~95% of full quality.
- Default matryoshka_dims: pick the dims you want to deploy at. Smaller dims improve compression at the cost of slight quality drop.

### `Matryoshka2dLoss`

2D-Matryoshka: reduce dimension **and** number of transformer layers in a single wrapper. Internally composes `MatryoshkaLoss` + `AdaptiveLayerLoss`, so you only need this one (don't wrap it in AdaptiveLayerLoss yourself). Deploy at any (dim, layer) pair at inference.

### `AdaptiveLayerLoss`

Wrap any loss; adds a term that trains each of the transformer's layers to be a valid exit point. Deploy with fewer layers at inference for faster encoding.

```python
loss = AdaptiveLayerLoss(
    model,
    base_loss,
    n_layers_per_step=1,
    last_layer_weight=1.0,
    prior_layers_weight=1.0,
)
```

### `GlobalOrthogonalRegularizationLoss` (GOR)

Stand-alone regularizer (not a wrapper, despite living in this section). Penalizes embedding pairs whose dot product deviates from orthogonality, encouraging the model to spread embeddings across the full vector space. Use it alongside a primary contrastive loss by summing the two outputs in your own training step; can help with downstream retrieval diversity.

## Unsupervised losses

### `DenoisingAutoEncoderLoss` (TSDAE)

Sentence-level denoising autoencoder: corrupt a sentence (drop tokens), force the model to reconstruct it. Pretraining-style — useful for domain adaptation when you have unlabeled in-domain sentences.

### `ContrastiveTensionLoss`

Unsupervised contrastive: two copies of the model encode the same sentence; they should agree. Pure self-supervised.

### `ContrastiveTensionLossInBatchNegatives`

CT with in-batch negatives. Stronger than vanilla CT.

## Gotchas

- **`MultipleNegativesRankingLoss` without `BatchSamplers.NO_DUPLICATES`** will include duplicate anchors in the same batch, destroying training signal. Always set the sampler.
- **Any `Cached*` loss + `gradient_checkpointing=True` = crash.** Pick one.
- **`TripletLoss` with bad negatives** (too easy) = loss hits zero fast and model stops learning. Mine hard negatives first.
- **Matryoshka wrapping `CachedMultipleNegativesRankingLoss`**: supported, but the cached-loss's mini-batch semantics apply to the base loss only. Think twice before combining.

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never write a training script from memory when a per-type template exists; copy it and adapt it
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result

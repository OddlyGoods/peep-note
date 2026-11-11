# Local knowledge map embeddings

The knowledge map connects note nodes using content similarity. Groups and tags
do not create edges or influence the layout.

- Model: [`Xenova/multilingual-e5-small`](https://huggingface.co/Xenova/multilingual-e5-small), revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`.
- Inference: Transformers.js 3.8.1, quantized CPU model, 384 dimensions, two CPU threads, isolated Electron utility process.
- The note map is disabled by default. Enabling its header switch downloads approximately 130 MiB of public model assets. The cache lives in `<Electron userData>/models/embeddings`; the installed application directory is never used as a writable cache.
- Later model loads use local files only. No account, API key, Python, GPU, or separate server is required.
- Network access in the worker is restricted to model downloads over HTTPS. Note text is passed to local inference and never sent in an HTTP request.

## Indexing

Title, body and already-extracted OCR text are normalized. Markdown destinations,
HTML tags, scripts and styles are excluded. Image files are not opened and OCR is
not automatically run. Long notes use overlapping token chunks with room for the
model prefix. The normalized mean of their vectors represents the note.

The local database stores vectors with a model/preprocessing version and content
hash. Only changed notes are embedded again. Editing content invalidates its old
vector immediately. Trash, secret and deleted notes cannot appear in results;
their vectors are removed by database triggers. Results finishing after an edit,
deletion, privacy change or data-folder switch are discarded.

The enabled state is saved in the local database. While enabled, indexing follows
note changes in the background and resumes after an app restart. Disabling stops
the worker, downloads and pending indexing; downloaded assets and valid cached
vectors are kept for later reuse. The map polls progress while indexing is active. Failures show a retry
action; retrying keeps valid cached vectors. The inference worker releases the
model after 30 seconds without work. Each restart uses a fresh process: reloading
ONNX's native binding in a new worker thread in the same Electron process can
fail with `Module did not self-register`. Idle shutdown, disabling and retrying
therefore terminate the utility process instead. Errors expose only a bounded
diagnostic code, never note text or local paths.

Connections use mutual top-three neighbours, cosine similarity of at least 0.82,
and a local similarity margin when enough candidates exist. These are heuristic
relationships, not factual links or a universal similarity percentage. Isolated
notes remain visible. Vectors and note bodies are not returned in map responses.

## Meaning search

The map search embeds the query locally using the same model and searches all
current eligible note vectors in the selected workspace, including notes outside
the normal 400-note display limit. It does not use substring matching. Clearing
the query restores the normal map. Other screens keep their existing text search.

Results use cosine similarity, a 0.75 minimum and a margin of 0.08 from the best
match, displaying up to 50 relevant notes and the connections between them. These
thresholds are heuristics; results depend on the model and the content. Notes still
being indexed join results on the next progress refresh. Missing or failed local
inference never falls back to cloud APIs or literal search.

Query and note inference share a serial worker queue. Up to eight query vectors
are cached in memory for repeated searches and progress polling, cleared when the
map is disabled. Query text/vectors are not saved to the database. Privacy, content
hash and data-folder checks are repeated after inference before returning results.

## Related notes in detail views

When the map is enabled, note detail views show up to three connected notes,
ordered by descending cosine similarity, below the grouped notes and above tags.
The endpoint checks the same mutual top-three edge rule over current eligible
vectors across workspaces. It reuses stored embeddings without inference. Secret,
trashed, stale and other-profile notes are excluded, including the source note.
No section is rendered for an unindexed note or one with no connections. The
list refreshes during indexing and when the view resumes or notes change.

## Image thumbnails

Map labels and inspector rows show a single small thumbnail from the first image
in the capture/file list. An image-only note remains visible without an embedding;
only its title, body and manually extracted OCR participate in connections.

The API returns an opaque image version rather than file paths. A note-ID endpoint
checks map permission, ownership, secret/trash state and the current source before
and after reading media. Electron resizes supported local images to at most 192×128
pixels for a sharp 96×64 inspector preview, with the title above. Clicking a
thumbnail opens the original in the image viewer; the main process rechecks the
note permission and resolves its source by note ID. Output is kept in a bounded in-memory cache and served with `no-store`;
original files are not modified. Missing or unsupported files leave a normal label.
The canvas fetches thumbnails for up to 60 visible image notes, four at a time.

## Development and verification

Use `npm ci --onnxruntime-node-install-cuda=skip` for a CPU-only development install.
Release CI sets `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`. Model weights are downloaded
at runtime and are not committed or included in the installer.

- `npm run test:local`: indexing, invalidation, privacy and graph regression tests with isolated databases and fake inference.
- `npm run test:map-native`: isolated Electron UI regression, using a synthetic map.
- `npm run test:embeddings-native`: real model, multilingual similarity, unrelated notes, long-note chunks, renderer responsiveness, repeated explicit/idle process restarts, offline cache and an ASAR using the production unpack pattern. The first run may download the model to a temporary test cache. Set `PEEPNOTE_EMBEDDING_TEST_CACHE` to reuse another test cache.

Native inference and ASAR loading are verified on Linux. Release packaging also
includes the Windows native runtime; a Windows execution smoke test is still
needed when preparing a release.

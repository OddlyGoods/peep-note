# Local knowledge map embeddings

The knowledge map connects note nodes using content similarity. Groups and tags
do not create edges or influence the layout.

- Model: [`Xenova/multilingual-e5-small`](https://huggingface.co/Xenova/multilingual-e5-small), revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`.
- Inference: Transformers.js 3.8.1, quantized CPU model, 384 dimensions, two CPU threads, isolated Node worker.
- First map visit downloads approximately 130 MiB of public model assets. The cache lives in `<Electron userData>/models/embeddings`; the installed application directory is never used as a writable cache.
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

Indexing starts on the first map visit and follows subsequent note changes in the
background. The map polls progress while indexing is active. Failures show a retry
action; retrying keeps valid cached vectors. The inference worker releases the
model after 30 seconds without work.

Connections use mutual top-three neighbours, cosine similarity of at least 0.82,
and a local similarity margin when enough candidates exist. These are heuristic
relationships, not factual links or a universal similarity percentage. Isolated
notes remain visible. Vectors and note bodies are not returned in map responses.

## Development and verification

Use `npm ci --onnxruntime-node-install-cuda=skip` for a CPU-only development install.
Release CI sets `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`. Model weights are downloaded
at runtime and are not committed or included in the installer.

- `npm run test:local`: indexing, invalidation, privacy and graph regression tests with isolated databases and fake inference.
- `npm run test:map-native`: isolated Electron UI regression, using a synthetic map.
- `npm run test:embeddings-native`: real model, multilingual similarity, unrelated notes, long-note chunks, renderer responsiveness, offline cache and an ASAR using the production unpack pattern. The first run may download the model to a temporary test cache. Set `PEEPNOTE_EMBEDDING_TEST_CACHE` to reuse another test cache.

Native inference and ASAR loading are verified on Linux. Release packaging also
includes the Windows native runtime; a Windows execution smoke test is still
needed when preparing a release.

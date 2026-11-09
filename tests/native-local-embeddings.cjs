const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { EmbeddingWorker } = require('./client.cjs')
const { semanticConnections } = require('./semantic.cjs')
const options = require('./options.json')
app.setPath('userData', path.join(__dirname, 'isolated-user-data')); app.disableHardwareAcceleration()
const deadline = setTimeout(() => app.exit(1), 240000)
const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 400, height: 200, show: false })
  await window.loadURL('data:text/html,<script>window.ticks=0;setInterval(()=>window.ticks++,10)</script>')
  const client = new EmbeddingWorker(options)
  const vectors = []
  try {
    console.log('LOCAL_EMBEDDING_QA_PHASE regular')
    const texts = [
      'Retrieval augmented generation retrieves relevant documents from a vector database and provides them to the language model to generate grounded answers.',
      'RAG는 벡터 데이터베이스에서 질문과 관련된 문서를 검색하고 언어 모델에 전달해 근거가 있는 답변을 생성합니다.',
      'To bake sourdough bread, mix flour, water, salt and starter, let the dough ferment, then bake in a hot oven.',
      'SLAM combines lidar scans, wheel odometry and transforms to build a map and locate a mobile robot.',
    ]
    for (const text of texts) vectors.push(await client.embed(text, state => { if (state.stage === 'downloading' && state.progress % 20 === 0) console.log('MODEL_DOWNLOAD', state.progress) }))
    for (const vector of vectors) { assert.equal(vector.length, 384); assert.ok(Math.abs(Math.hypot(...vector) - 1) < .001) }
    assert.ok(cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2]) + .05, 'Korean and English notes on the same subject must be closer than an unrelated note')
    const edges = semanticConnections(new Map(vectors.map((vector, index) => [String(index), vector])))
    assert.ok(edges.some(edge => edge.source === '0' && edge.target === '1'))
    assert.ok(edges.every(edge => edge.source !== '2' && edge.target !== '2'), 'unrelated bread notes remain unconnected')
    const prefix = 'Document retrieval and grounded answers. '.repeat(220)
    const long = await client.embed(prefix + ' Baking sourdough bread with flour water and salt. '.repeat(220), () => {})
    const short = await client.embed(prefix, () => {})
    assert.ok(cosine(long, short) < .995, 'content after the first model context window participates in the pooled embedding')
    assert.ok(await window.webContents.executeJavaScript('window.ticks') > 5, 'renderer stays responsive during inference')
  } finally { client.dispose() }
  // Fresh worker, no downloads allowed: cache and packaged ASAR paths must work.
  console.log('LOCAL_EMBEDDING_QA_PHASE packaged-offline')
  const offline = new EmbeddingWorker({ ...options, offline: true, modulePath: options.asarModulePath })
  try {
    const vector = await offline.embed('Retrieval augmented generation retrieves relevant documents from a vector database and provides them to the language model to generate grounded answers.', state => { assert.notEqual(state.stage, 'downloading') })
    assert.ok(cosine(vector, vectors[0]) > .9999)
  } finally { offline.dispose() }
  window.destroy(); clearTimeout(deadline)
  console.log('LOCAL_EMBEDDING_QA_SUCCESS: real multilingual model, unrelated-note filtering, long-note chunks, responsive renderer, offline cache, Electron and ASAR native modules')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })

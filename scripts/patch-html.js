const fs = require('fs')
const path = require('path')

const files = ['dist/index.html', 'dist/overlay.html', 'dist/snipping.html']
files.forEach(f => {
  const fullPath = path.join(__dirname, '..', f)
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8')
    const patched = content.replace(/ crossorigin/g, '')
    fs.writeFileSync(fullPath, patched)
    console.log(`Patched: ${f}`)
  }
})

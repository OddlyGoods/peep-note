// 아이콘 생성 스크립트 (node로 실행)
// 실제 배포 시에는 proper .ico/.icns 파일로 교체하세요
const fs = require('fs')
const path = require('path')

// 1x1 투명 PNG (최소 placeholder)
const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
  '77533de0000000c4944415478016360f8cfc0c0c000000000020001e221' +
  'bc330000000049454e44ae426082',
  'hex'
)

fs.writeFileSync(path.join(__dirname, 'icon.png'), PNG_1x1)
console.log('Placeholder icon created. Replace with real icon before release.')

import assert from 'node:assert/strict'
import test from 'node:test'
import { externalWebUrl } from '../shared/noteLinks'
import { protectAppNavigation } from '../electron/appNavigation'

test('note links allow explicit web URLs while preserving paths, queries and fragments', () => {
  assert.equal(externalWebUrl('https://github.com/OddlyGoods/peep-note'), 'https://github.com/OddlyGoods/peep-note')
  assert.equal(externalWebUrl('HTTP://127.0.0.1:18765/docs?q=robot#L120'), 'http://127.0.0.1:18765/docs?q=robot#L120')
  assert.equal(externalWebUrl(' https://example.com/a%20b#section '), 'https://example.com/a%20b#section')
})

test('source paths and executable protocols never become external web links', () => {
  for (const href of [
    'src/peepnote-link-test/missing-device.cpp', 'README.md#L120',
    '/tmp/peepnote-link-test/missing-worker.cpp', 'C:\\project\\main.cpp',
    'file:///tmp/test.html', 'app://dist/index.html', '#section', '//example.com/path',
    'javascript:alert(1)', 'data:text/html,test', 'command:test', 'ms-settings:test',
    'https://user:password@example.com/', 'https://example.com\n/test', 'https:\\example.com',
    'https://', '', null, undefined, { url: 'https://example.com/' }
  ]) assert.equal(externalWebUrl(href), null, `Rejected ${String(href)}`)
})

function guardedContents(open: (url: string) => Promise<unknown>) {
  const listeners = new Map<string, (...args: any[]) => void>()
  let popup!: (details: { url: string }) => { action: string }
  protectAppNavigation({
    on: (name: string, handler: (...args: any[]) => void) => listeners.set(name, handler),
    setWindowOpenHandler: (handler: typeof popup) => { popup = handler }
  } as any, open)
  return {
    navigate: (url: string, modernEvent = false) => {
      let prevented = false
      listeners.get('will-navigate')!({ url: modernEvent ? url : undefined, preventDefault: () => { prevented = true } }, modernEvent ? undefined : url)
      return prevented
    },
    popup: (url: string) => popup({ url })
  }
}

test('full navigation and popups keep the app intact and send only web URLs outside', async () => {
  const opened: string[] = []
  const contents = guardedContents(async url => { opened.push(url) })
  assert.equal(contents.navigate('https://example.com/docs'), true)
  assert.equal(contents.navigate('file:///missing.cpp'), true)
  assert.equal(contents.navigate('app://dist/missing.cpp'), true)
  assert.equal(contents.navigate('https://example.com/modern-event', true), true)
  assert.deepEqual(contents.popup('https://example.com/other'), { action: 'deny' })
  assert.deepEqual(contents.popup('javascript:alert(1)'), { action: 'deny' })
  await Promise.resolve()
  assert.deepEqual(opened, ['https://example.com/docs', 'https://example.com/modern-event', 'https://example.com/other'])
})

test('a failed external browser launch cannot resume app navigation or crash the guard', async () => {
  for (const open of [async () => { throw new Error('test-only browser failure') }, () => { throw new Error('test-only synchronous failure') }]) {
    const contents = guardedContents(open)
    assert.equal(contents.navigate('https://example.com/'), true)
    assert.deepEqual(contents.popup('https://example.com/'), { action: 'deny' })
    await new Promise(resolve => setImmediate(resolve))
  }
})

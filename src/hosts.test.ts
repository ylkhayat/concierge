import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reachable, reachableIn, serverHost } from './hosts.ts'

const shared = { from: 'deck.', to: 'deck-mac.' } // a link two machines share, now served by "mac"

test('a localhost link from an agent opens on the machine that runs it, from wherever you are', () => {
  // on that machine itself it is right as it is
  assert.equal(reachable('http://localhost:40406', 'localhost'), 'http://localhost:40406')
  // from another device, through that machine's own name
  assert.equal(reachable('http://localhost:40406/files?x=1', 'my-pc.example.net'), 'http://my-pc.example.net:40406/files?x=1')
  assert.equal(reachable('http://127.0.0.1:4747/', 'my-pc.example.net'), 'http://my-pc.example.net:4747/')
  // through a shared link: the machine that runs it now
  assert.equal(reachable('http://localhost:40406', 'deck.example.net', shared), 'http://deck-mac.example.net:40406')
  // anything else is left alone
  assert.equal(reachable('https://github.com/a/b/pull/1', 'deck.example.net', shared), 'https://github.com/a/b/pull/1')
  assert.equal(reachable('http://localhostish.dev/x', 'deck.example.net', shared), 'http://localhostish.dev/x')
})

test('a shared link maps to the running machine only when the page is on it', () => {
  assert.equal(serverHost('deck.example.net', shared), 'deck-mac.example.net')
  assert.equal(serverHost('deck.example.net'), 'deck.example.net') // one machine
  assert.equal(serverHost('deck-windows.example.net', shared), 'deck-windows.example.net')
  assert.equal(serverHost('localhost', shared), 'localhost')
})

test('localhost links inside bold and code are rewritten too, and nothing else is', () => {
  const page = 'deck.example.net'
  assert.equal(reachableIn('Crit is open again at **http://localhost:40417**, same URL', page, shared), 'Crit is open again at **http://deck-mac.example.net:40417**, same URL')
  assert.equal(reachableIn('see `http://127.0.0.1:40417/files` and http://localhost:8080/x', page, shared), 'see `http://deck-mac.example.net:40417/files` and http://deck-mac.example.net:8080/x')
  assert.equal(reachableIn('http://localhostish.dev and https://github.com/x', page, shared), 'http://localhostish.dev and https://github.com/x')
  assert.equal(reachableIn('**http://localhost:40417**', 'localhost'), '**http://localhost:40417**')
})

import { describe, expect, it } from 'vitest'
import { DapMessageParser } from './dap-client'

describe('DapMessageParser', () => {
  it('parses messages split across chunks', () => {
    const parser = new DapMessageParser()
    const first = JSON.stringify({
      seq: 1,
      type: 'response',
      command: 'initialize',
      success: true,
      body: {}
    })
    const second = JSON.stringify({
      seq: 2,
      type: 'event',
      event: 'initialized'
    })
    const packet = Buffer.from(
      `Content-Length: ${Buffer.byteLength(first)}\r\n\r\n${first}` +
        `Content-Length: ${Buffer.byteLength(second)}\r\n\r\n${second}`
    )

    expect(parser.push(packet.subarray(0, 13))).toEqual([])
    const messages = parser.push(packet.subarray(13))
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      type: 'response',
      command: 'initialize'
    })
    expect(messages[1]).toMatchObject({
      type: 'event',
      event: 'initialized'
    })
  })

  it('ignores malformed payloads', () => {
    const parser = new DapMessageParser()
    const malformed = Buffer.from(
      'Content-Length: 4\r\n\r\nnope'
    )
    expect(parser.push(malformed)).toEqual([])
  })
})

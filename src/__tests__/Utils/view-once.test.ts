import { proto } from '../../../WAProto/index.js'
import { jest } from '@jest/globals'
import { randomBytes } from 'crypto'
import { downloadViewOnceMessage, extractViewOnceMedia, generateWAMessageContent, isViewOnceMessage } from '../../Utils/messages'

const JPEG_B64 =
	'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAIAAgDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q=='
const TINY_JPEG = Buffer.from(JPEG_B64, 'base64')

// minimal valid WAV: 44-byte header, 8kHz mono 16-bit, 400 silent samples
function tinyWav() {
	const dataSize = 800
	const buf = Buffer.alloc(44 + dataSize)
	buf.write('RIFF', 0)
	buf.writeUInt32LE(36 + dataSize, 4)
	buf.write('WAVE', 8)
	buf.write('fmt ', 12)
	buf.writeUInt32LE(16, 16)
	buf.writeUInt16LE(1, 20)
	buf.writeUInt16LE(1, 22)
	buf.writeUInt32LE(8000, 24)
	buf.writeUInt32LE(16000, 28)
	buf.writeUInt16LE(2, 32)
	buf.writeUInt16LE(16, 34)
	buf.write('data', 36)
	buf.writeUInt32LE(dataSize, 40)
	return buf
}

const upload = async () => ({ mediaUrl: 'https://mmg.test/enc', directPath: '/v/t62/enc' })
const OPTS = { upload } as never

/** encode + decode round-trip through the real wire format */
const wireRoundTrip = (m: proto.IMessage) => proto.Message.decode(proto.Message.encode(m).finish())

describe('isViewOnceMessage', () => {
	const image = { imageMessage: { caption: 'hi' } }

	it('detects every view once wrapper', () => {
		expect(isViewOnceMessage({ viewOnceMessage: { message: image } })).toBe(true)
		expect(isViewOnceMessage({ viewOnceMessageV2: { message: image } })).toBe(true)
		expect(isViewOnceMessage({ viewOnceMessageV2Extension: { message: { audioMessage: { ptt: true } } } })).toBe(true)
		expect(isViewOnceMessage({ viewOnceMessage: { message: { ptvMessage: { seconds: 5 } } } })).toBe(true)
	})

	it('looks through a disappearing message wrapper', () => {
		expect(isViewOnceMessage({ ephemeralMessage: { message: { viewOnceMessageV2: { message: image } } } })).toBe(true)
		expect(isViewOnceMessage({ ephemeralMessage: { message: image } })).toBe(false)
	})

	it('ignores view once wrappers around non-media content', () => {
		const buttons = { buttonsMessage: { contentText: 'pick one' } }
		expect(isViewOnceMessage({ viewOnceMessage: { message: buttons } })).toBe(false)
		expect(isViewOnceMessage({ viewOnceMessageV2: { message: { conversation: 'hi' } } })).toBe(false)
		expect(isViewOnceMessage({ viewOnceMessage: {} })).toBe(false)
	})

	it('ignores regular and empty content', () => {
		expect(isViewOnceMessage(image)).toBe(false)
		expect(isViewOnceMessage({ conversation: 'hello' })).toBe(false)
		expect(isViewOnceMessage(undefined)).toBe(false)
		expect(isViewOnceMessage(null)).toBe(false)
	})

	it('works on decoded protobuf messages', () => {
		const encoded = proto.Message.encode({ viewOnceMessageV2: { message: image } }).finish()
		expect(isViewOnceMessage(proto.Message.decode(encoded))).toBe(true)
		const plain = proto.Message.encode({ conversation: 'hello' }).finish()
		expect(isViewOnceMessage(proto.Message.decode(plain))).toBe(false)
	})
})

describe('generateWAMessageContent view once', () => {
	it('wraps an image in the V1 envelope with the inner viewOnce flag', async () => {
		const m = await generateWAMessageContent(
			{ image: TINY_JPEG, jpegThumbnail: JPEG_B64, caption: 'hi', viewOnce: true },
			OPTS
		)
		expect(m.viewOnceMessage).toBeTruthy()
		expect(m.viewOnceMessage?.message?.imageMessage).toBeTruthy()
		// the media build carries the flag onto the inner message itself
		expect(m.viewOnceMessage?.message?.imageMessage?.viewOnce).toBe(true)
	})

	it('wraps text in V2 with the inner viewOnce flag', async () => {
		const m = await generateWAMessageContent({ text: 'secret', viewOnceV2: true }, OPTS)
		expect(m.viewOnceMessageV2).toBeTruthy()
		expect(m.viewOnceMessageV2?.message?.extendedTextMessage?.viewOnce).toBe(true)
		// wire round-trip: the envelope and the flag survive the real proto
		const dec = wireRoundTrip(m)
		expect(dec.viewOnceMessageV2?.message?.extendedTextMessage?.viewOnce).toBe(true)
	})

	it('wraps an image in V2 with the inner viewOnce flag', async () => {
		const m = await generateWAMessageContent(
			{ image: TINY_JPEG, jpegThumbnail: JPEG_B64, caption: 'hi', viewOnceV2: true },
			OPTS
		)
		expect(m.viewOnceMessageV2?.message?.imageMessage?.viewOnce).toBe(true)
	})

	it('wraps a video in V2 with the inner viewOnce flag', async () => {
		const m = await generateWAMessageContent(
			{ video: Buffer.from('fake-video-bytes'), jpegThumbnail: JPEG_B64, viewOnceV2: true },
			OPTS
		)
		expect(m.viewOnceMessageV2?.message?.videoMessage?.viewOnce).toBe(true)
	})

	it('wraps a voice note in the V2 extension with the inner viewOnce flag', async () => {
		const m = await generateWAMessageContent(
			{ audio: tinyWav(), ptt: true, seconds: 1, viewOnceV2Extension: true },
			OPTS
		)
		expect(m.viewOnceMessageV2Extension?.message?.audioMessage?.viewOnce).toBe(true)
		expect(m.viewOnceMessageV2Extension?.message?.audioMessage?.ptt).toBe(true)
	})

	it('wraps a round video in V2 with the inner viewOnce flag on ptvMessage', async () => {
		const m = await generateWAMessageContent(
			{ video: Buffer.from('fake-ptv-bytes'), ptv: true, jpegThumbnail: JPEG_B64, viewOnceV2: true },
			OPTS
		)
		expect(m.viewOnceMessageV2?.message?.ptvMessage?.viewOnce).toBe(true)
		expect(m.viewOnceMessageV2?.message?.videoMessage).toBeFalsy()
	})
})


describe('extractViewOnceMedia', () => {
	const mediaKey = randomBytes(32)
	const image = { imageMessage: { caption: 'hi', mediaKey, url: 'https://mmg.whatsapp.net/v/t62/enc' } }

	it('unwraps every view once wrapper', () => {
		for (const wrap of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'] as const) {
			const found = extractViewOnceMedia({ [wrap]: { message: image } })
			expect(found?.isViewOnce).toBe(true)
			expect(found?.mediaType).toBe('image')
			expect(found?.media.caption).toBe('hi')
		}
	})

	it('peels nested disappearing wrappers in either order', () => {
		const deep = { ephemeralMessage: { message: { viewOnceMessageV2: { message: image } } } }
		expect(extractViewOnceMedia(deep)?.isViewOnce).toBe(true)
		const under = { viewOnceMessage: { message: { ephemeralMessage: { message: image } } } }
		expect(extractViewOnceMedia(under)?.isViewOnce).toBe(true)
	})

	it('handles document view once, including documentWithCaptionMessage', () => {
		const doc = { documentMessage: { fileName: 'a.pdf', mediaKey, url: 'https://mmg.whatsapp.net/v/t62/enc' } }
		expect(extractViewOnceMedia({ viewOnceMessageV2: { message: doc } })?.mediaType).toBe('document')
		const captioned = { documentWithCaptionMessage: { message: { documentMessage: doc.documentMessage } } }
		expect(extractViewOnceMedia({ viewOnceMessageV2: { message: captioned } })?.mediaType).toBe('document')
	})

	it('counts a bare media message carrying the viewOnce flag', () => {
		const bare = { imageMessage: { ...image.imageMessage, viewOnce: true } }
		const found = extractViewOnceMedia(bare)
		expect(found?.isViewOnce).toBe(true)
		expect(found?.mediaType).toBe('image')
	})

	it('returns the media with isViewOnce false for a regular message', () => {
		const found = extractViewOnceMedia(image)
		expect(found?.isViewOnce).toBe(false)
		expect(found?.mediaType).toBe('image')
	})

	it('returns undefined for non-media content', () => {
		expect(extractViewOnceMedia({ conversation: 'hi' })).toBeUndefined()
		expect(extractViewOnceMedia({ viewOnceMessage: { message: { buttonsMessage: { contentText: 'pick' } } } })).toBeUndefined()
		expect(extractViewOnceMedia(undefined)).toBeUndefined()
		expect(extractViewOnceMedia(null)).toBeUndefined()
	})

	it('detects round video view once', () => {
		const ptv = { ptvMessage: { seconds: 5, mediaKey } }
		expect(extractViewOnceMedia({ viewOnceMessageV2: { message: ptv } })?.mediaType).toBe('ptv')
	})
})

describe('downloadViewOnceMessage', () => {
	const silentLogger = {
		level: 'silent',
		trace: () => {},
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
		fatal: () => {},
		child: () => silentLogger
	}
	const REUPLOAD_URL =
		'https://mmg.whatsapp.net/v/t62.15575-24/123_456_n.enc?ccb=11-4&oh=abc&oe=def&_nc_sid=5e03e0'
	const mediaKey = randomBytes(32)
	const key = { remoteJid: '123@s.whatsapp.net', fromMe: false, id: 'MSG1' }
	const stopFetch = () => jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('stop'))

	it('rejects a message that is not view once media', async () => {
		const msg = { key, message: { imageMessage: { mediaKey, url: REUPLOAD_URL } } } as never
		await expect(downloadViewOnceMessage(msg, 'buffer', {}, { logger: silentLogger } as never)).rejects.toThrow('not a view once')
	})

	it('rejects a URL-less view once with no reuploadRequest', async () => {
		const msg = { key, message: { viewOnceMessageV2: { message: { imageMessage: { mediaKey } } } } } as never
		await expect(downloadViewOnceMessage(msg, 'buffer', {}, { logger: silentLogger } as never)).rejects.toThrow('no download URL')
	})

	it('re-uploads a URL-less view once first, then downloads the fresh URL', async () => {
		const reuploadRequest = jest.fn(async (_m: never) => ({
			key,
			message: { viewOnceMessageV2: { message: { imageMessage: { mediaKey, url: REUPLOAD_URL } } } }
		}))
		const msg = { key, message: { viewOnceMessageV2: { message: { imageMessage: { mediaKey } } } } } as never
		const fetchSpy = stopFetch()
		try {
			await expect(downloadViewOnceMessage(msg, 'buffer', {}, { reuploadRequest, logger: silentLogger } as never)).rejects.toThrow('stop')
			expect(reuploadRequest).toHaveBeenCalledTimes(1)
			expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(REUPLOAD_URL)
		} finally {
			fetchSpy.mockRestore()
		}
	})

	it('downloads a view once that already has a URL without re-uploading', async () => {
		const reuploadRequest = jest.fn(async (m: never) => m)
		const msg = { key, message: { viewOnceMessageV2: { message: { imageMessage: { mediaKey, url: REUPLOAD_URL } } } } } as never
		const fetchSpy = stopFetch()
		try {
			await expect(downloadViewOnceMessage(msg, 'buffer', {}, { reuploadRequest, logger: silentLogger } as never)).rejects.toThrow('stop')
			expect(reuploadRequest).not.toHaveBeenCalled()
				expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(REUPLOAD_URL)
		} finally {
			fetchSpy.mockRestore()
		}
	})

	it('re-uploads a view once when its signed URL has expired', async () => {
		const expiredUrl = 'https://mmg.whatsapp.net/v/t62/expired.enc?oe=1'
		const reuploadRequest = jest.fn(async (_m: never) => ({
			key,
			message: { viewOnceMessageV2: { message: { imageMessage: { mediaKey, url: REUPLOAD_URL } } } }
		}))
		const msg = { key, message: { viewOnceMessageV2: { message: { imageMessage: { mediaKey, url: expiredUrl } } } } } as never
		const fetchSpy = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response('', { status: 403 }))
			.mockRejectedValueOnce(new Error('stop'))
		try {
			await expect(downloadViewOnceMessage(msg, 'buffer', {}, { reuploadRequest, logger: silentLogger } as never)).rejects.toThrow('stop')
			expect(reuploadRequest).toHaveBeenCalledTimes(1)
			expect(fetchSpy).toHaveBeenCalledTimes(2)
			expect(String(fetchSpy.mock.calls[1]?.[0])).toBe(REUPLOAD_URL)
		} finally {
			fetchSpy.mockRestore()
		}
	})
})

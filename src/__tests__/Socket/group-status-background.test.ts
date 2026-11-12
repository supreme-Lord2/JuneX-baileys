import { proto } from '../../../WAProto/index.js'
import type { GroupStatusDeps } from '../../Socket/groupStatus.js'
import { sendGroupStatus } from '../../Socket/groupStatus.js'
import { generateWAMessageContent } from '../../Utils/messages.js'

const upload: GroupStatusDeps['waUploadToServer'] = async () => {
	throw new Error('Text statuses must not upload media')
}

it('encodes personal status background and font', async () => {
	const message = await generateWAMessageContent(
		{ text: 'Personal status' },
		{
			upload,
			backgroundColor: '#112233',
			font: 2
		}
	)
	expect(message.extendedTextMessage?.backgroundArgb).toBe(0xff112233)
	expect(message.extendedTextMessage?.font).toBe(2)
})

it('preserves background and font inside group status and relays it', async () => {
	let relayed: proto.IMessage | undefined
	const result = await sendGroupStatus(
		'123456789@g.us',
		{ text: 'Group status' },
		{
			waUploadToServer: upload,
			userJid: '254700000000@s.whatsapp.net',
			relayMessage: async (_jid, message) => {
				relayed = message
			}
		},
		{ backgroundColor: '#445566', font: 3 }
	)
	expect(relayed).toBe(result.message)
	const inner = relayed?.groupStatusMessageV2?.message
	expect(inner?.extendedTextMessage?.backgroundArgb).toBe(0xff445566)
	expect(inner?.extendedTextMessage?.font).toBe(3)
})

it('uses the same message secret on the wrapper and wrapped content', async () => {
	let relayed: proto.IMessage | undefined
	let relayedJid: string | undefined
	let relayMessageId: string | undefined
	const jid = '123456789@g.us'
	const result = await sendGroupStatus(
		jid,
		{ text: 'Secret wrapper test' },
		{
			waUploadToServer: upload,
			userJid: '254700000000@s.whatsapp.net',
			relayMessage: async (targetJid, message, options) => {
				relayedJid = targetJid
				relayed = message
				relayMessageId = options.messageId
			}
		}
	)

	const outerSecret = relayed?.messageContextInfo?.messageSecret
	const innerSecret = relayed?.groupStatusMessageV2?.message?.messageContextInfo?.messageSecret
	expect(outerSecret).toHaveLength(32)
	expect(Buffer.from(outerSecret!).equals(Buffer.from(innerSecret!))).toBe(true)
	expect(relayedJid).toBe(jid)
	expect(relayMessageId).toBe(result.key.id)
	expect(result.message).toBe(relayed)
})

it('keeps existing group status calls without options working', async () => {
	const result = await sendGroupStatus(
		'123456789@g.us',
		{ text: 'Default status' },
		{
			waUploadToServer: upload,
			userJid: '254700000000@s.whatsapp.net',
			relayMessage: async () => undefined
		}
	)
	expect(result.message?.groupStatusMessageV2?.message?.extendedTextMessage?.text).toBe('Default status')
})

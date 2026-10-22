import crypto from 'crypto'
import { proto } from '../../WAProto/index.js'
import { generateWAMessageContent, generateWAMessageFromContent } from '../Utils/messages'
import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage } from '../Types/index.js'
import type { WAMediaUploadFunction } from '../Types/Message.js'

export type GroupStatusDeps = {
	relayMessage: (jid: string, message: proto.IMessage, opts: { messageId: string }) => Promise<unknown>
	waUploadToServer: WAMediaUploadFunction
	userJid?: string
}

export type GroupStatusOptions = Pick<MiscMessageGenerationOptions, 'backgroundColor' | 'font'>

/**
 * Post a group-status update using WhatsApp's groupStatusMessageV2 wrapper.
 *
 * The inner content uses the same AnyMessageContent shapes as sendMessage,
 * including text, image, video, audio, sticker, and other supported content.
 */
export const sendGroupStatus = async (
	jid: string,
	content: AnyMessageContent,
	deps: GroupStatusDeps,
	options: GroupStatusOptions = {}
): Promise<WAMessage> => {
	const { relayMessage, waUploadToServer, userJid } = deps

	// Build/upload the inner message exactly as a normal Baileys message.
	const inner = await generateWAMessageContent(content, {
		upload: waUploadToServer,
		...options
	})
	const messageSecret = crypto.randomBytes(32)

	// WhatsApp expects the same secret on both the outer message and the
	// wrapped inner message. The wrapper must be generated before relaying so
	// the generated message ID and group participant are preserved.
	const wrapped = generateWAMessageFromContent(
		jid,
		{
			messageContextInfo: { messageSecret },
			groupStatusMessageV2: {
				message: {
					...inner,
					messageContextInfo: { messageSecret }
				}
			}
		},
		{ userJid } as any
	)

	await relayMessage(jid, wrapped.message!, { messageId: wrapped.key.id! })
	return wrapped
}

import type { proto } from '../../WAProto/index.js'
import type makeWASocket from '../Socket'
import type { WAMediaUpload, WAMessage } from '../Types'
import { generateWAMessageFromContent, prepareWAMessageMedia } from './messages'

/**
 * Media payloads supported by the experimental group-status helper.
 * Group-status posting is not yet a documented Baileys feature; verify delivery
 * on a test account before relying on this in production.
 */
export type GroupStatusMediaContent =
	| {
			image: WAMediaUpload
			caption?: string
			mimetype?: string
			jpegThumbnail?: string
			contextInfo?: proto.IContextInfo
	  }
	| {
			video: WAMediaUpload
			caption?: string
			mimetype?: string
			jpegThumbnail?: string
			gifPlayback?: boolean
			ptv?: boolean
			contextInfo?: proto.IContextInfo
	  }
	| {
			audio: WAMediaUpload
			mimetype?: string
			ptt?: boolean
			seconds?: number
			contextInfo?: proto.IContextInfo
	  }

export type GroupStatusSocket = Pick<ReturnType<typeof makeWASocket>, 'user' | 'waUploadToServer' | 'relayMessage'>

/**
 * Sends image, video, or audio as a WhatsApp group status/story.
 *
 * This constructs a groupStatusMessageV2 wrapper and relays it to the group.
 * WhatsApp's server-side behavior is not guaranteed by the presence of the
 * protobuf field alone. Use a test group/account and verify the result in the
 * official WhatsApp client.
 *
 * @param sock Connected Baileys socket
 * @param groupJid WhatsApp group JID, for example `120363000000000000@g.us`
 * @param content Image, video, or audio payload accepted by Baileys media upload
 */
export async function sendGroupStatusMedia(
	sock: GroupStatusSocket,
	groupJid: string,
	content: GroupStatusMediaContent
): Promise<WAMessage> {
	if (!groupJid.endsWith('@g.us')) {
		throw new TypeError(`Expected a group JID ending in @g.us; received ${groupJid}`)
	}

	const userJid = sock.user?.id
	if (!userJid) {
		throw new Error('Baileys socket is not connected: current user JID is unavailable')
	}

	const mediaKey = 'image' in content ? 'imageMessage' : 'video' in content ? 'videoMessage' : 'audioMessage'
	const mediaMessage = await prepareWAMessageMedia(content, {
		upload: sock.waUploadToServer,
		jid: groupJid
	})
	const media = mediaMessage[mediaKey] as
		| proto.Message.IImageMessage
		| proto.Message.IVideoMessage
		| proto.Message.IAudioMessage
		| null

	if (!media) {
		throw new Error(`Baileys did not prepare the expected ${mediaKey} payload`)
	}

	media.contextInfo = {
		...content.contextInfo,
		isGroupStatus: true
	}

	const wrappedMessage: proto.IMessage = {
		groupStatusMessageV2: {
			message: mediaMessage
		}
	}
	const generated = generateWAMessageFromContent(groupJid, wrappedMessage, { userJid })

	await sock.relayMessage(groupJid, generated.message!, {
		messageId: generated.key.id!
	})

	return generated
}

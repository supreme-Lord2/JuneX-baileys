import { sha256 } from '../../Utils/crypto'
import { decryptPollVote, encryptPollVote } from '../../Utils/process-message'

describe('poll vote encryption', () => {
	it('round-trips the hashed option selections', () => {
		const context = {
			pollCreatorJid: '11111@s.whatsapp.net',
			pollMsgId: 'POLLMSGID1234567890',
			pollEncKey: new Uint8Array(32).fill(7),
			voterJid: '22222@s.whatsapp.net'
		}
		const selectedOptions = [sha256(Buffer.from('Red')), sha256(Buffer.from('Blue'))]
		const encrypted = encryptPollVote({ selectedOptions }, context)
		const decrypted = decryptPollVote(encrypted, context)

		expect(decrypted.selectedOptions).toHaveLength(2)
		expect(Buffer.from(decrypted.selectedOptions![0]!).equals(Buffer.from(selectedOptions[0]!))).toBe(true)
		expect(Buffer.from(decrypted.selectedOptions![1]!).equals(Buffer.from(selectedOptions[1]!))).toBe(true)
	})
})

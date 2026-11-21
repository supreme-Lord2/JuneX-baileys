import { getPollVoteVoterJid } from '../../Utils/process-message.js'

const pnJid = '12345:7@s.whatsapp.net'
const lidJid = '98765:3@lid'

describe('getPollVoteVoterJid', () => {
	it('uses the account LID for a LID-addressed poll', () => {
		expect(getPollVoteVoterJid('creator@s.whatsapp.net', { addressingMode: 'lid' }, pnJid, lidJid)).toBe('98765@lid')
	})

	it('uses the account LID when the poll participant is LID-addressed', () => {
		expect(getPollVoteVoterJid('creator@s.whatsapp.net', { participant: '55555@lid' }, pnJid, lidJid)).toBe('98765@lid')
	})

	it('uses the account LID when the poll creator is a LID', () => {
		expect(getPollVoteVoterJid('55555@lid', {}, pnJid, lidJid)).toBe('98765@lid')
	})

	it('keeps the PN identity for a PN poll even when an account LID exists', () => {
		expect(getPollVoteVoterJid('creator@s.whatsapp.net', { addressingMode: 'pn' }, pnJid, lidJid)).toBe(
			'12345@s.whatsapp.net'
		)
	})

	it('falls back to PN when a LID-addressed poll has no account LID', () => {
		expect(getPollVoteVoterJid('creator@s.whatsapp.net', { addressingMode: 'lid' }, pnJid)).toBe('12345@s.whatsapp.net')
	})
})

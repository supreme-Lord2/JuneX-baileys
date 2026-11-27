import { executeWMexQuery, parseWMexContent } from '../../Socket/mex.js'

const JOIN_RESULT = '{"data":{"xwa2_newsletter_join_v2":{"id":"120363405182019728@newsletter"}}}'

describe('parseWMexContent', () => {
	it('parses a normal payload untouched', () => {
		const data = parseWMexContent(JOIN_RESULT)
		expect(data.data.xwa2_newsletter_join_v2.id).toBe('120363405182019728@newsletter')
	})

	it('parses a payload with a NUL inside a string', () => {
		const payload = '{"data":{"xwa2_newsletter_join_v2":{"id":"120363405182019728@ne\u0000wsletter"}}}'
		const data = parseWMexContent(payload)
		expect(data.data.xwa2_newsletter_join_v2.id).toBe('120363405182019728@newsletter')
	})

	it('parses a payload with a byte-order mark prefix', () => {
		const data = parseWMexContent('\uFEFF' + JOIN_RESULT)
		expect(data.data.xwa2_newsletter_join_v2.id).toBe('120363405182019728@newsletter')
	})

	it('parses a payload with leading control bytes', () => {
		const data = parseWMexContent('\u0001\u0002' + JOIN_RESULT)
		expect(data.data.xwa2_newsletter_join_v2.id).toBe('120363405182019728@newsletter')
	})

	it('parses a payload with trailing garbage bytes', () => {
		const data = parseWMexContent(JOIN_RESULT + '\u0000\u0000')
		expect(data.data.xwa2_newsletter_join_v2.id).toBe('120363405182019728@newsletter')
	})

	it('still surfaces GraphQL errors as data, not as a parse failure', () => {
		const payload = '{"errors":[{"message":"not authorized","extensions":{"error_code":403}}]}'
		const data = parseWMexContent(payload)
		expect(data.errors[0].message).toBe('not authorized')
		expect(data.errors[0].extensions.error_code).toBe(403)
	})

	it('throws a Boom carrying the raw payload when the body is genuinely binary', () => {
		const binary = '\u0008\u0001\u0012\u0016120363405182019728@newsletter'
		let thrown: any
		try {
			parseWMexContent(binary)
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeDefined()
		expect(thrown.isBoom).toBe(true)
		expect(thrown.output.statusCode).toBe(400)
		expect(thrown.message).toContain('w:mex non-JSON payload')
		expect(thrown.message).toContain('hex')
	})
})

describe('executeWMexQuery - newsletter binary ack', () => {
	// the exact shape WhatsApp sends on 2026-11: 0x04 + ":<jid>" + NUL padding
	const BINARY_ACK = '\u0004:120363405182019728@newsletter' + '\u0000'.repeat(14)

	const iqWith = (content: Buffer) =>
		({ tag: 'iq', attrs: {}, content: [{ tag: 'result', attrs: {}, content }] } as any)
	const tag = () => 'TEST_TAG'

	it('accepts a binary ack on newsletter join instead of failing', async () => {
		const result = await executeWMexQuery(
			{ newsletter_id: '120363405182019728@newsletter' },
			'24404358912487870',
			'xwa2_newsletter_join_v2',
			async () => iqWith(Buffer.from(BINARY_ACK, 'utf8')),
			tag
		)
		expect(result).toEqual({})
	})

	it('accepts a binary ack on newsletter leave too', async () => {
		const result = await executeWMexQuery(
			{ newsletter_id: '120363405182019728@newsletter' },
			'9767147403369991',
			'xwa2_newsletter_leave_v2',
			async () => iqWith(Buffer.from(BINARY_ACK, 'utf8')),
			tag
		)
		expect(result).toEqual({})
	})

	it('still throws for a binary body on any other mex query', async () => {
		let thrown: any
		try {
			await executeWMexQuery(
				{},
				'999',
				'xwa2_newsletter_metadata',
				async () => iqWith(Buffer.from(BINARY_ACK, 'utf8')),
				tag
			)
		} catch (error) {
			thrown = error
		}
		expect(thrown?.isBoom).toBe(true)
		expect(thrown.message).toContain('w:mex non-JSON payload')
	})

	it('leaves JSON responses on the join path untouched', async () => {
		const result = await executeWMexQuery<{ id: string }>(
			{ newsletter_id: 'x' },
			'24404358912487870',
			'xwa2_newsletter_join_v2',
			async () => iqWith(Buffer.from(JOIN_RESULT, 'utf8')),
			tag
		)
		expect(result.id).toBe('120363405182019728@newsletter')
	})
})

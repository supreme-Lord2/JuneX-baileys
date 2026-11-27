import { parseWMexContent } from '../../Socket/mex.js'

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

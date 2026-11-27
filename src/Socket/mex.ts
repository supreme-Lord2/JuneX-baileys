import nodeFs from 'node:fs'
import nodePath from 'node:path'
import { Boom } from '@hapi/boom'
import type { BinaryNode } from '../WABinary'
import { getBinaryNodeChild, S_WHATSAPP_NET } from '../WABinary'

const wMexQuery = (
	variables: Record<string, unknown>,
	queryId: string,
	query: (node: BinaryNode) => Promise<BinaryNode>,
	generateMessageTag: () => string
) => {
	return query({
		tag: 'iq',
		attrs: {
			id: generateMessageTag(),
			type: 'get',
			to: S_WHATSAPP_NET,
			xmlns: 'w:mex'
		},
		content: [
			{
				tag: 'query',
				attrs: { query_id: queryId },
				content: Buffer.from(JSON.stringify({ variables }), 'utf-8')
			}
		]
	})
}

/**
 * WhatsApp occasionally returns the w:mex <result> body with a stray byte-order
 * mark, a NUL or another invisible control character. A bare JSON.parse then
 * throws
 *
 *   Unexpected token '', ", ":12036340"... is not valid JSON
 *
 * where the offending token looks empty on screen. Retry against a cleaned copy
 * before giving up, and when we do give up, surface the raw payload (text + hex)
 * so the caller can report the real reason instead of a parser error.
 */
const STRIP_INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g

const tryJSON = (text: string): { ok: true; data: any } | { ok: false } => {
	try {
		return { ok: true, data: JSON.parse(text) }
	} catch {
		return { ok: false }
	}
}

export const parseWMexContent = (raw: string) => {
	const strict = tryJSON(raw)
	if (strict.ok) return strict.data

	// 1. invisible bytes (BOM, NUL, zero-width, C0 controls) removed
	const cleaned = raw.replace(STRIP_INVISIBLE_RE, '')
	const stripped = tryJSON(cleaned)
	if (stripped.ok) return stripped.data

	// 2. keep only the outermost JSON region, then retry
	const first = cleaned.search(/[{[]/)
	const last = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
	if (first !== -1 && last > first) {
		const region = tryJSON(cleaned.slice(first, last + 1))
		if (region.ok) return region.data
	}

	throw new Boom(
		`w:mex non-JSON payload (${Buffer.byteLength(raw, 'utf8')} bytes, hex ${Buffer.from(raw, 'utf8').subarray(0, 48).toString('hex')}): ${raw.slice(0, 200)}`,
		{ statusCode: 400 }
	)
}

/**
 * WhatsApp answers some newsletter joins with a short BINARY acknowledgement
 * instead of the JSON GraphQL body. Observed shape (45 bytes):
 *
 *   04 3a 31 32 ...  "\u0004:120363405182019728@newsletter" + NUL padding
 *
 * The join itself succeeds - only the body shape differs, so a JSON-only reader
 * reports a failure that never happened. Accept it for join/leave and keep the
 * raw bytes on disk so the shape can be inspected after the fact.
 */
const BINARY_ACK_RE = /xwa2_newsletter_(join|leave)_v2/

const reportedBinaryAcks = new Set<string>()

const reportBinaryAck = (dataPath: string, raw: string) => {
	try {
		const file = nodePath.join(process.env.JUNE_ROOT || process.cwd(), 'w-mex-report.txt')
		const bytes = Buffer.from(raw, 'utf8')
		nodeFs.appendFileSync(
			file,
			[
				`[${new Date().toISOString()}] binary-ack ${dataPath}`,
				`  bytes: ${bytes.length}`,
				`  hex  : ${bytes.toString('hex')}`,
				`  utf8 : ${JSON.stringify(bytes.toString('utf8'))}`,
				''
			].join('\n')
		)
		if (nodeFs.statSync(file).size > 256 * 1024) nodeFs.writeFileSync(file, '')
	} catch {
		// diagnostics must never break the caller
	}

	// Silent by default: a successful join is not news. Set JUNE_WMEX_ACK_LOG=1
	// to see the ack on the console (the raw bytes are always kept on disk).
	const noisy = /^(1|true|yes|on)$/i.test(String(process.env.JUNE_WMEX_ACK_LOG || ''))
	if (noisy && !reportedBinaryAcks.has(dataPath)) {
		reportedBinaryAcks.add(dataPath)
		console.warn(`[ w:mex ] ${dataPath} answered with a binary ack - treating as accepted`)
	}
}

export const executeWMexQuery = async <T>(
	variables: Record<string, unknown>,
	queryId: string,
	dataPath: string,
	query: (node: BinaryNode) => Promise<BinaryNode>,
	generateMessageTag: () => string
): Promise<T> => {
	const result = await wMexQuery(variables, queryId, query, generateMessageTag)
	const child = getBinaryNodeChild(result, 'result')
	if (child?.content) {
		let data: any
		try {
			data = parseWMexContent(child.content.toString())
		} catch (error) {
			if (BINARY_ACK_RE.test(dataPath || '')) {
				reportBinaryAck(dataPath, child.content.toString())
				return {} as T
			}
			throw error
		}

		if (data.errors && data.errors.length > 0) {
			const errorMessages = data.errors.map((err: Error) => err.message || 'Unknown error').join(', ')
			const firstError = data.errors[0]
			const errorCode = firstError.extensions?.error_code || 400
			throw new Boom(`GraphQL server error: ${errorMessages}`, { statusCode: errorCode, data: firstError })
		}

		const response = dataPath ? data?.data?.[dataPath] : data?.data
		if (typeof response !== 'undefined') {
			return response as T
		}
	}

	const action = (dataPath || '').startsWith('xwa2_')
		? dataPath.substring(5).replace(/_/g, ' ')
		: dataPath?.replace(/_/g, ' ')
	throw new Boom(`Failed to ${action}, unexpected response structure.`, { statusCode: 400, data: result })
}

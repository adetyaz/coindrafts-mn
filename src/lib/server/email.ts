// Email delivery.
//
// Deliberately optional. Everything that sends mail here also works without it —
// a tournament invite is a shareable link, and email is just one way to hand
// that link over. So an unconfigured or failing mail service degrades the
// experience rather than breaking the feature.
//
// Adapted from the working Gmail/nodemailer setup, with three changes:
//   • nodemailer is imported lazily, so the app runs with it uninstalled
//   • callers must be authorised — this module never exposes a generic
//     "send arbitrary mail" route, which would be an open relay
//   • failures are reported, never thrown into a request path
import { env } from '$env/dynamic/private';

export type SendResult =
	| { ok: true; messageId: string }
	| { ok: false; reason: 'not_configured' | 'not_installed' | 'send_failed'; detail?: string };

export function isEmailConfigured(): boolean {
	return Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

/** Minimal HTML from plain text — same shape as the original helper. */
function formatEmailContent(content: string): string {
	return content
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\n/g, '<br>')
		.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

export async function sendEmail(opts: {
	to: string;
	subject: string;
	content: string;
}): Promise<SendResult> {
	if (!isEmailConfigured()) {
		return { ok: false, reason: 'not_configured' };
	}

	// Lazy import: the package may not be installed, and that must not stop the
	// rest of the app from starting.
	let nodemailer;
	try {
		nodemailer = (await import('nodemailer')).default;
	} catch {
		return { ok: false, reason: 'not_installed' };
	}

	try {
		const transporter = nodemailer.createTransport({
			service: 'gmail',
			auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD }
		});

		const result = await transporter.sendMail({
			from: `"CoinDraft" <${env.GMAIL_USER}>`,
			to: opts.to,
			subject: opts.subject,
			text: opts.content,
			html: formatEmailContent(opts.content)
		});

		return { ok: true, messageId: result.messageId };
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'unknown';
		console.error('[email] send failed:', detail);
		return { ok: false, reason: 'send_failed', detail };
	}
}

/** The invite email. Kept here so the wording lives with the sender. */
export function tournamentInviteEmail(opts: {
	tournamentName: string;
	inviterName: string;
	joinUrl: string;
	closesAt: Date | null;
}) {
	const closing = opts.closesAt
		? `\nJoining closes ${opts.closesAt.toLocaleString()}, and the tournament starts then.\n`
		: '';

	return {
		subject: `${opts.inviterName} invited you to ${opts.tournamentName} on CoinDraft`,
		content:
			`**${opts.inviterName}** invited you to a private tournament: **${opts.tournamentName}**.\n\n` +
			`Draft five tokens, one per sector, and compete on real price movement.\n` +
			closing +
			`\nJoin here:\n${opts.joinUrl}\n\n` +
			`This link is for you and can only be used once.`
	};
}

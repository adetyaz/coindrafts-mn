// Minimal ambient declaration for `nodemailer`.
//
// The package is intentionally NOT a dependency: email is optional here, the
// import in src/lib/server/email.ts is lazy, and an invite works as a shareable
// link with or without mail configured. This file lets the project type-check
// while nodemailer is absent.
//
// Installing nodemailer for real makes the lazy import succeed and sending
// start working — nothing else has to change. At that point this file can be
// deleted in favour of the package's own types.
declare module 'nodemailer' {
	export interface SendMailOptions {
		from?: string;
		to?: string;
		subject?: string;
		text?: string;
		html?: string;
	}

	export interface Transporter {
		sendMail(options: SendMailOptions): Promise<{ messageId: string }>;
	}

	export interface TransportOptions {
		service?: string;
		host?: string;
		port?: number;
		secure?: boolean;
		auth?: { user?: string; pass?: string };
	}

	export function createTransport(options: TransportOptions): Transporter;

	const nodemailer: { createTransport: typeof createTransport };
	export default nodemailer;
}

import { json } from '@sveltejs/kit';
import { generateNonce } from 'siwe';

export async function GET({ cookies }) {
	const nonce = generateNonce();
	// Store nonce in cookie to verify later (expires in 5 min)
	cookies.set('siwe_nonce', nonce, {
		path: '/',
		httpOnly: true,
		maxAge: 300,
		sameSite: 'strict'
	});
	return json({ nonce });
}

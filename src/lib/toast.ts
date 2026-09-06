import { writable } from 'svelte/store';

export interface ToastMessage {
	id: string;
	message: string;
	type: 'info' | 'error' | 'success';
}

export const toastState = writable<ToastMessage[]>([]);

export function toast(message: string, type: 'info' | 'error' | 'success' = 'info') {
	const id = Math.random().toString(36).substring(7);
	toastState.update((items) => [...items, { id, message, type }]);
	setTimeout(() => {
		toastState.update((items) => items.filter((t) => t.id !== id));
	}, 3000);
}

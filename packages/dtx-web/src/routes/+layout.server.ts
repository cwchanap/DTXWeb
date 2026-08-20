import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals: { session, user } }) => {
	return { session, user };
};

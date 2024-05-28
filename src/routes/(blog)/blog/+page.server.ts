import { supabase } from '@/lib/supabase';

export async function load() {
	const { data } = await supabase.from('simfiles').select();
	return {
		simfiles: data ?? []
	};
}

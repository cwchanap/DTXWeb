// Supabase types for backward compatibility.
// The app uses Supabase for auth and D1 for data storage, so these types are still needed
// for the SupabaseClient generic parameter.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	public: {
		Tables: {
			dtx_files: {
				Row: {
					id: number;
					label: string;
					level: number;
					simfile_id: number;
				};
				Insert: {
					id?: number;
					label?: string;
					level?: number;
					simfile_id: number;
				};
				Update: {
					id?: number;
					label?: string;
					level?: number;
					simfile_id?: number;
				};
				Relationships: [
					{
						foreignKeyName: 'dtx_file_simfile_id_fkey';
						columns: ['simfile_id'];
						isOneToOne: false;
						referencedRelation: 'simfiles';
						referencedColumns: ['id'];
					}
				];
			};
			simfiles: {
				Row: {
					artist: string;
					bpm: number;
					created_at: string;
					display_id: number | null;
					download_url: string | null;
					id: number;
					is_published: boolean;
					preview_url: string | null;
					publish_date: string;
					title: string;
					updated_at: string;
					user_id: string;
					video_preview_url: string | null;
				};
				Insert: {
					artist?: string;
					bpm: number;
					created_at?: string;
					display_id?: number | null;
					download_url?: string | null;
					id?: number;
					is_published?: boolean;
					preview_url?: string | null;
					publish_date?: string;
					title?: string;
					updated_at?: string;
					user_id: string;
					video_preview_url?: string | null;
				};
				Update: {
					artist?: string;
					bpm?: number;
					created_at?: string;
					display_id?: number | null;
					download_url?: string | null;
					id?: number;
					is_published?: boolean;
					preview_url?: string | null;
					publish_date?: string;
					title?: string;
					updated_at?: string;
					user_id?: string;
					video_preview_url?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'simfiles_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					}
				];
			};
			user_profiles: {
				Row: {
					id: number;
					user_id: string;
					username: string;
				};
				Insert: {
					id?: number;
					user_id: string;
					username: string;
				};
				Update: {
					id?: number;
					user_id?: string;
					username?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'user_profiles_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: true;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					}
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			[_ in never]: never;
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

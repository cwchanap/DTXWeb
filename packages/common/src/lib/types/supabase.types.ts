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

type PublicSchema = Database[Extract<keyof Database, 'public'>];

export type Tables<
	PublicTableNameOrOptions extends
		| keyof (PublicSchema['Tables'] & PublicSchema['Views'])
		| { schema: keyof Database },
	TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
		? keyof (Database[PublicTableNameOrOptions['schema']]['Tables'] &
				Database[PublicTableNameOrOptions['schema']]['Views'])
		: never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
	? (Database[PublicTableNameOrOptions['schema']]['Tables'] &
			Database[PublicTableNameOrOptions['schema']]['Views'])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: PublicTableNameOrOptions extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])
		? (PublicSchema['Tables'] & PublicSchema['Views'])[PublicTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	PublicTableNameOrOptions extends keyof PublicSchema['Tables'] | { schema: keyof Database },
	TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
		? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
		: never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
	? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: PublicTableNameOrOptions extends keyof PublicSchema['Tables']
		? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	PublicTableNameOrOptions extends keyof PublicSchema['Tables'] | { schema: keyof Database },
	TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
		? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
		: never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
	? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: PublicTableNameOrOptions extends keyof PublicSchema['Tables']
		? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	PublicEnumNameOrOptions extends keyof PublicSchema['Enums'] | { schema: keyof Database },
	EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
		? keyof Database[PublicEnumNameOrOptions['schema']]['Enums']
		: never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
	? Database[PublicEnumNameOrOptions['schema']]['Enums'][EnumName]
	: PublicEnumNameOrOptions extends keyof PublicSchema['Enums']
		? PublicSchema['Enums'][PublicEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		| keyof PublicSchema['CompositeTypes']
		| { schema: keyof Database },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof Database;
	}
		? keyof Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
		: never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
	? Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof PublicSchema['CompositeTypes']
		? PublicSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
		: never;

// Additional interfaces for simFile data
export interface DtxFile {
	level: number | string;
}

export interface SimfileWithDtx {
	id: number;
	title: string;
	artist: string;
	bpm: number;
	/** @deprecated Use `${simfileBucketUrl}/${id}/preview.jpg` instead. The preview_url field is no longer populated but preserved for backward compatibility. */
	preview_url: string | null;
	download_url: string | null;
	is_published: boolean;
	display_id: number | null;
	created_at?: string;
	publish_date?: string;
	updated_at?: string;
	user_id?: string;
	video_preview_url?: string | null;
	dtx_files?: Partial<DtxFile>[];
}

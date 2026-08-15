/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type SchemaChartScore = {
  bestAchievementRate?: Maybe<Scalars['Float']['output']>;
  bestRankLabel?: Maybe<Scalars['String']['output']>;
  clearCount: Scalars['Int']['output'];
  fullCombo: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  lastPlayedAt?: Maybe<Scalars['String']['output']>;
  maxCombo: Scalars['Int']['output'];
  playCount: Scalars['Int']['output'];
  scores: Array<SchemaScore>;
};

export type SchemaChartScoresInput = {
  bestAchievementRate?: InputMaybe<Scalars['Float']['input']>;
  bestRankLabel?: InputMaybe<Scalars['String']['input']>;
  chartId: Scalars['ID']['input'];
  clearCount: Scalars['Int']['input'];
  fullCombo: Scalars['Boolean']['input'];
  lastPlayedAt?: InputMaybe<Scalars['String']['input']>;
  maxCombo: Scalars['Int']['input'];
  playCount: Scalars['Int']['input'];
  scores: Array<SchemaScoreInput>;
};

export type SchemaCreateSimfileInput = {
  artist?: InputMaybe<Scalars['String']['input']>;
  bpm: Scalars['Float']['input'];
  displayId?: InputMaybe<Scalars['Int']['input']>;
  downloadUrl?: InputMaybe<Scalars['String']['input']>;
  dtxFiles?: InputMaybe<Array<SchemaDtxFileInput>>;
  isPublished?: InputMaybe<Scalars['Boolean']['input']>;
  previewUrl?: InputMaybe<Scalars['String']['input']>;
  publishDate?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  videoPreviewUrl?: InputMaybe<Scalars['String']['input']>;
};

export type SchemaDeleteResult = {
  deleted: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  message?: Maybe<Scalars['String']['output']>;
  partialDeletion?: Maybe<Scalars['Boolean']['output']>;
};

export type SchemaDtxFile = {
  fileEncoding: SchemaFileEncoding;
  fileSizeBytes: Scalars['Int']['output'];
  fileUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  level: Scalars['Float']['output'];
  myChartScore?: Maybe<SchemaChartScore>;
};

export type SchemaDtxFileInput = {
  label: Scalars['String']['input'];
  level: Scalars['Float']['input'];
};

export enum SchemaFileEncoding {
  ShiftJis = 'SHIFT_JIS',
  Utf_8 = 'UTF_8'
}

export type SchemaMagicLinkResult = {
  magicLinkUrl: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type SchemaMutation = {
  createSimfile: SchemaSimfile;
  deleteSimfile: SchemaDeleteResult;
  generateMagicLink: SchemaMagicLinkResult;
  updateSimfile: SchemaSimfile;
  updateSimfileDriveFile: SchemaSimfile;
  updateSimfileDriveFileGuarded: SchemaSimfile;
  uploadScores: SchemaUploadScoresResult;
  upsertUserProfile: SchemaUserProfile;
};


export type SchemaMutationCreateSimfileArgs = {
  input: SchemaCreateSimfileInput;
};


export type SchemaMutationDeleteSimfileArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationUpdateSimfileArgs = {
  id: Scalars['ID']['input'];
  input: SchemaUpdateSimfileInput;
};


export type SchemaMutationUpdateSimfileDriveFileArgs = {
  downloadUrl: Scalars['String']['input'];
  googleDriveFileId: Scalars['String']['input'];
  id: Scalars['ID']['input'];
};


export type SchemaMutationUpdateSimfileDriveFileGuardedArgs = {
  downloadUrl: Scalars['String']['input'];
  expectNoExistingDriveFile?: InputMaybe<Scalars['Boolean']['input']>;
  expectedPreviousDriveFileId?: InputMaybe<Scalars['String']['input']>;
  googleDriveFileId: Scalars['String']['input'];
  id: Scalars['ID']['input'];
};


export type SchemaMutationUploadScoresArgs = {
  input: SchemaUploadScoresInput;
};


export type SchemaMutationUpsertUserProfileArgs = {
  input: SchemaUpsertUserProfileInput;
};

export type SchemaQuery = {
  healthz: Scalars['String']['output'];
  me: SchemaUserProfile;
  myScoredSimfiles: SchemaSimfileConnection;
  nextDisplayId: Scalars['Int']['output'];
  simfile?: Maybe<SchemaSimfile>;
  simfileSearch: Array<SchemaSimfileSearchResult>;
  simfiles: SchemaSimfileConnection;
};


export type SchemaQueryMyScoredSimfilesArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  pageSize?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQuerySimfileArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQuerySimfileSearchArgs = {
  excludeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
};


export type SchemaQuerySimfilesArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  pageSize?: InputMaybe<Scalars['Int']['input']>;
  scope: SchemaSimfileScope;
  search?: InputMaybe<Scalars['String']['input']>;
};

export type SchemaR2File = {
  key: Scalars['String']['output'];
  size: Scalars['Int']['output'];
  uploaded: Scalars['String']['output'];
};

export type SchemaScore = {
  achievementRate?: Maybe<Scalars['Float']['output']>;
  cleared?: Maybe<Scalars['Boolean']['output']>;
  displayOrder?: Maybe<Scalars['Int']['output']>;
  good?: Maybe<Scalars['Int']['output']>;
  great?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  isBest: Scalars['Boolean']['output'];
  miss?: Maybe<Scalars['Int']['output']>;
  perfect?: Maybe<Scalars['Int']['output']>;
  performedAt?: Maybe<Scalars['String']['output']>;
  poor?: Maybe<Scalars['Int']['output']>;
  rankLabel?: Maybe<Scalars['String']['output']>;
  score?: Maybe<Scalars['Int']['output']>;
};

export type SchemaScoreInput = {
  achievementRate?: InputMaybe<Scalars['Float']['input']>;
  cleared?: InputMaybe<Scalars['Boolean']['input']>;
  displayOrder?: InputMaybe<Scalars['Int']['input']>;
  good?: InputMaybe<Scalars['Int']['input']>;
  great?: InputMaybe<Scalars['Int']['input']>;
  isBest: Scalars['Boolean']['input'];
  miss?: InputMaybe<Scalars['Int']['input']>;
  perfect?: InputMaybe<Scalars['Int']['input']>;
  performedAt?: InputMaybe<Scalars['String']['input']>;
  poor?: InputMaybe<Scalars['Int']['input']>;
  rankLabel?: InputMaybe<Scalars['String']['input']>;
  score?: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaSimfile = {
  artist: Scalars['String']['output'];
  bpm: Scalars['Float']['output'];
  createdAt: Scalars['String']['output'];
  displayId?: Maybe<Scalars['Int']['output']>;
  downloadUrl?: Maybe<Scalars['String']['output']>;
  dtxFiles: Array<SchemaDtxFile>;
  durationSeconds?: Maybe<Scalars['Int']['output']>;
  files: Array<SchemaR2File>;
  genre?: Maybe<Scalars['String']['output']>;
  googleDriveFileId?: Maybe<Scalars['String']['output']>;
  hasUploadedFiles: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isPublished: Scalars['Boolean']['output'];
  previewUrl?: Maybe<Scalars['String']['output']>;
  publishDate: Scalars['String']['output'];
  tags: Array<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  userId?: Maybe<Scalars['ID']['output']>;
  videoPreviewUrl?: Maybe<Scalars['String']['output']>;
};

export type SchemaSimfileConnection = {
  count: Scalars['Int']['output'];
  data: Array<SchemaSimfile>;
};

export enum SchemaSimfileScope {
  Mine = 'MINE',
  Published = 'PUBLISHED'
}

export type SchemaSimfileSearchResult = {
  artist: Scalars['String']['output'];
  bpm: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  isPublished: Scalars['Boolean']['output'];
  title: Scalars['String']['output'];
};

/** A chart that was excluded from the upload. chartId is the requested chart ID, or the sentinel "*" when the entire payload was rejected (e.g. too many charts) rather than a single chart. */
export type SchemaSkippedChart = {
  /** The skipped chart ID, or "*" (sentinel) when the skip applies to the whole upload batch rather than a specific chart. */
  chartId: Scalars['ID']['output'];
  reason: Scalars['String']['output'];
};

export type SchemaUpdateSimfileInput = {
  artist?: InputMaybe<Scalars['String']['input']>;
  bpm?: InputMaybe<Scalars['Float']['input']>;
  displayId?: InputMaybe<Scalars['Int']['input']>;
  downloadUrl?: InputMaybe<Scalars['String']['input']>;
  isPublished?: InputMaybe<Scalars['Boolean']['input']>;
  previewUrl?: InputMaybe<Scalars['String']['input']>;
  publishDate?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  videoPreviewUrl?: InputMaybe<Scalars['String']['input']>;
};

export type SchemaUploadScoresInput = {
  charts: Array<SchemaChartScoresInput>;
};

export type SchemaUploadScoresResult = {
  insertedScores: Scalars['Int']['output'];
  skipped: Array<SchemaSkippedChart>;
  updatedCharts: Scalars['Int']['output'];
};

export type SchemaUpsertUserProfileInput = {
  username: Scalars['String']['input'];
};

export type SchemaUserProfile = {
  userId: Scalars['ID']['output'];
  username: Scalars['String']['output'];
};

export type ChartScoresInput = {
  bestAchievementRate?: number | null | undefined;
  bestRankLabel?: string | null | undefined;
  chartId: string;
  clearCount: number;
  fullCombo: boolean;
  lastPlayedAt?: string | null | undefined;
  maxCombo: number;
  playCount: number;
  scores: Array<ScoreInput>;
};

export type ScoreInput = {
  achievementRate?: number | null | undefined;
  cleared?: boolean | null | undefined;
  displayOrder?: number | null | undefined;
  good?: number | null | undefined;
  great?: number | null | undefined;
  isBest: boolean;
  miss?: number | null | undefined;
  perfect?: number | null | undefined;
  performedAt?: string | null | undefined;
  poor?: number | null | undefined;
  rankLabel?: string | null | undefined;
  score?: number | null | undefined;
};

export enum SimfileScope {
  Mine = 'MINE',
  Published = 'PUBLISHED'
}

export type UpdateSimfileInput = {
  artist?: string | null | undefined;
  bpm?: number | null | undefined;
  displayId?: number | null | undefined;
  downloadUrl?: string | null | undefined;
  isPublished?: boolean | null | undefined;
  previewUrl?: string | null | undefined;
  publishDate?: string | null | undefined;
  title?: string | null | undefined;
  videoPreviewUrl?: string | null | undefined;
};

export type UploadScoresInput = {
  charts: Array<ChartScoresInput>;
};

export type UpsertUserProfileInput = {
  username: string;
};

export type GenerateMagicLinkMutationVariables = Exact<{ [key: string]: never; }>;


export type GenerateMagicLinkMutation = { generateMagicLink: { magicLinkUrl: string, success: boolean } };

export type SimfileFullFragment = { id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, googleDriveFileId: string | null, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, dtxFiles: Array<{ level: number, label: string }> };

export type GetPreviewSimfileQueryVariables = Exact<{
  id: string;
}>;


export type GetPreviewSimfileQuery = { simfile: { id: string, title: string, artist: string, dtxFiles: Array<{ level: number, label: string, fileUrl: string | null }> } | null };

export type SimfileWithFilesFragment = { hasUploadedFiles: boolean, id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, googleDriveFileId: string | null, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, files: Array<{ key: string, size: number, uploaded: string }>, dtxFiles: Array<{ level: number, label: string }> };

export type ListSimfilesQueryVariables = Exact<{
  scope: SimfileScope;
  search?: string | null | undefined;
  page?: number | null | undefined;
  pageSize?: number | null | undefined;
}>;


export type ListSimfilesQuery = { simfiles: { count: number, data: Array<{ hasUploadedFiles: boolean, id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, googleDriveFileId: string | null, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, dtxFiles: Array<{ level: number, label: string }> }> } };

export type GetSimfileQueryVariables = Exact<{
  id: string;
}>;


export type GetSimfileQuery = { simfile: { hasUploadedFiles: boolean, id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, googleDriveFileId: string | null, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, files: Array<{ key: string, size: number, uploaded: string }>, dtxFiles: Array<{ level: number, label: string }> } | null };

export type UpdateSimfileMutationVariables = Exact<{
  id: string;
  input: UpdateSimfileInput;
}>;


export type UpdateSimfileMutation = { updateSimfile: { hasUploadedFiles: boolean, id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, googleDriveFileId: string | null, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, files: Array<{ key: string, size: number, uploaded: string }>, dtxFiles: Array<{ level: number, label: string }> } };

export type UpdateSimfileDriveFileMutationVariables = Exact<{
  id: string;
  googleDriveFileId: string;
  downloadUrl: string;
}>;


export type UpdateSimfileDriveFileMutation = { updateSimfileDriveFile: { id: string, googleDriveFileId: string | null, downloadUrl: string | null } };

export type DeleteSimfileMutationVariables = Exact<{
  id: string;
}>;


export type DeleteSimfileMutation = { deleteSimfile: { id: string, deleted: boolean, partialDeletion: boolean | null, message: string | null } };

export type MyScoredSimfilesQueryVariables = Exact<{
  page?: number | null | undefined;
  pageSize?: number | null | undefined;
}>;


export type MyScoredSimfilesQuery = { myScoredSimfiles: { count: number, data: Array<{ id: string, title: string, artist: string, dtxFiles: Array<{ id: string, label: string, level: number, myChartScore: { playCount: number, clearCount: number, fullCombo: boolean, maxCombo: number, bestAchievementRate: number | null, bestRankLabel: string | null, lastPlayedAt: string | null, scores: Array<{ id: string, isBest: boolean, score: number | null, achievementRate: number | null, rankLabel: string | null, cleared: boolean | null, perfect: number | null, great: number | null, good: number | null, poor: number | null, miss: number | null, performedAt: string | null, displayOrder: number | null }> } | null }> }> } };

export type UploadScoresMutationVariables = Exact<{
  input: UploadScoresInput;
}>;


export type UploadScoresMutation = { uploadScores: { updatedCharts: number, insertedScores: number, skipped: Array<{ chartId: string, reason: string }> } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { userId: string, username: string } };

export type UpsertUserProfileMutationVariables = Exact<{
  input: UpsertUserProfileInput;
}>;


export type UpsertUserProfileMutation = { upsertUserProfile: { userId: string, username: string } };

export const SimfileFullFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"googleDriveFileId"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]} as unknown as DocumentNode<SimfileFullFragment, unknown>;
export const SimfileWithFilesFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileWithFiles"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"uploaded"}}]}},{"kind":"Field","name":{"kind":"Name","value":"hasUploadedFiles"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"googleDriveFileId"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]} as unknown as DocumentNode<SimfileWithFilesFragment, unknown>;
export const GenerateMagicLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GenerateMagicLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateMagicLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"magicLinkUrl"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]} as unknown as DocumentNode<GenerateMagicLinkMutation, GenerateMagicLinkMutationVariables>;
export const GetPreviewSimfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetPreviewSimfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"simfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"fileUrl"}}]}}]}}]}}]} as unknown as DocumentNode<GetPreviewSimfileQuery, GetPreviewSimfileQueryVariables>;
export const ListSimfilesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ListSimfiles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"scope"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SimfileScope"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"simfiles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"scope"},"value":{"kind":"Variable","name":{"kind":"Name","value":"scope"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}},{"kind":"Field","name":{"kind":"Name","value":"hasUploadedFiles"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"googleDriveFileId"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]} as unknown as DocumentNode<ListSimfilesQuery, ListSimfilesQueryVariables>;
export const GetSimfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSimfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"simfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileWithFiles"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"googleDriveFileId"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileWithFiles"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"uploaded"}}]}},{"kind":"Field","name":{"kind":"Name","value":"hasUploadedFiles"}}]}}]} as unknown as DocumentNode<GetSimfileQuery, GetSimfileQueryVariables>;
export const UpdateSimfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSimfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSimfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSimfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileWithFiles"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"googleDriveFileId"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileWithFiles"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"uploaded"}}]}},{"kind":"Field","name":{"kind":"Name","value":"hasUploadedFiles"}}]}}]} as unknown as DocumentNode<UpdateSimfileMutation, UpdateSimfileMutationVariables>;
export const UpdateSimfileDriveFileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSimfileDriveFile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"googleDriveFileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"downloadUrl"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSimfileDriveFile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"googleDriveFileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"googleDriveFileId"}}},{"kind":"Argument","name":{"kind":"Name","value":"downloadUrl"},"value":{"kind":"Variable","name":{"kind":"Name","value":"downloadUrl"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"googleDriveFileId"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}}]}}]}}]} as unknown as DocumentNode<UpdateSimfileDriveFileMutation, UpdateSimfileDriveFileMutationVariables>;
export const DeleteSimfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSimfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSimfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"deleted"}},{"kind":"Field","name":{"kind":"Name","value":"partialDeletion"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]} as unknown as DocumentNode<DeleteSimfileMutation, DeleteSimfileMutationVariables>;
export const MyScoredSimfilesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyScoredSimfiles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myScoredSimfiles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"myChartScore"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playCount"}},{"kind":"Field","name":{"kind":"Name","value":"clearCount"}},{"kind":"Field","name":{"kind":"Name","value":"fullCombo"}},{"kind":"Field","name":{"kind":"Name","value":"maxCombo"}},{"kind":"Field","name":{"kind":"Name","value":"bestAchievementRate"}},{"kind":"Field","name":{"kind":"Name","value":"bestRankLabel"}},{"kind":"Field","name":{"kind":"Name","value":"lastPlayedAt"}},{"kind":"Field","name":{"kind":"Name","value":"scores"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"isBest"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"achievementRate"}},{"kind":"Field","name":{"kind":"Name","value":"rankLabel"}},{"kind":"Field","name":{"kind":"Name","value":"cleared"}},{"kind":"Field","name":{"kind":"Name","value":"perfect"}},{"kind":"Field","name":{"kind":"Name","value":"great"}},{"kind":"Field","name":{"kind":"Name","value":"good"}},{"kind":"Field","name":{"kind":"Name","value":"poor"}},{"kind":"Field","name":{"kind":"Name","value":"miss"}},{"kind":"Field","name":{"kind":"Name","value":"performedAt"}},{"kind":"Field","name":{"kind":"Name","value":"displayOrder"}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<MyScoredSimfilesQuery, MyScoredSimfilesQueryVariables>;
export const UploadScoresDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UploadScores"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UploadScoresInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"uploadScores"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updatedCharts"}},{"kind":"Field","name":{"kind":"Name","value":"insertedScores"}},{"kind":"Field","name":{"kind":"Name","value":"skipped"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"chartId"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}}]}}]}}]}}]} as unknown as DocumentNode<UploadScoresMutation, UploadScoresMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const UpsertUserProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpsertUserProfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpsertUserProfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"upsertUserProfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}}]} as unknown as DocumentNode<UpsertUserProfileMutation, UpsertUserProfileMutationVariables>;
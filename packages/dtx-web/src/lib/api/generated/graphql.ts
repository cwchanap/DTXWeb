/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ChartScoresInput = {
  chartId: string;
  clearCount: number;
  playCount: number;
  scores: Array<ScoreInput>;
};

export type ScoreInput = {
  achievementRate?: number | null | undefined;
  cleared: boolean;
  displayOrder?: number | null | undefined;
  fullCombo: boolean;
  good?: number | null | undefined;
  great?: number | null | undefined;
  isBest: boolean;
  maxCombo?: number | null | undefined;
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


export type MyScoredSimfilesQuery = { myScoredSimfiles: { count: number, data: Array<{ id: string, title: string, artist: string, dtxFiles: Array<{ id: string, label: string, level: number, myChartScore: { playCount: number, clearCount: number, scores: Array<{ id: string, isBest: boolean, score: number | null, achievementRate: number | null, rankLabel: string | null, fullCombo: boolean, cleared: boolean, maxCombo: number | null, perfect: number | null, great: number | null, good: number | null, poor: number | null, miss: number | null, performedAt: string | null, displayOrder: number | null }> } | null }> }> } };

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
export const MyScoredSimfilesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyScoredSimfiles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myScoredSimfiles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"myChartScore"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"playCount"}},{"kind":"Field","name":{"kind":"Name","value":"clearCount"}},{"kind":"Field","name":{"kind":"Name","value":"scores"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"isBest"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"achievementRate"}},{"kind":"Field","name":{"kind":"Name","value":"rankLabel"}},{"kind":"Field","name":{"kind":"Name","value":"fullCombo"}},{"kind":"Field","name":{"kind":"Name","value":"cleared"}},{"kind":"Field","name":{"kind":"Name","value":"maxCombo"}},{"kind":"Field","name":{"kind":"Name","value":"perfect"}},{"kind":"Field","name":{"kind":"Name","value":"great"}},{"kind":"Field","name":{"kind":"Name","value":"good"}},{"kind":"Field","name":{"kind":"Name","value":"poor"}},{"kind":"Field","name":{"kind":"Name","value":"miss"}},{"kind":"Field","name":{"kind":"Name","value":"performedAt"}},{"kind":"Field","name":{"kind":"Name","value":"displayOrder"}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<MyScoredSimfilesQuery, MyScoredSimfilesQueryVariables>;
export const UploadScoresDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UploadScores"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UploadScoresInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"uploadScores"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updatedCharts"}},{"kind":"Field","name":{"kind":"Name","value":"insertedScores"}},{"kind":"Field","name":{"kind":"Name","value":"skipped"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"chartId"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}}]}}]}}]}}]} as unknown as DocumentNode<UploadScoresMutation, UploadScoresMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const UpsertUserProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpsertUserProfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpsertUserProfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"upsertUserProfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}}]} as unknown as DocumentNode<UpsertUserProfileMutation, UpsertUserProfileMutationVariables>;
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type CreateSimfileInput = {
  artist?: InputMaybe<Scalars['String']['input']>;
  bpm: Scalars['Float']['input'];
  displayId?: InputMaybe<Scalars['Int']['input']>;
  downloadUrl?: InputMaybe<Scalars['String']['input']>;
  dtxFiles?: InputMaybe<Array<DtxFileInput>>;
  isPublished?: InputMaybe<Scalars['Boolean']['input']>;
  previewUrl?: InputMaybe<Scalars['String']['input']>;
  publishDate?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  videoPreviewUrl?: InputMaybe<Scalars['String']['input']>;
};

export type DeleteResult = {
  deleted: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  message: Maybe<Scalars['String']['output']>;
  partialDeletion: Maybe<Scalars['Boolean']['output']>;
};

export type DtxFile = {
  label: Scalars['String']['output'];
  level: Scalars['Float']['output'];
};

export type DtxFileInput = {
  label: Scalars['String']['input'];
  level: Scalars['Float']['input'];
};

export type MagicLinkResult = {
  magicLinkUrl: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type Mutation = {
  createSimfile: Simfile;
  deleteSimfile: DeleteResult;
  generateMagicLink: MagicLinkResult;
  updateSimfile: Simfile;
  upsertUserProfile: UserProfile;
};


export type MutationCreateSimfileArgs = {
  input: CreateSimfileInput;
};


export type MutationDeleteSimfileArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateSimfileArgs = {
  id: Scalars['ID']['input'];
  input: UpdateSimfileInput;
};


export type MutationUpsertUserProfileArgs = {
  input: UpsertUserProfileInput;
};

export type Query = {
  healthz: Scalars['String']['output'];
  me: UserProfile;
  nextDisplayId: Scalars['Int']['output'];
  simfile: Maybe<Simfile>;
  simfileSearch: Array<SimfileSearchResult>;
  simfiles: SimfileConnection;
};


export type QuerySimfileArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySimfileSearchArgs = {
  excludeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
};


export type QuerySimfilesArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  pageSize?: InputMaybe<Scalars['Int']['input']>;
  scope: SimfileScope;
  search?: InputMaybe<Scalars['String']['input']>;
};

export type R2File = {
  key: Scalars['String']['output'];
  size: Scalars['Int']['output'];
  uploaded: Scalars['String']['output'];
};

export type Simfile = {
  artist: Scalars['String']['output'];
  bpm: Scalars['Float']['output'];
  createdAt: Scalars['String']['output'];
  displayId: Maybe<Scalars['Int']['output']>;
  downloadUrl: Maybe<Scalars['String']['output']>;
  dtxFiles: Array<DtxFile>;
  files: Array<R2File>;
  hasUploadedFiles: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isPublished: Scalars['Boolean']['output'];
  previewUrl: Maybe<Scalars['String']['output']>;
  publishDate: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  userId: Maybe<Scalars['ID']['output']>;
  videoPreviewUrl: Maybe<Scalars['String']['output']>;
};

export type SimfileConnection = {
  count: Scalars['Int']['output'];
  data: Array<Simfile>;
};

export enum SimfileScope {
  Mine = 'MINE',
  Published = 'PUBLISHED'
}

export type SimfileSearchResult = {
  artist: Scalars['String']['output'];
  bpm: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  isPublished: Scalars['Boolean']['output'];
  title: Scalars['String']['output'];
};

export type UpdateSimfileInput = {
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

export type UpsertUserProfileInput = {
  username: Scalars['String']['input'];
};

export type UserProfile = {
  userId: Scalars['ID']['output'];
  username: Scalars['String']['output'];
};

export type GenerateMagicLinkMutationVariables = Exact<{ [key: string]: never; }>;


export type GenerateMagicLinkMutation = { generateMagicLink: { magicLinkUrl: string, success: boolean } };

export type SimfileFullFragment = { id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, dtxFiles: Array<{ level: number, label: string }> };

export type SimfileWithFilesFragment = { hasUploadedFiles: boolean, id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, files: Array<{ key: string, size: number, uploaded: string }>, dtxFiles: Array<{ level: number, label: string }> };

export type ListSimfilesQueryVariables = Exact<{
  scope: SimfileScope;
  search?: InputMaybe<Scalars['String']['input']>;
  page?: InputMaybe<Scalars['Int']['input']>;
  pageSize?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ListSimfilesQuery = { simfiles: { count: number, data: Array<{ hasUploadedFiles: boolean, id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, dtxFiles: Array<{ level: number, label: string }> }> } };

export type GetSimfileQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type GetSimfileQuery = { simfile: { hasUploadedFiles: boolean, id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, files: Array<{ key: string, size: number, uploaded: string }>, dtxFiles: Array<{ level: number, label: string }> } | null };

export type UpdateSimfileMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateSimfileInput;
}>;


export type UpdateSimfileMutation = { updateSimfile: { id: string, displayId: number | null, title: string, artist: string, bpm: number, userId: string | null, isPublished: boolean, downloadUrl: string | null, previewUrl: string | null, videoPreviewUrl: string | null, publishDate: string, createdAt: string, updatedAt: string, dtxFiles: Array<{ level: number, label: string }> } };

export type DeleteSimfileMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteSimfileMutation = { deleteSimfile: { id: string, deleted: boolean, partialDeletion: boolean | null, message: string | null } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { userId: string, username: string } };

export type UpsertUserProfileMutationVariables = Exact<{
  input: UpsertUserProfileInput;
}>;


export type UpsertUserProfileMutation = { upsertUserProfile: { userId: string, username: string } };

export const SimfileFullFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]} as unknown as DocumentNode<SimfileFullFragment, unknown>;
export const SimfileWithFilesFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileWithFiles"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"uploaded"}}]}},{"kind":"Field","name":{"kind":"Name","value":"hasUploadedFiles"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]} as unknown as DocumentNode<SimfileWithFilesFragment, unknown>;
export const GenerateMagicLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GenerateMagicLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateMagicLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"magicLinkUrl"}},{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]} as unknown as DocumentNode<GenerateMagicLinkMutation, GenerateMagicLinkMutationVariables>;
export const ListSimfilesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ListSimfiles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"scope"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SimfileScope"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"simfiles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"scope"},"value":{"kind":"Variable","name":{"kind":"Name","value":"scope"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}},{"kind":"Field","name":{"kind":"Name","value":"hasUploadedFiles"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]} as unknown as DocumentNode<ListSimfilesQuery, ListSimfilesQueryVariables>;
export const GetSimfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetSimfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"simfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileWithFiles"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileWithFiles"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}},{"kind":"Field","name":{"kind":"Name","value":"files"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"uploaded"}}]}},{"kind":"Field","name":{"kind":"Name","value":"hasUploadedFiles"}}]}}]} as unknown as DocumentNode<GetSimfileQuery, GetSimfileQueryVariables>;
export const UpdateSimfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSimfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSimfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSimfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SimfileFull"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SimfileFull"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Simfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"artist"}},{"kind":"Field","name":{"kind":"Name","value":"bpm"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"downloadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"previewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"videoPreviewUrl"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dtxFiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]} as unknown as DocumentNode<UpdateSimfileMutation, UpdateSimfileMutationVariables>;
export const DeleteSimfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSimfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSimfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"deleted"}},{"kind":"Field","name":{"kind":"Name","value":"partialDeletion"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]} as unknown as DocumentNode<DeleteSimfileMutation, DeleteSimfileMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const UpsertUserProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpsertUserProfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpsertUserProfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"upsertUserProfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}}]} as unknown as DocumentNode<UpsertUserProfileMutation, UpsertUserProfileMutationVariables>;
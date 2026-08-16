import type { SimfileModel } from '@dtx/common';
import type { NativeSimfile } from '$lib/lib/generated/native-api-contracts';

type NativeSimfileMatchesModel = NativeSimfile extends SimfileModel ? true : never;
export const nativeSimfileMatchesModel: NativeSimfileMatchesModel = true;

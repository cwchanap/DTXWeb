# @dtx/ui-components

Export-only Svelte UI library that houses shadcn-svelte components shared across apps.

## Develop

- Start dev preview: `npm run dev -w=@dtx/ui-components`
- Build package: `npm run build -w=@dtx/ui-components`

## Add shadcn-svelte Components

This package is preconfigured with `components.json` so the shadcn-svelte CLI writes into `src/lib/components`.

1. Initialize once (writes theme to `src/app.css`):

```
npx shadcn-svelte@latest init --cwd packages/ui-components
```

2. Add components (example: Button):

```
npx shadcn-svelte@latest add button --cwd packages/ui-components
```

3. Re-export from `src/lib/components/index.ts` so consumers can import:

```ts
export { default as Button } from './button/button.svelte';
```

Consumers can import from apps:

```ts
import { Button } from '@dtx/ui-components/components';
```

Notes:

- Tailwind v4 required in consuming apps (see dtx-web setup). This package ships `src/app.css` tokens for preview; override in apps if needed.
- `cn` utility follows docs (`clsx` + `tailwind-merge`) at `src/lib/utils/cn.ts`.

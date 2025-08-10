import type { Snippet } from 'svelte';
type ModalSize = 'sm' | 'md' | 'lg';
type ConfirmVariant = 'primary' | 'danger';
type $$ComponentProps = {
    open: boolean;
    title: string;
    children: Snippet;
    onConfirm?: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: ConfirmVariant;
    size?: ModalSize;
};
declare const Modal: import("svelte").Component<$$ComponentProps, {}, "open">;
type Modal = ReturnType<typeof Modal>;
export default Modal;

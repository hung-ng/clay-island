// Read live, not cached — the user can flip the OS setting mid-session.
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function applyReducedMotion(root: HTMLElement, reduced: boolean): void {
  root.dataset.reducedMotion = String(reduced)
}

export type InertElement = { inert: boolean }

/** Preserve and restore background state so independently-owned modals compose safely. */
export function setModalBackgroundInert<T extends InertElement>(
  elements: Iterable<T>,
  previousState: Map<T, boolean>,
  value: boolean,
): void {
  if (value) {
    for (const element of elements) {
      if (!previousState.has(element)) previousState.set(element, element.inert)
      element.inert = true
    }
    return
  }

  for (const [element, wasInert] of previousState) element.inert = wasInert
  previousState.clear()
}
